import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../i18n.jsx";

// OCPP 監控 — bizflow 主站獨立模塊
// 數據通路：bizflow → Supabase Edge Function `ocpp-proxy` → OCPP 8082 server
// 權限：只有 employees.is_admin = true 的使用者能進（前端 + Edge Function 雙重 gate）

const REFRESH_INTERVAL_MS = 30_000;
const PROXY_PATH = "/ocpp-proxy";
const CONNECTOR_STATUS_BY_CODE = {
  0: "Undefined",
  1: "Available",
  2: "Occupied",
  3: "Unavailable",
  4: "Faulted",
};

async function callOcppProxy(subPath, { method = "GET", accessToken, body } = {}) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !anon) throw new Error("Supabase env missing");
  if (!accessToken) throw new Error("Missing access token");
  const init = {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: anon,
      Authorization: `Bearer ${accessToken}`,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${base}/functions/v1${PROXY_PATH}${subPath}`, init);
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const detail = parsed && typeof parsed === "object" ? parsed.error : parsed;
    throw new Error(`HTTP ${res.status}: ${detail ?? "Unknown error"}`);
  }
  return parsed;
}

// 後端 /API/Status 返回 ChargePointStatus[]，每個元素含 OnlineConnectors 字典
// （key=connectorId, value=OnlineConnectorStatus），需要 flatten 成扁平 connector row。
function normalizeStatusRows(data) {
  if (!Array.isArray(data)) return [];
  return data.flatMap((cp) => {
    const cpId = cp.ChargePointId || cp.chargePointId || cp.id || cp.Id || "";
    const protocol = cp.protocol || cp.Protocol;
    const lastUpdate = cp.lastUpdate ?? cp.LastUpdate ?? cp.LastUpdateUnix ?? cp.last_update ?? null;
    const connectors = cp.OnlineConnectors || cp.onlineConnectors;
    if (!connectors || typeof connectors !== "object" || Object.keys(connectors).length === 0) {
      return [{ ChargePointId: cpId, Protocol: protocol, LastUpdate: lastUpdate }];
    }
    return Object.entries(connectors).map(([key, value]) => ({
      ...(value || {}),
      ChargePointId: (value && value.ChargePointId) || cpId,
      ConnectorId: value && value.ConnectorId != null ? value.ConnectorId : Number(key),
      Protocol: protocol,
      LastUpdate: (value && (value.LastUpdate ?? value.lastUpdate)) ?? lastUpdate,
    }));
  });
}

// txId 可能是 number 或數字字符串，統一 parse 為正整數，否則返 null
function parseTxId(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const n = parseInt(raw, 10);
    return n > 0 ? n : null;
  }
  return null;
}

function normalizeConnectorStatus(status) {
  if (status == null || status === "") return "";
  if (typeof status === "number" && Number.isFinite(status)) {
    return CONNECTOR_STATUS_BY_CODE[status] || String(status);
  }
  if (typeof status === "string" && /^\d+$/.test(status.trim())) {
    const code = Number(status.trim());
    return CONNECTOR_STATUS_BY_CODE[code] || status;
  }
  return String(status);
}

function coerceDate(raw) {
  if (raw == null || raw === "") return null;
  try {
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return new Date(raw > 10_000_000_000 ? raw : raw * 1000);
    }
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      if (/^\d+$/.test(trimmed)) {
        const n = Number(trimmed);
        return new Date(n > 10_000_000_000 ? n : n * 1000);
      }
      return new Date(trimmed);
    }
  } catch {
    return null;
  }
  return null;
}

function fmtTs(...candidates) {
  for (const raw of candidates) {
    const d = coerceDate(raw);
    if (!d || Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900) continue;
    return d.toISOString().replace("T", " ").slice(0, 19);
  }
  const fallback = candidates.find((v) => v != null && v !== "");
  return fallback ? String(fallback) : "—";
}

function fmtNum(n, unit = "", digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(digits)}${unit}`;
}

