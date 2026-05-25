import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin } from "../../lib/ocppAdmin.js";

// 私人充電桩 — chargecms station_id=0 AND is_share=1 AND status=normal 的 15 桩
// Reads `/api/private-piles` through the admin-only ocpp-admin Edge Function.
// 故障突顯：fault_connector_count > 0 或 online_status = 0 用紅色 highlight

function PileStatusChip({ onlineStatus, faultCount, t }) {
  if (onlineStatus === 0) {
    return <span style={chipStyle("#ffebee", "#ef4444", "#ffcdd2")}>{t("離線")}</span>;
  }
  if (faultCount > 0) {
    return <span style={chipStyle("#fff3e0", "#f57c00", "#ffcc80")}>{t("故障")} {faultCount}</span>;
  }
  return <span style={chipStyle("#e8f5e9", "#22c55e", "#a5d6a7")}>{t("在線")}</span>;
}

function chipStyle(bg, color, border) {
  return {
    display: "inline-block", padding: "2px 8px", borderRadius: 999,
    background: bg, color, border: `1px solid ${border}`,
    fontSize: 12, fontWeight: 600,
  };
}

export default function PrivatePiles({ session, isAdmin }) {
  const { t } = useT();
  const [piles, setPiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const aliveRef = useRef(true);
  const accessToken = session?.access_token;

  const refresh = useCallback(async () => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams({ limit: "200" });
      if (search.trim()) qs.set("q", search.trim());
      const res = await callOcppAdmin(`/private-piles?${qs}`, { accessToken });
      if (!aliveRef.current) return;
      setPiles(res?.data || []);
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, search]);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    return () => { aliveRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, accessToken]);

  if (!isAdmin) return null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("私人充電桩")}</h3>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") refresh(); }}
          placeholder={t("搜索桩編號 / 名稱 / 序列號")}
          style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, minWidth: 280 }}
        />
        <button onClick={refresh} disabled={loading} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ddd", background: loading ? "#f3f4f6" : "#fff", cursor: loading ? "default" : "pointer", fontSize: 13 }}>
          {loading ? t("載入中…") : t("刷新")}
        </button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>
          {t("共")} {piles.length} {t("桩")}
        </span>
      </div>

      {err && (
        <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {!loading && !err && piles.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "1px dashed #ddd", borderRadius: 8 }}>
          {t("無數據")}
        </div>
      )}

      {piles.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa", textAlign: "left" }}>
                {[t("樁編號"), t("名稱"), t("品牌"), t("型號"), t("序列號"), t("固件"), t("運營商"), t("狀態"), t("槍數")].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {piles.map((p) => (
                <tr key={p.pileId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{p.pileNo || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{p.name || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{p.vendor || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{p.model || "—"}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "#666" }}>{p.serial || "—"}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "#666" }}>{p.firmwareVersion || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{p.operatorName || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <PileStatusChip onlineStatus={p.onlineStatus} faultCount={p.faultConnectorTotal} t={t} />
                  </td>
                  <td style={{ padding: "8px 10px" }}>{p.connectorTotal ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
