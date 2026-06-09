import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../i18n.jsx";
import OcppLogs from "./OcppLogs.jsx";

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
const FORCE_STOP_STATUSES = new Set(["charging", "suspendedev", "preparing", "occupied"]);

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

function fmtLocalTs(...candidates) {
  for (const raw of candidates) {
    const d = coerceDate(raw);
    if (!d || Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900) continue;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d).reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  }
  const fallback = candidates.find((v) => v != null && v !== "");
  return fallback ? String(fallback) : "—";
}

function fmtNum(n, unit = "", digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(digits)}${unit}`;
}

function firstValue(...values) {
  return values.find((v) => v != null && v !== "" && !Number.isNaN(Number(v)));
}

function fmtPhaseTriplet(row, pascalBase, camelBase, fallbackValues, unit, digits) {
  const phases = [
    firstValue(row[`${pascalBase}L1`], row[`${camelBase}L1`]),
    firstValue(row[`${pascalBase}L2`], row[`${camelBase}L2`]),
    firstValue(row[`${pascalBase}L3`], row[`${camelBase}L3`]),
  ];
  if (phases.some((v) => v != null)) {
    return phases.map((v) => fmtNum(v, "", digits)).join(" / ") + ` ${unit}`;
  }
  return fmtNum(firstValue(...fallbackValues), ` ${unit}`, digits);
}

function scheduleField(row, pascalName) {
  if (!row || !pascalName) return undefined;
  const camelName = pascalName.charAt(0).toLowerCase() + pascalName.slice(1);
  return row[pascalName] ?? row[camelName];
}

function normalizeSchedules(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return list.map((row) => ({
    raw: row,
    scheduleId: scheduleField(row, "ScheduleId"),
    chargePointId: scheduleField(row, "ChargePointId"),
    connectorId: scheduleField(row, "ConnectorId"),
    tagId: scheduleField(row, "TagId"),
    scheduledTime: scheduleField(row, "ScheduledTime"),
    status: scheduleField(row, "Status"),
    result: scheduleField(row, "Result"),
    triggeredAt: scheduleField(row, "TriggeredAt"),
    createdAt: scheduleField(row, "CreatedAt"),
    comment: scheduleField(row, "Comment"),
  }));
}

function scheduleStatusLabel(status, t) {
  const key = String(status || "").trim().toLowerCase();
  const labels = {
    pending: t("待執行"),
    processing: t("執行中"),
    triggered: t("已觸發"),
    failed: t("失敗"),
    cancelled: t("已取消"),
  };
  return labels[key] || status || "—";
}

function scheduleStatusStyle(status) {
  const key = String(status || "").trim().toLowerCase();
  const palette = {
    pending: { bg: "#eff6ff", color: "#2563eb", border: "#bfdbfe" },
    processing: { bg: "#fff7ed", color: "#ea580c", border: "#fed7aa" },
    triggered: { bg: "#ecfdf5", color: "#16a34a", border: "#bbf7d0" },
    failed: { bg: "#fef2f2", color: "#dc2626", border: "#fecaca" },
    cancelled: { bg: "#f3f4f6", color: "#6b7280", border: "#e5e7eb" },
  };
  return palette[key] || palette.cancelled;
}

function defaultScheduleLocalValue() {
  const d = new Date(Date.now() + 15 * 60 * 1000);
  d.setSeconds(0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function minutesUntil(date) {
  const n = Math.ceil((date.getTime() - Date.now()) / 60_000);
  return Math.max(0, n);
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

function ScheduleStartModal({ open, action, onConfirm, onCancel, t, busy }) {
  const [tagId, setTagId] = useState("");
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleLocalValue);

  useEffect(() => {
    if (open) {
      setTagId("");
      setScheduledAt(defaultScheduleLocalValue());
    }
  }, [open]);

  if (!open || !action) return null;
  const trimmed = tagId.trim();
  const target = new Date(scheduledAt);
  const isFuture = scheduledAt && !Number.isNaN(target.getTime()) && target.getTime() > Date.now();
  const id = action.cpId + (action.connectorId != null ? ` / ${action.connectorId}` : "");

  return (
    <div onClick={busy ? undefined : onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: "20px 24px", minWidth: 380, maxWidth: 520, boxShadow: "0 12px 32px rgba(0,0,0,0.2)" }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>{t("預約開始充電")}</h3>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "#555", lineHeight: 1.5 }}>
          {t("在指定時間自動開始充電")}: {id}
        </p>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
          {t("預約時間")}
        </label>
        <input
          type="datetime-local"
          autoFocus
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          disabled={busy}
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 14, marginBottom: 12 }}
        />
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
          {t("Tag（IdTag）")}
        </label>
        <input
          value={tagId}
          onChange={(e) => setTagId(e.target.value)}
          placeholder={t("請輸入 IdTag")}
          disabled={busy}
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 14, marginBottom: 8 }}
        />
        <div style={{ fontSize: 12, color: isFuture ? "#6b7280" : "#dc2626", lineHeight: 1.45, marginBottom: 18 }}>
          {isFuture ? t("測試階段樁端不校驗，任意字串即可") : t("請選擇未來時間")}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} disabled={busy} style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #ddd", background: "#fafafa", cursor: busy ? "default" : "pointer", fontSize: 13 }}>
            {t("取消")}
          </button>
          <button onClick={() => onConfirm({ tagId: trimmed, scheduledAt })} disabled={busy || !trimmed || !isFuture} style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: busy || !trimmed || !isFuture ? "#9ca3af" : "#1976d2", color: "#fff", cursor: busy || !trimmed || !isFuture ? "default" : "pointer", fontSize: 13, fontWeight: 600 }}>
            {busy ? t("處理中…") : t("建立預約")}
          </button>
        </div>
      </div>
    </div>
  );
}

function MonitorSubTabs({ active, onChange, t }) {
  return (
    <div style={{ display: "inline-flex", gap: 4, padding: 4, border: "1px solid #e5e7eb", borderRadius: 8, background: "#f8fafc", marginBottom: 16 }}>
      {[
        ["monitor", t("監控")],
        ["logs", t("OCPP 消息流")],
      ].map(([id, label]) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            style={{
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: isActive ? 700 : 500,
              background: isActive ? "#fff" : "transparent",
              color: isActive ? "#1976d2" : "#64748b",
              boxShadow: isActive ? "0 1px 3px rgba(15,23,42,0.12)" : "none",
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function OcppMonitor({ supabase, session, isAdmin }) {
  const { t } = useT();
  // 全部 hooks 必須在任何 early return 之前聲明，避免 isAdmin 切換時 hook 順序變化
  const [activeSubTab, setActiveSubTab] = useState("monitor");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [toast, setToast] = useState({ message: "", kind: "info" });
  const [pendingAction, setPendingAction] = useState(null);
  const [pendingCancelSchedule, setPendingCancelSchedule] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleErr, setScheduleErr] = useState("");
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

  const refreshSchedules = useCallback(async () => {
    if (!isAdmin || !accessToken) return;
    setScheduleLoading(true);
    setScheduleErr("");
    try {
      const data = await callOcppProxy("/schedule", { method: "GET", accessToken });
      if (!aliveRef.current) return;
      setSchedules(normalizeSchedules(data));
    } catch (e) {
      if (!aliveRef.current) return;
      setScheduleErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setScheduleLoading(false);
    }
  }, [isAdmin, accessToken]);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    return () => { aliveRef.current = false; };
  }, [refresh]);

  useEffect(() => {
    refreshSchedules();
  }, [refreshSchedules]);

  useEffect(() => {
    if (!autoRefresh || !isAdmin) return undefined;
    const id = setInterval(() => {
      refresh();
      refreshSchedules();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, isAdmin, refresh, refreshSchedules]);

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

  const createSchedule = useCallback(async ({ cpId, connectorId, tagId, scheduledAt }) => {
    const target = new Date(scheduledAt);
    if (!scheduledAt || Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) {
      setToast({ message: t("請選擇未來時間"), kind: "error" });
      return;
    }
    setActionBusy(true);
    try {
      await callOcppProxy("/schedule", {
        method: "POST",
        accessToken,
        body: {
          ChargePointId: cpId,
          ConnectorId: connectorId ?? 1,
          TagId: tagId,
          ScheduledTime: target.toISOString(),
        },
      });
      setToast({ message: `${t("已預約，約")} ${minutesUntil(target)} ${t("分鐘後啟動")}`, kind: "ok" });
      setPendingAction(null);
      refreshSchedules();
    } catch (e) {
      setToast({ message: `${t("失敗")}: ${e?.message || e}`, kind: "error" });
    } finally {
      setActionBusy(false);
    }
  }, [accessToken, t, refreshSchedules]);

  const cancelSchedule = useCallback(async (schedule) => {
    const scheduleId = schedule?.scheduleId;
    if (scheduleId == null || scheduleId === "") return;
    setActionBusy(true);
    try {
      await callOcppProxy(`/schedule/${encodeURIComponent(scheduleId)}`, { method: "DELETE", accessToken });
      setToast({ message: t("已取消預約"), kind: "ok" });
      setPendingCancelSchedule(null);
      refreshSchedules();
    } catch (e) {
      setToast({ message: `${t("失敗")}: ${e?.message || e}`, kind: "error" });
    } finally {
      setActionBusy(false);
    }
  }, [accessToken, t, refreshSchedules]);

  // 視圖內部二次兜底：非 admin 進不來（hooks 已全部聲明，這裡是純 render gate）
  if (!isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#999" }}>
        {t("無權訪問")}
      </div>
    );
  }

  const empty = !loading && !err && rows.length === 0;

  if (activeSubTab === "logs") {
    return (
      <div style={{ padding: "16px 20px", maxWidth: 1400 }}>
        <MonitorSubTabs active={activeSubTab} onChange={setActiveSubTab} t={t} />
        <OcppLogs session={session} isAdmin={isAdmin} />
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1400 }}>
      <MonitorSubTabs active={activeSubTab} onChange={setActiveSubTab} t={t} />

      {/* preview / demo banner */}
      <div style={{ background: "#fff7e6", border: "1px solid #ffd58a", color: "#92400e", padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
        <strong>{t("OCPP 監控 · 演示階段")}</strong>{" "}
        {t("此模塊讀取自建 8082 OCPP server（旁路模式），不影響 vendor 8081 生產充電樁通信。當前 chargecms PHP 韌性改造尚未完成，請勿視為穩定的生產功能。")}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t("OCPP 連接狀態")}</h2>
        <button onClick={() => { refresh(); refreshSchedules(); }} disabled={loading || scheduleLoading} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ddd", background: loading || scheduleLoading ? "#f3f4f6" : "#fff", cursor: loading || scheduleLoading ? "default" : "pointer", fontSize: 13 }}>
          {loading ? t("載入中…") : t("手動刷新")}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#666" }}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          {t("每 30 秒自動刷新")}
        </label>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>
          {lastRefresh ? `${t("最後刷新")}: ${fmtLocalTs(lastRefresh)}` : t("尚未刷新")}
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
                {[t("樁 ID"), t("槍號"), t("狀態"), t("功率"), t("電量"), t("電壓三相"), t("電流三相"), t("溫度"), "SoC", t("訂單"), t("Tag"), "TxId", t("最後更新"), t("操作")].map((h) => (
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
                const voltage = fmtPhaseTriplet(r, "Voltage", "voltage", [r.Voltage, r.voltage], "V", 0);
                const current = fmtPhaseTriplet(r, "Current", "current", [r.CurrentImport, r.currentImport, r.Current, r.current], "A", 3);
                const temperature = firstValue(r.Temperature, r.temperature);
                const soc = r.SoC ?? r.Soc;
                const ts = r.TimeStamp ?? r.timestamp;
                const lastUpdate = r.LastUpdate ?? r.lastUpdate;
                const canStop = !!cpId && FORCE_STOP_STATUSES.has(String(status || "").trim().toLowerCase());
                const stopTxId = txId ?? 0;
                const stopTitle = canStop
                  ? (txId != null ? t("讓樁立即停止充電並斷電流輸出") : t("無 OCPP TxId 時會按 0 強制停止"))
                  : t("狀態不適合停止充電");
                const canStart = txId == null && !!cpId && connectorId != null;
                const canSchedule = !!cpId && connectorId != null;
                return (
                  <tr key={`${cpId}:${connectorId}:${idx}`} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{cpId || "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{connectorId ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}><StatusChip status={status} t={t} /></td>
                    <td style={{ padding: "8px 10px" }}>{fmtNum(power, " kW")}</td>
                    <td style={{ padding: "8px 10px" }}>{fmtNum(energy, " kWh", 3)}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{voltage}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{current}</td>
                    <td style={{ padding: "8px 10px" }}>{fmtNum(temperature, " °C", 1)}</td>
                    <td style={{ padding: "8px 10px" }}>{soc != null ? `${soc}%` : "—"}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "#666" }}>{orderId || "—"}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "#666" }}>{tagId || "—"}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "#666" }}>{txId ?? "—"}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12, color: "#888" }}>{fmtLocalTs(ts, lastUpdate)}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      <button title={t("讓樁端 OCPP 通信重啟，不影響物理充電")} onClick={() => setPendingAction({ kind: "reset", cpId, connectorId })} disabled={actionBusy || !cpId} style={btnStyle("#fff", "#374151")}>
                        {t("重啟")}
                      </button>{" "}
                      <button title={t("釋放充電槍電磁鎖讓車主拔槍，僅在樁拒絕釋放時用")} onClick={() => setPendingAction({ kind: "unlock", cpId, connectorId })} disabled={actionBusy || !cpId || connectorId == null} style={btnStyle("#fff", "#374151")}>
                        {t("解鎖充電槍")}
                      </button>{" "}
                      <button onClick={() => setPendingAction({ kind: "start", cpId, connectorId })} disabled={actionBusy || !canStart} title={canStart ? t("讓樁立即開始充電（如果車已接好）") : t("缺少可用槍口或已有交易")} style={btnStyle("#fff", canStart ? "#374151" : "#9ca3af")}>
                        {t("開始充電")}
                      </button>{" "}
                      <button onClick={() => setPendingAction({ kind: "stop", cpId, connectorId, txId: stopTxId })} disabled={actionBusy || !canStop} title={stopTitle} style={btnStyle("#fff", canStop ? "#374151" : "#9ca3af")}>
                        {t("停止充電")}
                      </button>{" "}
                      <button onClick={() => setPendingAction({ kind: "schedule", cpId, connectorId })} disabled={actionBusy || !canSchedule} title={canSchedule ? t("在指定時間自動開始充電") : t("缺少可用槍口")} style={btnStyle("#fff", canSchedule ? "#374151" : "#9ca3af")}>
                        {t("預約開始充電")}
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

      <ScheduleStartModal
        open={pendingAction?.kind === "schedule"}
        action={pendingAction}
        busy={actionBusy}
        onCancel={() => setPendingAction(null)}
        onConfirm={({ tagId, scheduledAt }) => {
          if (!pendingAction) return;
          createSchedule({
            cpId: pendingAction.cpId,
            connectorId: pendingAction.connectorId,
            tagId,
            scheduledAt,
          });
        }}
        t={t}
      />

      <ConfirmModal
        open={!!pendingAction && pendingAction.kind !== "start" && pendingAction.kind !== "schedule"}
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
            // 後端 cmd 名按 vendor 兼容（小寫 stopcharge）；Troy 桩无 TxId 时用 0 force-stop。
            runCommand({ cpId, connectorId, command: "stopcharge", params: { TransactionId: txId } });
          }
        }}
        t={t}
      />

      <div style={{ marginTop: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("預約列表")}</h3>
          <button onClick={refreshSchedules} disabled={scheduleLoading} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ddd", background: scheduleLoading ? "#f3f4f6" : "#fff", cursor: scheduleLoading ? "default" : "pointer", fontSize: 13 }}>
            {scheduleLoading ? t("載入中…") : t("刷新")}
          </button>
        </div>

        {scheduleErr && (
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
            {scheduleErr}
          </div>
        )}

        {!scheduleLoading && !scheduleErr && schedules.length === 0 && (
          <div style={{ padding: 22, textAlign: "center", color: "#888", border: "1px dashed #ddd", borderRadius: 8 }}>
            {t("目前沒有預約")}
          </div>
        )}

        {schedules.length > 0 && (
          <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#fafafa", textAlign: "left" }}>
                  {[t("預約 ID"), t("樁 ID"), t("槍號"), t("Tag"), t("預約時間"), t("建立時間"), t("狀態"), t("結果"), t("觸發時間"), t("備註"), t("操作")].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedules.map((s, idx) => {
                  const statusKey = String(s.status || "").trim().toLowerCase();
                  const canCancel = statusKey === "pending";
                  const palette = scheduleStatusStyle(s.status);
                  return (
                    <tr key={`${s.scheduleId ?? idx}:${idx}`} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{s.scheduleId ?? "—"}</td>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{s.chargePointId || "—"}</td>
                      <td style={{ padding: "8px 10px" }}>{s.connectorId ?? "—"}</td>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{s.tagId || "—"}</td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{fmtLocalTs(s.scheduledTime)}</td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{fmtLocalTs(s.createdAt)}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, background: palette.bg, color: palette.color, border: `1px solid ${palette.border}`, fontSize: 12, fontWeight: 600 }}>
                          {scheduleStatusLabel(s.status, t)}
                        </span>
                      </td>
                      <td style={{ padding: "8px 10px" }}>{s.result || "—"}</td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{fmtLocalTs(s.triggeredAt)}</td>
                      <td style={{ padding: "8px 10px", maxWidth: 240, color: "#666" }}>{s.comment || "—"}</td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        <button onClick={() => setPendingCancelSchedule(s)} disabled={actionBusy || !canCancel} title={canCancel ? t("取消尚未執行的預約") : t("只有待執行的預約可以取消")} style={btnStyle("#fff", canCancel ? "#374151" : "#9ca3af")}>
                          {t("取消預約")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!pendingCancelSchedule}
        busy={actionBusy}
        title={t("取消預約？")}
        body={pendingCancelSchedule ? `${t("此操作只會取消尚未執行的預約")}: #${pendingCancelSchedule.scheduleId}` : ""}
        onCancel={() => setPendingCancelSchedule(null)}
        onConfirm={() => cancelSchedule(pendingCancelSchedule)}
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
    case "stop": return t("確認停止充電？");
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
