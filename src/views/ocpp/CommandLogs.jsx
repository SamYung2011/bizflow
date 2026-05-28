import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../lib/ocppAdmin.js";

// 命令日誌 — chargecms 表 rc_operate_command_logs（list 唯讀）
// 注意：vendor PHP 端目前不寫此表，生產資料現為 0 行。先把入口搭好，後續 BizFlow 自帶命令模塊時再接寫入。
// 零寫入 / 不發 OCPP 命令 / 不動 vendor 8081 / 不動 chargecms PHP

// vendor 13 cmd 映射（OCPP 協議專有名詞，全語種保持原樣不翻譯）
// (label, value) — value 為 chargecms 表存的 command_name 實際值
const COMMAND_OPTIONS = [
  ["Reset", "reset"],
  ["UnlockConnector", "unlockconnector"],
  ["RemoteStart", "startcharge"],
  ["RemoteStop", "stopcharge"],
  ["ChangeConfig", "changeconfig"],
  ["GetConfig", "getconfig"],
  ["ChangeAvailable", "changeavailable"],
  ["Upgrade", "upgrade"],
  ["SetProfile", "setprofile"],
  ["ClearProfile", "clearprofile"],
  ["GetDiagnostics", "getdiagnostics"],
  ["SetFee", "setfee"],
  ["DataTransfer", "datatransfer"],
];

function hkDateStartTs(date) {
  const ts = Math.floor(new Date(`${date}T00:00:00+08:00`).getTime() / 1000);
  return Number.isFinite(ts) ? ts : null;
}

// callback_data 推導的 result chip 配色
function resultTone(result) {
  if (!result) return { bg: "#f3f4f6", fg: "#6b7280" };
  const k = String(result).toLowerCase();
  if (k.includes("accept") || k.includes("success")) return { bg: "#d1fae5", fg: "#065f46" };
  if (k.includes("reject") || k.includes("fail") || k.includes("error")) return { bg: "#fee2e2", fg: "#991b1b" };
  if (k.includes("timeout") || k.includes("pending")) return { bg: "#fef3c7", fg: "#92400e" };
  return { bg: "#f3f4f6", fg: "#6b7280" };
}

function ResultChip({ value, t }) {
  const { bg, fg } = resultTone(value);
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, background: bg, color: fg, fontSize: 11, fontWeight: 600 }}>
      {value || t("未知")}
    </span>
  );
}

function CallbackBlock({ data, t }) {
  if (data == null || data === "") return <div style={{ color: "#888", fontSize: 12 }}>{t("無回包數據")}</div>;
  // 嘗試 pretty print JSON，失敗則 raw
  let pretty = data;
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    pretty = JSON.stringify(parsed, null, 2);
  } catch {
    pretty = typeof data === "string" ? data : JSON.stringify(data);
  }
  return (
    <pre style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, padding: 10, margin: 0, fontSize: 11, lineHeight: 1.5, maxHeight: 280, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {pretty}
    </pre>
  );
}

