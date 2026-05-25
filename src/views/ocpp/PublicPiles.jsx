import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin } from "../../lib/ocppAdmin.js";

// 公共充電桩 — 扁平桩列表（HK 13 + 屯門 2 = 15 桩）
// v0.1：前端聚合 /api/stations 列表 + 各 station detail 拿 piles
// 後期如果加站點變多，可請澄川加專用 /api/public-piles endpoint
// 故障突顯：fault_connector_count > 0 或 online_status = 0 用紅色 highlight，配合 alarm tab

const FAULT_STATE_THRESHOLD = 6;

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

export default function PublicPiles({ session, isAdmin }) {
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
      const stationsRes = await callOcppAdmin("/stations?limit=200", { accessToken });
      const stations = stationsRes?.data || [];
      const details = await Promise.all(
        stations.map((s) =>
          callOcppAdmin(`/stations/${s.stationId}`, { accessToken }).then(
            (res) => ({ station: s, detail: res?.data }),
            (e) => ({ station: s, error: String(e?.message || e) })
          )
        )
      );
      if (!aliveRef.current) return;
      const flat = [];
      for (const item of details) {
        const stationPiles = item.detail?.piles || [];
        for (const p of stationPiles) {
          const faultCount = (p.connectors || []).filter((c) => (c.state ?? 0) >= FAULT_STATE_THRESHOLD).length;
          flat.push({
            ...p,
            stationId: item.station.stationId,
            stationName: item.station.name,
            operatorName: item.station.operatorName,
            faultConnectorCount: faultCount,
            connectorCount: (p.connectors || []).length,
          });
        }
      }
      setPiles(flat);
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken]);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    return () => { aliveRef.current = false; };
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return piles;
    return piles.filter((p) =>
      (p.pileNo || "").toLowerCase().includes(q) ||
      (p.name || "").toLowerCase().includes(q) ||
      (p.vendor || "").toLowerCase().includes(q) ||
      (p.stationName || "").toLowerCase().includes(q)
    );
  }, [piles, search]);

  if (!isAdmin) return null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("公共充電桩")}</h3>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("搜索桩編號 / 名稱 / 品牌 / 站點")}
          style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, minWidth: 280 }}
        />
        <button onClick={refresh} disabled={loading} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ddd", background: loading ? "#f3f4f6" : "#fff", cursor: loading ? "default" : "pointer", fontSize: 13 }}>
          {loading ? t("載入中…") : t("刷新")}
        </button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>
          {t("共")} {filtered.length} {t("桩")}
        </span>
      </div>

      {err && (
        <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {!loading && !err && filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "1px dashed #ddd", borderRadius: 8 }}>
          {t("無數據")}
        </div>
      )}

      {filtered.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa", textAlign: "left" }}>
                {[t("樁編號"), t("名稱"), t("品牌"), t("型號"), t("固件"), t("所屬站點"), t("運營商"), t("狀態"), t("槍數")].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.pileId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{p.pileNo || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{p.name || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{p.vendor || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{p.model || "—"}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "#666" }}>{p.firmwareVersion || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{p.stationName || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{p.operatorName || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <PileStatusChip onlineStatus={p.onlineStatus} faultCount={p.faultConnectorCount} t={t} />
                  </td>
                  <td style={{ padding: "8px 10px" }}>{p.connectorCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
