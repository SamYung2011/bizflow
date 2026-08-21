import { getSession, getSupabaseClient } from "../data/auth.js";

const EDGE_FUNCTION = "honnmono-admin";
const ALLOWED_REQUESTS = [
  { method: "GET", path: /^\/feedback(?:\?[^#]*)?$/ },
  { method: "GET", path: /^\/feedback\/[1-9]\d*$/ },
  { method: "POST", path: /^\/feedback\/[1-9]\d*\/log-link$/ },
  { method: "GET", path: /^\/device\/binding\?imei=\d{15}$/ },
  { method: "POST", path: /^\/device\/unbind$/ },
  { method: "GET", path: /^\/ota\/package$/ },
  { method: "POST", path: /^\/ota\/package$/ },
  { method: "GET", path: /^\/ota\/legacy-packages$/ },
  { method: "POST", path: /^\/ota\/legacy-packages\/(150001|150002|150003|150004)$/ },
  { method: "GET", path: /^\/devices\/(flash|dc-pro)(?:\?[^#]*)?$/ },
  { method: "GET", path: /^\/devices\/(flash|dc-pro)\/[A-Za-z0-9_-]{1,64}\/sessions(?:\?[^#]*)?$/ },
  { method: "GET", path: /^\/devices\/flash\/[A-Za-z0-9_-]{1,64}\/uploads\/[1-9]\d*$/ },
  { method: "POST", path: /^\/devices\/flash\/[A-Za-z0-9_-]{1,64}\/actions$/ },
  { method: "POST", path: /^\/devices\/flash\/[A-Za-z0-9_-]{1,64}\/unbind$/ },
];

export class HonnmonoAdminError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = "HonnmonoAdminError";
    this.code = code;
    this.status = status;
  }
}

export function assertHonnmonoAdminRequest(subPath, method = "GET") {
  const normalizedMethod = String(method).toUpperCase();
  if (
    !ALLOWED_REQUESTS.some(
      (rule) =>
        rule.method === normalizedMethod && rule.path.test(String(subPath)),
    )
  ) {
    throw new HonnmonoAdminError("requestError");
  }
}

async function edgeContext() {
  const [session, client] = await Promise.all([
    getSession(),
    getSupabaseClient(),
  ]);
  if (!session?.user || !session.access_token) {
    throw new HonnmonoAdminError("authError", 401);
  }
  if (!client?.supabaseUrl || !client?.supabaseKey) {
    throw new HonnmonoAdminError("configError");
  }
  return {
    accessToken: session.access_token,
    anonKey: client.supabaseKey,
    baseUrl: String(client.supabaseUrl).replace(/\/$/, ""),
  };
}

export async function callHonnmonoAdmin(
  subPath,
  { method = "GET", signal, body } = {},
) {
  const normalizedMethod = String(method).toUpperCase();
  assertHonnmonoAdminRequest(subPath, normalizedMethod);
  if (
    body != null &&
    (normalizedMethod !== "POST" ||
      typeof body !== "object" ||
      Array.isArray(body))
  ) {
    throw new HonnmonoAdminError("requestError");
  }
  const context = await edgeContext();
  const serializedBody = body == null ? undefined : JSON.stringify(body);
  const response = await fetch(
    `${context.baseUrl}/functions/v1/${EDGE_FUNCTION}${subPath}`,
    {
      method: normalizedMethod,
      cache: "no-store",
      signal,
      headers: {
        apikey: context.anonKey,
        Authorization: `Bearer ${context.accessToken}`,
        ...(serializedBody ? { "Content-Type": "application/json" } : {}),
      },
      body: serializedBody,
    },
  );
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new HonnmonoAdminError("responseError", response.status);
  }
  if (!response.ok) {
    const backendCode = parsed?.detail?.code;
    const allowedBackendCodes = new Set([
      "imei_ambiguous",
      "binding_changed",
      "device_charging",
      "device_not_found",
    ]);
    throw new HonnmonoAdminError(
      allowedBackendCodes.has(backendCode) ? backendCode : "upstreamError",
      response.status,
    );
  }
  if (parsed == null || typeof parsed !== "object") {
    throw new HonnmonoAdminError("responseError", response.status);
  }
  return parsed;
}

export function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      return "";
    }
    return parsed.href;
  } catch {
    return "";
  }
}

export function normalizeFeedbackLogStatus(row) {
  if (row?.logStatus === "available") return "available";
  if (
    row?.logStatus === "external" &&
    safeHttpUrl(row.logExternalUrl)
  ) {
    return "external";
  }
  return "expired";
}

export function formatFeedbackTime(value, lang = "zh") {
  if (value == null || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return String(value);
  const locale =
    lang === "fr" ? "fr-FR" : lang === "en" ? "en-GB" : "zh-HK";
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
