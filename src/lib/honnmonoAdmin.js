// BizFlow browser -> HK Supabase Edge Function `honnmono-admin`.
// JSON always uses this bridge. Only the short-lived log URL returned by the
// bridge is downloaded directly from Shenzhen.

const PROXY_PATH = "/honnmono-admin";


export async function callHonnmonoAdmin(
  subPath,
  { accessToken, method = "GET" } = {},
) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !anon) throw new Error("Supabase env missing");
  if (!accessToken) throw new Error("Missing access token");
  if (!["GET", "POST"].includes(method)) throw new Error("Unsupported method");

  const response = await fetch(`${base}/functions/v1${PROXY_PATH}${subPath}`, {
    method,
    cache: "no-store",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const detail = parsed && typeof parsed === "object"
      ? (parsed.error ?? parsed.detail ?? parsed.msg)
      : parsed;
    throw new Error(`HTTP ${response.status}: ${detail ?? "Unknown error"}`);
  }
  return parsed;
}


export function formatFeedbackTime(value, lang = "zh") {
  if (value == null || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return String(value);
  const locale = lang === "fr" ? "fr-FR" : lang === "en" ? "en-GB" : "zh-HK";
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