function StatusChip({ status, t }) {
  const palette = {
    Available: { bg: "#e8f5e9", color: "#22c55e", border: "#a5d6a7" },
    Occupied: { bg: "#fff8e1", color: "#f59e0b", border: "#ffe082" },
    Charging: { bg: "#e3f2fd", color: "#1976d2", border: "#90caf9" },
    SuspendedEV: { bg: "#e3f2fd", color: "#1976d2", border: "#90caf9" },
    SuspendedEVSE: { bg: "#e3f2fd", color: "#1976d2", border: "#90caf9" },
    Faulted: { bg: "#ffebee", color: "#ef4444", border: "#ffcdd2" },
    Unavailable: { bg: "#eceff1", color: "#607d8b", border: "#cfd8dc" },
  };
  const c = palette[status] || palette.Unavailable;
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, background: c.bg, color: c.color, border: `1px solid ${c.border}`, fontSize: 12, fontWeight: 600 }}>
      {status || t("未知")}
    </span>
  );
}

function Toast({ message, kind, onClose }) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onClose, 4000);
    return () => clearTimeout(id);
  }, [message, onClose]);
  if (!message) return null;
  const bg = kind === "error" ? "#ef4444" : kind === "ok" ? "#22c55e" : "#374151";
  return (
    <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: bg, color: "#fff", padding: "10px 18px", borderRadius: 6, zIndex: 1000, fontSize: 14, fontWeight: 500, boxShadow: "0 4px 12px rgba(0,0,0,0.18)" }}>
      {message}
    </div>
  );
}

function ConfirmModal({ open, title, body, onConfirm, onCancel, t, busy }) {
  if (!open) return null;
  return (
    <div onClick={busy ? undefined : onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: "20px 24px", minWidth: 340, maxWidth: 480, boxShadow: "0 12px 32px rgba(0,0,0,0.2)" }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>{title}</h3>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "#555", lineHeight: 1.5 }}>{body}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} disabled={busy} style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #ddd", background: "#fafafa", cursor: busy ? "default" : "pointer", fontSize: 13 }}>
            {t("取消")}
          </button>
          <button onClick={onConfirm} disabled={busy} style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: busy ? "#9ca3af" : "#1976d2", color: "#fff", cursor: busy ? "default" : "pointer", fontSize: 13, fontWeight: 600 }}>
            {busy ? t("處理中…") : t("確認")}
          </button>
        </div>
      </div>
    </div>
  );
}

