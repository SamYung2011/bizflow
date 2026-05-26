// OCPP admin API helper — bizflow 主站 → Supabase Edge Function `ocpp-admin` → ECS chargecms-readapi 8084
// 共用於 src/views/ocpp/* 各 sub-tab（PublicPiles / PrivatePiles / Stations / AlarmInfo / OcppMonitor）

const PROXY_PATH = "/ocpp-admin";

export async function callOcppAdmin(subPath, { accessToken } = {}) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !anon) throw new Error("Supabase env missing");
  if (!accessToken) throw new Error("Missing access token");
  const res = await fetch(`${base}/functions/v1${PROXY_PATH}${subPath}`, {
    method: "GET",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    // supabase 邊緣 runtime 錯誤用 `msg` 字段（如 InvalidWorkerCreation 表示 function 未部署）；
    // 自家 edge function 返 flat `{ error: "..." }`。兩種都兜底
    const detail = parsed && typeof parsed === "object" ? (parsed.error ?? parsed.msg) : parsed;
    throw new Error(`HTTP ${res.status}: ${detail ?? "Unknown error"}`);
  }
  return parsed;
}

const HK_TS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Hong_Kong",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function fmtUnixTs(ts, { dateOnly = false } = {}) {
  if (!ts) return "—";
  try {
    const d = new Date(Number(ts) * 1000); // chargecms 用 Unix timestamp（秒）
    if (Number.isNaN(d.getTime())) return String(ts);
    const parts = HK_TS_FORMATTER.formatToParts(d);
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    if (dateOnly) return date;
    return `${date} ${get("hour")}:${get("minute")}:${get("second")}`;
  } catch { return String(ts); }
}
