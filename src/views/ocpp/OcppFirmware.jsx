import React, { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../lib/ocppAdmin.js";
import { Pager } from "./finance/financeShared.jsx";

// 韌體（firmware）— chargecms 表 rc_firmware 唯讀清單。
// PHP `admin/extend/firmware` controller 後台菜單未掛（rc_auth_rule 無 extend/firmware 記錄）+ 生產 0 行 + rc_attachment 無相關韌體文件附件
// （2026-06-03 ssh 實查）。入口先搭好，與 OcppMonitor remote upgrade 命令鏈路解耦；
// 後續若 BizFlow 自帶韌體分發，再在此表挂上傳/分發/下發功能即可。
// 零寫入 / 不發 OCPP 命令 / 不動 vendor 8081 / 不動 chargecms PHP。

function hkDateStartTs(date) {
  const ts = Math.floor(new Date(`${date}T00:00:00+08:00`).getTime() / 1000);
  return Number.isFinite(ts) ? ts : null;
}

const LIMIT_OPTIONS = [50, 100, 200];

export default function OcppFirmware({ session, isAdmin }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filterQ, setFilterQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [pageLimit, setPageLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const aliveRef = useRef(true);

  const accessToken = session?.access_token;

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (filterQ) qs.set("q", filterQ);
      if (filterDateFrom) {
        const ts = hkDateStartTs(filterDateFrom);
        if (Number.isFinite(ts) && ts > 0) qs.set("from", String(ts));
      }
      if (filterDateTo) {
        const ts = hkDateStartTs(filterDateTo);
        if (Number.isFinite(ts) && ts > 0) qs.set("to", String(ts + 86400 - 1));
      }
      qs.set("limit", String(pageLimit));
      qs.set("offset", String(offset));
      const data = await callOcppAdmin(`/firmware?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
      setHasMore(Boolean(data?.page?.hasMore));
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, filterQ, filterDateFrom, filterDateTo, pageLimit, offset]);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
        <strong>{t("韌體管理 · 演示階段")}</strong>{" "}
        {t("此列表讀 chargecms 表 rc_firmware；目前生產 0 條韌體記錄、PHP 後台亦未掛此模組菜單。入口已搭好，後續若 BizFlow 自帶韌體分發再接寫入與下發。只讀，零寫入。")}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("韌體管理")}</h3>

        <label style={{ fontSize: 12, color: "#666" }}>
          {t("日期從")}{" "}
          <input type="date" value={filterDateFrom} onChange={(e) => { setOffset(0); setFilterDateFrom(e.target.value); }} style={{ padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 12, color: "#666" }}>
          {t("日期到")}{" "}
          <input type="date" value={filterDateTo} onChange={(e) => { setOffset(0); setFilterDateTo(e.target.value); }} style={{ padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }} />
        </label>

        <select
          value={pageLimit}
          onChange={(e) => { setOffset(0); setPageLimit(Number(e.target.value)); }}
          style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}
        >
          {LIMIT_OPTIONS.map((n) => <option key={n} value={n}>{n} / {t("頁")}</option>)}
        </select>

        <form
          onSubmit={(e) => { e.preventDefault(); setOffset(0); setFilterQ(searchInput.trim()); }}
          style={{ display: "flex", gap: 6 }}
        >
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("名稱 / 版本")}
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
          {t("本頁")} {rows.length} {t("條")}
        </span>
      </div>

      {err && (
        <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {empty && (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "1px dashed #ddd", borderRadius: 8 }}>
          {t("無韌體記錄")}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555", textAlign: "right" }}>{t("ID")}</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555", textAlign: "left" }}>{t("名稱")}</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555", textAlign: "left" }}>{t("版本")}</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555", textAlign: "left" }}>{t("文件路徑")}</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555", textAlign: "left" }}>{t("建立時間")}</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555", textAlign: "left" }}>{t("更新時間")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.firmwareId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace", color: "#666" }}>{r.firmwareId}</td>
                  <td style={{ padding: "8px 10px" }}>{r.name || "—"}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{r.version || "—"}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "#666", wordBreak: "break-all", maxWidth: 360 }}>{r.file || "—"}</td>
                  <td style={{ padding: "8px 10px", fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>{fmtUnixTs(r.createdAt)}</td>
                  <td style={{ padding: "8px 10px", fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>{fmtUnixTs(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <Pager
          offset={offset}
          pageLimit={pageLimit}
          count={rows.length}
          hasMore={hasMore}
          loading={loading}
          onPrev={() => setOffset((o) => Math.max(0, o - pageLimit))}
          onNext={() => setOffset((o) => o + pageLimit)}
        />
      )}
    </div>
  );
}
