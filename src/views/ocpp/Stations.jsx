import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../lib/ocppAdmin.js";
import { TableHead } from "./finance/financeShared.jsx";

// OCPP 站點管理 — bizflow 主站 admin-only 視圖
// 數據通路：bizflow → Supabase Edge Function `ocpp-admin` → ECS `chargecms-readapi` (8084) → chargecms MySQL（只讀）
// 權限：employees.is_admin = true 才能進（前端 nav gate + view 二次兜底 + Edge Function server-side guard 三層）
// Phase 1：read-only list + detail，0 寫操作 / 0 命令下發

const fmtTs = (ts) => fmtUnixTs(ts, { dateOnly: true });

function StatusChip({ status, t }) {
  const palette = {
    normal: { bg: "#e8f5e9", color: "#22c55e", border: "#a5d6a7" },
    hidden: { bg: "#eceff1", color: "#607d8b", border: "#cfd8dc" },
  };
  const c = palette[status] || palette.hidden;
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: c.bg, color: c.color, border: `1px solid ${c.border}`, fontSize: 12, fontWeight: 600 }}>
      {status || t("未知")}
    </span>
  );
}

function StationDetailModal({ stationId, accessToken, onClose, t }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    setErr("");
    callOcppAdmin(`/stations/${stationId}`, { accessToken })
      .then((res) => { if (aliveRef.current) setDetail(res?.data || null); })
      .catch((e) => { if (aliveRef.current) setErr(String(e?.message || e)); })
      .finally(() => { if (aliveRef.current) setLoading(false); });
    return () => { aliveRef.current = false; };
  }, [stationId, accessToken]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: 24, width: "min(900px, 95vw)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("站點詳情")} #{stationId}</h3>
          <button onClick={onClose} style={{ marginLeft: "auto", padding: "4px 12px", border: "1px solid #ddd", background: "#fafafa", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            {t("關閉")}
          </button>
        </div>

        {loading && <div style={{ padding: 20, textAlign: "center", color: "#888" }}>{t("載入中…")}</div>}
        {err && (
          <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}>
            {err}
          </div>
        )}

        {detail && (
          <div style={{ fontSize: 13 }}>
            <section style={{ marginBottom: 18 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>{t("基本資訊")}</h4>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {[
                    ["name", t("站點名稱")],
                    ["address", t("地址")],
                    ["operatorName", t("運營商")],
                    ["mapAddress", t("地圖地址")],
                    ["openHours", t("營業時間")],
                    ["status", t("狀態")],
                    ["price", t("基礎價格")],
                    ["kwhCost", t("電費")],
                    ["billingMode", t("計費模式")],
                    ["isSmartCharging", t("智能充電")],
                    ["isShare", t("共享站")],
                  ].map(([k, label]) => (
                    <tr key={k} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "6px 10px", color: "#666", width: 140 }}>{label}</td>
                      <td style={{ padding: "6px 10px" }}>
                        {k === "status" ? <StatusChip status={detail.station[k]} t={t} /> :
                         typeof detail.station[k] === "boolean" ? (detail.station[k] ? t("是") : t("否")) :
                         (detail.station[k] ?? "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {detail.prices?.length > 0 && (
              <section style={{ marginBottom: 18 }}>
                <h4 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>{t("價格時段")} ({detail.prices.length})</h4>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#fafafa" }}>
                      <th style={{ padding: "6px 10px", textAlign: "left", borderBottom: "1px solid #eee" }}>{t("起始時間")}</th>
                      <th style={{ padding: "6px 10px", textAlign: "left", borderBottom: "1px solid #eee" }}>{t("結束時間")}</th>
                      <th style={{ padding: "6px 10px", textAlign: "right", borderBottom: "1px solid #eee" }}>{t("基礎價")}</th>
                      <th style={{ padding: "6px 10px", textAlign: "right", borderBottom: "1px solid #eee" }}>{t("電費")}</th>
                      <th style={{ padding: "6px 10px", textAlign: "left", borderBottom: "1px solid #eee" }}>{t("狀態")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.prices.map((p) => (
                      <tr key={p.priceId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "6px 10px" }}>{p.startTime || "—"}</td>
                        <td style={{ padding: "6px 10px" }}>{p.endTime || "—"}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right" }}>{p.price}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right" }}>{p.kwhCost}</td>
                        <td style={{ padding: "6px 10px" }}><StatusChip status={p.status} t={t} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <section>
              <h4 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>{t("充電樁")} ({detail.piles?.length || 0})</h4>
              {detail.piles?.length === 0 ? (
                <div style={{ padding: 16, textAlign: "center", color: "#888" }}>{t("此站無充電樁")}</div>
              ) : (
                <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 6 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#fafafa" }}>
                        {[t("樁編號"), t("廠商"), t("型號"), t("固件"), t("在線"), t("狀態"), t("槍數")].map((h) => (
                          <th key={h} style={{ padding: "6px 10px", textAlign: "left", borderBottom: "1px solid #eee" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.piles?.map((p) => (
                        <tr key={p.pileId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <td style={{ padding: "6px 10px", fontFamily: "monospace" }}>{p.pileNo || "—"}</td>
                          <td style={{ padding: "6px 10px" }}>{p.vendor || "—"}</td>
                          <td style={{ padding: "6px 10px" }}>{p.model || "—"}</td>
                          <td style={{ padding: "6px 10px", fontSize: 11, color: "#666" }}>{p.firmwareVersion || "—"}</td>
                          <td style={{ padding: "6px 10px" }}>{p.onlineStatus === 1 ? t("在線") : t("離線")}</td>
                          <td style={{ padding: "6px 10px" }}><StatusChip status={p.status} t={t} /></td>
                          <td style={{ padding: "6px 10px", textAlign: "center" }}>{p.connectors?.length || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OcppStations({ supabase, session, isAdmin, active = true }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filterOperatorId, setFilterOperatorId] = useState("");
  const [filterStatus, setFilterStatus] = useState("normal");
  const [filterQ, setFilterQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedStationId, setSelectedStationId] = useState(null);
  const aliveRef = useRef(true);
  const wasActiveRef = useRef(active);

  const accessToken = session?.access_token;

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (filterOperatorId) qs.set("operatorId", filterOperatorId);
      if (filterStatus && filterStatus !== "normal") qs.set("status", filterStatus);
      if (filterQ) qs.set("q", filterQ);
      qs.set("limit", "100");
      const data = await callOcppAdmin(`/stations?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, filterOperatorId, filterStatus, filterQ]);

  const loadOperators = useCallback(async () => {
    if (!isAdmin || !accessToken) return;
    try {
      const data = await callOcppAdmin("/operators?limit=200", { accessToken, ttlMs: 300_000 });
      if (aliveRef.current) setOperators(Array.isArray(data?.data) ? data.data : []);
    } catch {
      // operators dropdown is optional; swallow error
    }
  }, [isAdmin, accessToken]);

  useEffect(() => {
    aliveRef.current = true;
    loadOperators();
    return () => { aliveRef.current = false; };
  }, [loadOperators]);

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
    <div style={{ padding: "16px 20px", maxWidth: 1400 }}>
      <div style={{ background: "#fff7e6", border: "1px solid #ffd58a", color: "#92400e", padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
        <strong>{t("OCPP 站點 · 演示階段")}</strong>{" "}
        {t("此模塊通過 Edge Function ocpp-admin 從 chargecms 讀數據（只讀，零寫入），不影響 vendor 8081 / chargecms PHP / 樁 firmware。後端 chargecms-readapi 部署完成前列表可能為空或返錯。")}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t("OCPP 站點")}</h2>

        <select value={filterOperatorId} onChange={(e) => setFilterOperatorId(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
          <option value="">{t("全部運營商")}</option>
          {operators.map((o) => (
            <option key={o.operatorId} value={o.operatorId}>{o.name}</option>
          ))}
        </select>

        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
          <option value="normal">{t("僅正常")}</option>
          <option value="hidden">{t("僅隱藏")}</option>
          <option value="all">{t("全部")}</option>
        </select>

        <form
          onSubmit={(e) => { e.preventDefault(); setFilterQ(searchInput.trim()); }}
          style={{ display: "flex", gap: 6 }}
        >
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("站名 / 地址 / 樁編號")}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, width: 220 }}
          />
          <button type="submit" style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #1976d2", background: "#1976d2", color: "#fff", fontSize: 13, cursor: "pointer" }}>
            {t("搜尋")}
          </button>
        </form>

        <button onClick={() => refresh({ force: true })} disabled={loading} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: loading ? "#f3f4f6" : "#fff", cursor: loading ? "default" : "pointer", fontSize: 13 }}>
          {loading ? t("載入中…") : t("手動刷新")}
        </button>

        <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>
          {t("共")} {rows.length} {t("站")}
        </span>
      </div>

      {err && (
        <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {empty && (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "1px dashed #ddd", borderRadius: 8 }}>
          {t("無站點數據（可能後端 ocpp-admin 或 chargecms-readapi 未部署）")}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <TableHead columns={[t("ID"), t("站名"), t("運營商"), t("地址"), { label: t("樁數"), align: "right" }, { label: t("槍數"), align: "right" }, t("在線/可用/故障"), t("狀態"), t("更新"), t("操作")]} />
            <tbody>
              {rows.map((r) => (
                <tr key={r.stationId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "#666" }}>{r.stationId}</td>
                  <td style={{ padding: "8px 10px", fontWeight: 600 }}>{r.name || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{r.operatorName || "—"}</td>
                  <td style={{ padding: "8px 10px", fontSize: 12, color: "#666", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.address || "—"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{r.pileTotal ?? 0}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{r.connectorTotal ?? 0}</td>
                  <td style={{ padding: "8px 10px", fontSize: 12 }}>
                    <span style={{ color: "#22c55e" }}>{r.onlinePileTotal ?? 0}</span>{" / "}
                    <span style={{ color: "#1976d2" }}>{r.availableConnectorTotal ?? 0}</span>{" / "}
                    <span style={{ color: "#ef4444" }}>{r.faultConnectorTotal ?? 0}</span>
                  </td>
                  <td style={{ padding: "8px 10px" }}><StatusChip status={r.status} t={t} /></td>
                  <td style={{ padding: "8px 10px", fontSize: 12, color: "#888" }}>{fmtTs(r.updatedAt)}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <button onClick={() => setSelectedStationId(r.stationId)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #e5e7eb", background: "#fff", color: "#1976d2", fontSize: 12, cursor: "pointer" }}>
                      {t("詳情")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedStationId && (
        <StationDetailModal
          stationId={selectedStationId}
          accessToken={accessToken}
          onClose={() => setSelectedStationId(null)}
          t={t}
        />
      )}
    </div>
  );
}
