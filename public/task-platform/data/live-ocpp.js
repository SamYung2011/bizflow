import { getSession, getSupabaseClient } from "./auth.js";

// Mirrors bizflow_samyung/src/lib/ocppAdmin.js: GET-only Edge transport,
// token-scoped 45s response cache, and in-flight request de-duplication.

export const LIVE_OCPP_MISS = Symbol("live-ocpp-miss");

const CACHE_TTL_MS = 45_000;
const PAGE_LIMIT = 200;
const LOG_WINDOW_SECONDS = 86_400;
const LOG_DAYS = 7;
const LOG_CONCURRENCY = 6;
const responseCache = new Map();
const inflightRequests = new Map();
let cacheUserId = "";

const READ_ONLY_PATHS = [
  /^\/piles(?:\?|$)/,
  /^\/stations(?:\?|$)/,
  /^\/stations\/[1-9]\d*(?:\?|$)/,
  /^\/operators(?:\?|$)/,
  /^\/orders(?:\?|$)/,
  /^\/charge-users(?:\?|$)/,
  /^\/charge-user-tags(?:\?|$)/,
  /^\/alarms(?:\?|$)/,
  /^\/command-logs(?:\?|$)/,
  /^\/reports\/charging(?:\?|$)/,
  /^\/share\/charges(?:\?|$)/,
  /^\/share\/prices\/[1-9]\d*(?:\?|$)/,
  /^\/share\/income(?:\?|$)/,
  /^\/share\/bookings(?:\?|$)/,
  /^\/finance\/(?:recharges|refunds|user-money-logs|operator-money-logs|platform-money-logs|withdrawals)(?:\?|$)/,
  /^\/ocpp\/logs(?:\?|$)/
];

function assertReadOnlyPath(subPath) {
  if (!READ_ONLY_PATHS.some((pattern) => pattern.test(subPath))) {
    throw new Error(`OCPP live reader rejects non-read path: ${subPath}`);
  }
}

function resetCacheForUser(userId) {
  if (cacheUserId === userId) return;
  cacheUserId = userId;
  responseCache.clear();
  inflightRequests.clear();
}

async function edgeContext() {
  const session = await getSession();
  if (!session) return null;
  const client = await getSupabaseClient();
  if (!client?.supabaseUrl || !client?.supabaseKey || !session.access_token) {
    throw new Error("Supabase OCPP reader is not configured");
  }
  resetCacheForUser(session.user.id);
  return {
    accessToken: session.access_token,
    anonKey: client.supabaseKey,
    baseUrl: String(client.supabaseUrl).replace(/\/$/, "")
  };
}

function cacheKey(subPath, accessToken) {
  return `${String(accessToken).slice(-24)}:${subPath}`;
}

