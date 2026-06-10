import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../lib/ocppAdmin.js";

// 報警信息 — chargecms rc_alarm 表持久化告警
// Reads `/api/alarms` through the admin-only ocpp-admin Edge Function.
// v0.1：只讀 rc_alarm 歷史告警；當下實時故障在 PublicPiles / PrivatePiles 用 status chip 突顯

export default function AlarmInfo({ session, isAdmin, active = true }) {
  const { t } = useT();
  const [alarms, setAlarms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [sinceHours, setSinceHours] = useState(24);
  const aliveRef = useRef(true);
  const wasActiveRef = useRef(active);
  const accessToken = session?.access_token;

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams({ limit: "200" });
      if (search.trim()) qs.set("q", search.trim());
      qs.set("since", sinceHours === 0 ? "all" : String(sinceHours));
      const res = await callOcppAdmin(`/alarms?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setAlarms(res?.data || []);
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, search, sinceHours]);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    return () => { aliveRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, accessToken, sinceHours]);

  useEffect(() => {
    if (active && !wasActiveRef.current) refresh();
    wasActiveRef.current = active;
  }, [active, refresh]);

  if (!isAdmin) return null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("報警信息")}</h3>
        <select
          value={sinceHours}
          onChange={(e) => setSinceHours(Number(e.target.value))}
          aria-label={t("時間範圍")}
          style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, background: "#fff" }}
        >
          <option value={24}>{t("最近 24 小時")}</option>
          <option value={168}>{t("最近 7 天")}</option>
          <option value={720}>{t("最近 30 天")}</option>
          <option value={0}>{t("全部")}</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") refresh(); }}
          placeholder={t("搜索樁編號 / 報警內容 / 站點")}
          style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, minWidth: 280 }}
        />
        <button onClick={() => refresh({ force: true })} disabled={loading} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ddd", background: loading ? "#f3f4f6" : "#fff", cursor: loading ? "default" : "pointer", fontSize: 13 }}>
          {loading ? t("載入中…") : t("刷新")}
        </button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>
          {t("共")} {alarms.length} {t("條")}
        </span>
      </div>

      <div style={{ background: "#fff7e6", border: "1px solid #ffd58a", color: "#92400e", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
        {t("此列表為 chargecms rc_alarm 表的歷史持久化告警。當下實時故障（離線桩 / 故障槍口）請看「充電桩」tab 內的狀態標識。")}
      </div>

      {err && (
        <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {!loading && !err && alarms.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "1px dashed #ddd", borderRadius: 8 }}>
          {t("無報警記錄")}
        </div>
      )}

      {alarms.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa", textAlign: "left" }}>
                {[t("時間"), t("類型"), t("樁編號"), t("站點"), t("運營商"), t("內容")].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {alarms.map((a) => (
                <tr key={a.alarmId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 10px", fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>{fmtUnixTs(a.createdAt)}</td>
                  <td style={{ padding: "8px 10px" }}>{a.type ?? "—"}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{a.pileNo || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{a.stationName || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{a.operatorName || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{a.content || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