function RemoteStartModal({ open, action, onConfirm, onCancel, t, busy }) {
  const [tagId, setTagId] = useState("");

  useEffect(() => {
    if (open) setTagId("");
  }, [open]);

  if (!open || !action) return null;
  const trimmed = tagId.trim();
  const id = action.cpId + (action.connectorId != null ? ` / ${action.connectorId}` : "");

  return (
    <div onClick={busy ? undefined : onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: "20px 24px", minWidth: 360, maxWidth: 500, boxShadow: "0 12px 32px rgba(0,0,0,0.2)" }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>{t("確認遠程啟動充電？")}</h3>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "#555", lineHeight: 1.5 }}>
          {t("將下發遠程啟動指令（OCPP RemoteStartTransaction）")}: {id}
        </p>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
          {t("Tag（IdTag）")}
        </label>
        <input
          autoFocus
          value={tagId}
          onChange={(e) => setTagId(e.target.value)}
          placeholder={t("請輸入 IdTag")}
          disabled={busy}
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 14, marginBottom: 8 }}
        />
        <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.45, marginBottom: 18 }}>
          {t("測試階段樁端不校驗，任意字串即可")}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} disabled={busy} style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #ddd", background: "#fafafa", cursor: busy ? "default" : "pointer", fontSize: 13 }}>
            {t("取消")}
          </button>
          <button onClick={() => onConfirm(trimmed)} disabled={busy || !trimmed} style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: busy || !trimmed ? "#9ca3af" : "#1976d2", color: "#fff", cursor: busy || !trimmed ? "default" : "pointer", fontSize: 13, fontWeight: 600 }}>
            {busy ? t("處理中…") : t("確認")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OcppMonitor({ supabase, session, isAdmin }) {
  const { t } = useT();
  // 全部 hooks 必須在任何 early return 之前聲明，避免 isAdmin 切換時 hook 順序變化
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [toast, setToast] = useState({ message: "", kind: "info" });
  const [pendingAction, setPendingAction] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const aliveRef = useRef(true);

  const accessToken = session?.access_token;

  const refresh = useCallback(async () => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const data = await callOcppProxy("/status", { method: "GET", accessToken });
      if (!aliveRef.current) return;
      setRows(normalizeStatusRows(data));
      setLastRefresh(new Date());
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

  useEffect(() => {
    if (!autoRefresh || !isAdmin) return undefined;
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, isAdmin, refresh]);

  const runCommand = useCallback(async ({ cpId, connectorId, command, params }) => {
    setActionBusy(true);
    try {
      const subPath = `/cmd/${encodeURIComponent(command)}/${encodeURIComponent(cpId)}`;
      // 後端 (OCPPMiddleware.OCPP16.cs) 讀的是 root["params"]["..."]，必須包一層 params
      const body = { params: { ConnectorId: connectorId, ...(params || {}) } };
      await callOcppProxy(subPath, { method: "POST", accessToken, body });
      setToast({ message: t("已下發指令"), kind: "ok" });
      setTimeout(refresh, 800);
    } catch (e) {
      setToast({ message: `${t("失敗")}: ${e?.message || e}`, kind: "error" });
    } finally {
      setActionBusy(false);
      setPendingAction(null);
    }
  }, [accessToken, t, refresh]);

  // 視圖內部二次兜底：非 admin 進不來（hooks 已全部聲明，這裡是純 render gate）
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
      {/* preview / demo banner */}
      <div style={{ background: "#fff7e6", border: "1px solid #ffd58a", color: "#92400e", padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
        <strong>{t("OCPP 監控 · 演示階段")}</strong>{" "}
        {t("此模塊讀取自建 8082 OCPP server（旁路模式），不影響 vendor 8081 生產充電樁通信。當前 chargecms PHP 韌性改造尚未完成，請勿視為穩定的生產功能。")}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t("OCPP 連接狀態")}</h2>
        <button onClick={refresh} disabled={loading} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ddd", background: loading ? "#f3f4f6" : "#fff", cursor: loading ? "default" : "pointer", fontSize: 13 }}>
          {loading ? t("載入中…") : t("手動刷新")}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#666" }}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          {t("每 30 秒自動刷新")}
        </label>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>
          {lastRefresh ? `${t("最後刷新")}: ${fmtTs(lastRefresh)}` : t("尚未刷新")}
        </span>
      </div>

      {err && (
        <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {empty && (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "1px dashed #ddd", borderRadius: 8 }}>
          {t("目前無真樁連入（Phase C simulator 啟用後可見 demo 數據）")}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa", textAlign: "left" }}>
                {[t("樁 ID"), t("槍號"), t("狀態"), t("功率"), t("電量"), t("電壓"), t("電流"), "SoC", t("訂單"), t("Tag"), "TxId", t("最後更新"), t("操作")].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const cpId = r.ChargePointId || r.chargePointId || "";
                const connectorId = r.ConnectorId ?? r.connectorId ?? null;
                const orderId = r.Order_Id || r.OrderId || r.order_id || "";
                const tagId = r.TagId || r.tagId || "";
                const txId = parseTxId(r.TransactionId ?? r.transactionId);
                const status = normalizeConnectorStatus(r.Status ?? r.status ?? "");
                const power = r.PowerActiveImport ?? r.Power ?? r.ChargeRateKW;
                const energy = r.EnergyActiveImportRegister ?? r.Energy ?? r.MeterKWH;
                const voltage = r.Voltage;
                const current = r.CurrentImport ?? r.Current;
                const soc = r.SoC ?? r.Soc;
                const ts = r.TimeStamp ?? r.timestamp;
                const lastUpdate = r.LastUpdate ?? r.lastUpdate;
                const canStop = txId != null;
                const canStart = txId == null && !!cpId && connectorId != null;
                return (
                  <tr key={`${cpId}:${connectorId}:${idx}`} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{cpId || "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{connectorId ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}><StatusChip status={status} t={t} /></td>
                    <td style={{ padding: "8px 10px" }}>{fmtNum(power, " kW")}</td>
                    <td style={{ padding: "8px 10px" }}>{fmtNum(energy, " kWh", 3)}</td>
                    <td style={{ padding: "8px 10px" }}>{fmtNum(voltage, " V", 1)}</td>
                    <td style={{ padding: "8px 10px" }}>{fmtNum(current, " A", 1)}</td>
                    <td style={{ padding: "8px 10px" }}>{soc != null ? `${soc}%` : "—"}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "#666" }}>{orderId || "—"}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "#666" }}>{tagId || "—"}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "#666" }}>{txId ?? "—"}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12, color: "#888" }}>{fmtTs(ts, lastUpdate)}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      <button onClick={() => setPendingAction({ kind: "reset", cpId, connectorId })} disabled={actionBusy || !cpId} style={btnStyle("#fff", "#374151")}>
                        {t("重啟")}
                      </button>{" "}
                      <button onClick={() => setPendingAction({ kind: "unlock", cpId, connectorId })} disabled={actionBusy || !cpId || connectorId == null} style={btnStyle("#fff", "#374151")}>
                        {t("解鎖")}
                      </button>{" "}
                      <button onClick={() => setPendingAction({ kind: "start", cpId, connectorId })} disabled={actionBusy || !canStart} title={canStart ? "" : t("缺少可用槍口或已有交易")} style={btnStyle("#fff", canStart ? "#374151" : "#9ca3af")}>
                        {t("遠程啟動")}
                      </button>{" "}
                      <button onClick={() => setPendingAction({ kind: "stop", cpId, connectorId, txId })} disabled={actionBusy || !canStop} title={canStop ? "" : t("缺少 OCPP TransactionId")} style={btnStyle("#fff", canStop ? "#374151" : "#9ca3af")}>
                        {t("遠程停止")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <RemoteStartModal
        open={pendingAction?.kind === "start"}
        action={pendingAction}
        busy={actionBusy}
        onCancel={() => setPendingAction(null)}
        onConfirm={(tagId) => {
          if (!pendingAction) return;
          runCommand({
            cpId: pendingAction.cpId,
            connectorId: pendingAction.connectorId,
            command: "startcharge",
            params: { TagId: tagId },
          });
        }}
        t={t}
      />

      <ConfirmModal
        open={!!pendingAction && pendingAction.kind !== "start"}
        busy={actionBusy}
        title={pendingAction ? confirmTitle(pendingAction, t) : ""}
        body={pendingAction ? confirmBody(pendingAction, t) : ""}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (!pendingAction) return;
          const { kind, cpId, connectorId, txId } = pendingAction;
          if (kind === "reset") {
            runCommand({ cpId, connectorId, command: "Reset", params: { Type: "Soft" } });
          } else if (kind === "unlock") {
            runCommand({ cpId, connectorId, command: "UnlockConnector" });
          } else if (kind === "stop") {
            // 後端 cmd 名按 vendor 兼容（小寫 stopcharge），TransactionId 必須是 OCPP 數字 id
            runCommand({ cpId, connectorId, command: "stopcharge", params: { TransactionId: txId } });
          }
        }}
        t={t}
      />

      <Toast message={toast.message} kind={toast.kind} onClose={() => setToast({ message: "", kind: "info" })} />
    </div>
  );
}

function btnStyle(bg, color) {
  return {
    padding: "4px 10px",
    borderRadius: 4,
    border: "1px solid #e5e7eb",
    background: bg,
    color,
    fontSize: 12,
    cursor: color === "#9ca3af" ? "default" : "pointer",
  };
}

function confirmTitle(action, t) {
  switch (action.kind) {
    case "reset": return t("確認重啟充電樁？");
    case "unlock": return t("確認解鎖槍口？");
    case "stop": return t("確認遠程停止充電？");
    default: return t("確認");
  }
}

function confirmBody(action, t) {
  const id = action.cpId + (action.connectorId != null ? ` / ${action.connectorId}` : "");
  switch (action.kind) {
    case "reset": return `${t("將對充電樁下發 Soft Reset 指令")}: ${id}`;
    case "unlock": return `${t("將對該槍口下發解鎖指令")}: ${id}`;
    case "stop": return `${t("將停止當前充電訂單（TxId）")}: ${id} #${action.txId}`;
    default: return id;
  }
}