async function callOcppAdmin(subPath, context, { ttlMs = CACHE_TTL_MS } = {}) {
  assertReadOnlyPath(subPath);
  const key = cacheKey(subPath, context.accessToken);
  const cached = responseCache.get(key);
  if (ttlMs > 0 && cached?.expiresAt > Date.now()) return cached.data;
  if (inflightRequests.has(key)) return inflightRequests.get(key);

  const request = (async () => {
    const response = await fetch(`${context.baseUrl}/functions/v1/ocpp-admin${subPath}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        apikey: context.anonKey,
        Authorization: `Bearer ${context.accessToken}`
      }
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!response.ok) {
      const detail = parsed && typeof parsed === "object" ? (parsed.error ?? parsed.msg) : parsed;
      throw new Error(`HTTP ${response.status}: ${detail ?? "Unknown error"}`);
    }
    if (ttlMs > 0) responseCache.set(key, { data: parsed, expiresAt: Date.now() + ttlMs });
    return parsed;
  })().finally(() => inflightRequests.delete(key));

  inflightRequests.set(key, request);
  return request;
}

function withQuery(path, params) {
  const query = new URLSearchParams(params);
  return `${path}?${query}`;
}

async function fetchAllRows(path, context, params = {}) {
  const rows = [];
  let offset = 0;
  for (let pageIndex = 0; pageIndex < 10_000; pageIndex += 1) {
    const response = await callOcppAdmin(withQuery(path, { ...params, limit: PAGE_LIMIT, offset }), context);
    if (!Array.isArray(response?.data)) throw new Error(`${path} returned an invalid row contract`);
    rows.push(...response.data);
    if (!response.page?.hasMore) return rows;
    offset += Number(response.page.limit) || PAGE_LIMIT;
  }
  throw new Error(`${path} exceeded the pagination guard`);
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function safeSection(label, fallback, loader) {
  try {
    return await loader();
  } catch (error) {
    console.warn(`[live-ocpp] ${label} unavailable -> fallback empty`, error);
    return fallback;
  }
}

async function keyedDetails(rows, idKey, pathForId, context) {
  const entries = await mapLimit(rows, 6, async (row) => {
    const id = row?.[idKey];
    if (!id) return null;
    const response = await callOcppAdmin(pathForId(id), context);
    return [String(id), response?.data ?? null];
  });
  return Object.fromEntries(entries.filter((entry) => entry?.[1] && typeof entry[1] === "object"));
}

async function liveContextOrMiss() {
  const context = await edgeContext();
  return context ?? LIVE_OCPP_MISS;
}

export async function getLiveOcppMonitorData() {
  const context = await liveContextOrMiss();
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  const [piles, commandLogs, alarms] = await Promise.all([
    safeSection("piles", [], () => fetchAllRows("/piles", context)),
    safeSection("command-logs", [], () => fetchAllRows("/command-logs", context)),
    safeSection("alarms", [], () => fetchAllRows("/alarms", context, { since: "all" }))
  ]);
  return {
    isLive: true,
    generatedAt: new Date().toISOString(),
    logsScope: "each pile recent 7d (live readapi, loaded on demand)",
    logsDeferred: true,
    piles,
    logs: [],
    commandLogs,
    alarms
  };
}

async function fetchLogWindow(pileNo, from, to, context) {
  const rows = [];
  let beforeId = "";
  for (let pageIndex = 0; pageIndex < 10_000; pageIndex += 1) {
    const response = await callOcppAdmin(withQuery("/ocpp/logs", {
      pile_no: pileNo,
      from,
      to,
      limit: PAGE_LIMIT,
      ...(beforeId ? { before_id: beforeId } : {})
    }), context);
    if (!Array.isArray(response?.data)) throw new Error("/ocpp/logs returned an invalid row contract");
    rows.push(...response.data);
    if (!response.page?.hasMore) return rows;
    const nextId = response.data.at(-1)?.id;
    if (!nextId || String(nextId) === beforeId) throw new Error("/ocpp/logs cursor did not advance");
    beforeId = String(nextId);
  }
  throw new Error("/ocpp/logs exceeded the pagination guard");
}

export async function getLiveOcppMonitorLogsData() {
  const context = await liveContextOrMiss();
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  const piles = await safeSection("piles for logs", [], () => fetchAllRows("/piles", context));
  const now = Math.floor(Date.now() / 1000);
  const jobs = piles.flatMap((pile) => {
    if (!pile?.pileNo) return [];
    return Array.from({ length: LOG_DAYS }, (_, day) => {
      const to = now - day * LOG_WINDOW_SECONDS;
      return { pileNo: pile.pileNo, from: to - LOG_WINDOW_SECONDS, to };
    });
  });
  const chunks = await safeSection("ocpp/logs", [], () =>
    mapLimit(jobs, LOG_CONCURRENCY, (job) => fetchLogWindow(job.pileNo, job.from, job.to, context)));
  const logsById = new Map();
  chunks.flat().forEach((row) => {
    if (row?.id != null && !logsById.has(String(row.id))) logsById.set(String(row.id), row);
  });
  const logs = [...logsById.values()].sort((left, right) => Number(right.id) - Number(left.id));
  return {
    isLive: true,
    generatedAt: new Date().toISOString(),
    logsScope: "each pile recent 7d (live readapi, 24h windows)",
    logs
  };
}

export async function getLiveOcppChargingData() {
  const context = await liveContextOrMiss();
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  const [stations, piles, operators, orders, shareCharges, shareIncome, shareBookings, reports] = await Promise.all([
    safeSection("stations", [], () => fetchAllRows("/stations", context, { status: "all" })),
    safeSection("piles", [], () => fetchAllRows("/piles", context)),
    safeSection("operators", [], () => fetchAllRows("/operators", context, { status: "all" })),
    safeSection("orders", [], () => fetchAllRows("/orders", context)),
    safeSection("share/charges", [], () => fetchAllRows("/share/charges", context, { share: "all" })),
    safeSection("share/income", [], () => fetchAllRows("/share/income", context)),
    safeSection("share/bookings", [], () => fetchAllRows("/share/bookings", context)),
    safeSection("reports", { day: [], month: [], year: [] }, async () => {
      const [day, month, year] = await Promise.all(["day", "month", "year"].map((period) =>
        fetchAllRows("/reports/charging", context, { period })));
      return { day, month, year };
    })
  ]);
  const [stationDetails, sharePrices] = await Promise.all([
    safeSection("station details", {}, () => keyedDetails(stations, "stationId", (id) => `/stations/${id}`, context)),
    safeSection("share prices", {}, () => keyedDetails(shareCharges, "shareId", (id) => `/share/prices/${id}?limit=${PAGE_LIMIT}`, context))
  ]);
  return { stations, piles, operators, orders, shareCharges, shareIncome, shareBookings, stationDetails, sharePrices, reports };
}

export async function getLiveOcppUsersData() {
  const context = await liveContextOrMiss();
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  const [users, tags] = await Promise.all([
    safeSection("charge-users", [], () => fetchAllRows("/charge-users", context, { status: "all" })),
    safeSection("charge-user-tags", [], () => fetchAllRows("/charge-user-tags", context, { status: "all" }))
  ]);
  return { users, tags };
}

export async function getLiveOcppFinanceData() {
  const context = await liveContextOrMiss();
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  const paths = {
    recharges: "/finance/recharges",
    refunds: "/finance/refunds",
    userMoneyLogs: "/finance/user-money-logs",
    operatorMoneyLogs: "/finance/operator-money-logs",
    platformMoneyLogs: "/finance/platform-money-logs",
    withdrawals: "/finance/withdrawals"
  };
  const entries = await Promise.all(Object.entries(paths).map(async ([key, path]) =>
    [key, await safeSection(path.slice(1), [], () => fetchAllRows(path, context))]));
  return Object.fromEntries(entries);
}