export default function CommandLogs({ session, isAdmin, active = true }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filterStationId, setFilterStationId] = useState("");
  const [filterPileNo, setFilterPileNo] = useState("");
  const [filterCmd, setFilterCmd] = useState("");
  const [filterResult, setFilterResult] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterQ, setFilterQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const aliveRef = useRef(true);
  const wasActiveRef = useRef(active);

  const accessToken = session?.access_token;

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (filterStationId !== "") qs.set("stationId", filterStationId);
      if (filterPileNo) qs.set("pileNo", filterPileNo);
      if (filterCmd) qs.set("cmd", filterCmd);
      if (filterResult) qs.set("result", filterResult);
      if (filterDateFrom) {
        const ts = hkDateStartTs(filterDateFrom);
        if (Number.isFinite(ts) && ts > 0) qs.set("from", String(ts));
      }
      if (filterDateTo) {
        const ts = hkDateStartTs(filterDateTo);
        if (Number.isFinite(ts) && ts > 0) qs.set("to", String(ts + 86400));
      }
      if (filterQ) qs.set("q", filterQ);
      qs.set("limit", "100");
      const data = await callOcppAdmin(`/command-logs?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, filterStationId, filterPileNo, filterCmd, filterResult, filterDateFrom, filterDateTo, filterQ]);

  const loadFilters = useCallback(async () => {
    if (!isAdmin || !accessToken) return;
    try {
      const stationsRes = await callOcppAdmin("/stations?limit=200", { accessToken, ttlMs: 300_000 }).catch(() => null);
      if (!aliveRef.current) return;
      setStations(Array.isArray(stationsRes?.data) ? stationsRes.data : []);
    } catch {
      // dropdowns optional
    }
  }, [isAdmin, accessToken]);

  useEffect(() => {
    aliveRef.current = true;
    loadFilters();
    return () => { aliveRef.current = false; };
  }, [loadFilters]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (active && !wasActiveRef.current) refresh();
    wasActiveRef.current = active;
  }, [active, refresh]);

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#999" }}>
        {t("無權訪問")}
      </div>
    );
  }

  const empty = !loading && !err && rows.length === 0;

  return (
    <div>
      <div style={{ background: "#fff7e6", border: "1px solid #ffd58a", color: "#92400e", padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
        <strong>{t("命令日誌 · 演示階段")}</strong>{" "}
        {t("此列表讀 chargecms 表 rc_operate_command_logs；目前 vendor PHP 端不寫此表，生產資料為 0 條。入口已搭好，後續 BizFlow 自帶命令模塊時再接寫入即可。只讀，零寫入。")}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("命令日誌")}</h3>

        <select value={filterStationId} onChange={(e) => setFilterStationId(e.target.value)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
          <option value="">{t("全部站點")}</option>
          <option value="0">{t("私人桩（無站點）")}</option>
          {stations.map((s) => (
            <option key={s.stationId} value={s.stationId}>{s.name || `#${s.stationId}`}</option>
          ))}
        </select>

        <input
          value={filterPileNo}
          onChange={(e) => setFilterPileNo(e.target.value)}
          placeholder={t("樁編號")}
          style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, width: 140 }}
        />

        <select value={filterCmd} onChange={(e) => setFilterCmd(e.target.value)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
          <option value="">{t("全部命令")}</option>
          {COMMAND_OPTIONS.map(([label, value]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <select value={filterResult} onChange={(e) => setFilterResult(e.target.value)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
          <option value="">{t("全部結果")}</option>
          <option value="accepted">{t("成功")}</option>
          <option value="error">{t("失敗")}</option>
          <option value="timeout">{t("超時")}</option>
        </select>

        <label style={{ fontSize: 12, color: "#666" }}>
          {t("日期從")}{" "}
          <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} style={{ padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 12, color: "#666" }}>
          {t("日期到")}{" "}
          <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} style={{ padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }} />
        </label>

        <form
          onSubmit={(e) => { e.preventDefault(); setFilterQ(searchInput.trim()); }}
          style={{ display: "flex", gap: 6 }}
        >
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("樁編號 / 命令 / 回包")}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, width: 200 }}
          />
          <button type="submit" style={{ padding: "4px 14px", borderRadius: 6, border: "1px solid #1976d2", background: "#1976d2", color: "#fff", fontSize: 13, cursor: "pointer" }}>
            {t("搜尋")}
          </button>
        </form>

        <button onClick={() => refresh({ force: true })} disabled={loading} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ddd", background: loading ? "#f3f4f6" : "#fff", cursor: loading ? "default" : "pointer", fontSize: 13 }}>
          {loading ? t("載入中…") : t("刷新")}
        </button>

        <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>
          {t("共")} {rows.length} {t("條")}
        </span>
      </div>

      {err && (
        <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {empty && (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "1px dashed #ddd", borderRadius: 8 }}>
          {t("無命令日誌數據")}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa", textAlign: "left" }}>
                {[t("時間"), t("站點"), t("樁編號"), t("槍號"), t("管理員"), t("命令"), t("結果"), t("操作")].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = expandedId === r.logId;
                return (
                  <React.Fragment key={r.logId}>
                    <tr style={{ borderBottom: open ? "none" : "1px solid #f3f4f6" }}>
                      <td style={{ padding: "8px 10px", fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>{fmtUnixTs(r.createdAt)}</td>
                      <td style={{ padding: "8px 10px" }}>{r.stationName || (r.stationId === 0 ? t("私人桩") : "—")}</td>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{r.pileNo || "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{r.connectorNo ?? "—"}</td>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "#666" }}>{r.adminId ?? "—"}</td>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{r.commandName || "—"}</td>
                      <td style={{ padding: "8px 10px" }}><ResultChip value={r.result} t={t} /></td>
                      <td style={{ padding: "8px 10px" }}>
                        <button
                          onClick={() => setExpandedId(open ? null : r.logId)}
                          style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #e5e7eb", background: "#fff", color: "#1976d2", fontSize: 12, cursor: "pointer" }}
                        >
                          {open ? t("收起") : t("查看回包")}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr style={{ borderBottom: "1px solid #f3f4f6", background: "#fcfcfd" }}>
                        <td colSpan={8} style={{ padding: "10px 14px" }}>
                          <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>{t("回包數據")} (callback_data)</div>
                          <CallbackBlock data={r.callbackData} t={t} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
