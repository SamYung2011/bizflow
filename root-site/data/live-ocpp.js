import { sessionReadContext, assertReadContextCurrent, isReadContextCurrent, canAdoptReadScope, liveReadVersion } from "./live-read-scope.js";
import {
  liveSnapshotCacheVersion,
  markLiveSnapshotCacheStale,
  readLiveSnapshotCache,
  writeLiveSnapshotCache,
} from "./live-table-cache.js";
import { LIVE_SNAPSHOT_UPDATED_EVENT } from "./live-snapshot-dependencies.js";

// GET-only Edge transport. The short memory cache de-duplicates bursts while the
// IndexedDB snapshot cache makes subsequent route entries stale-while-revalidate.

export const LIVE_OCPP_MISS = Symbol("live-ocpp-miss");

export const OCPP_CACHE_SNAPSHOTS = Object.freeze({
  monitor: "ocpp-monitor-v2",
  logs: "ocpp-logs-v2",
  charging: "ocpp-charging-v2",
  users: "ocpp-users-v2",
  finance: "ocpp-finance-v2",
});

const CACHE_TTL_MS = 45_000;
const PAGE_LIMIT = 200;
const responseCache = new Map();
const inflightRequests = new Map();
const persistentRefreshes = new Map();
const settledSnapshots = new Map();
const deniedScopes = new Map();
let cacheUserId = "";
let cacheToken = "";

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
  /^\/ocpp\/logs(?:\?|$)/,
  /^\/ocpp\/logs\/recent(?:\?|$)/,
  /^\/summary\/(?:monitor|charging|finance)(?:\?|$)/,
];

const FINANCE_PATHS = Object.freeze({
  recharges: "/finance/recharges",
  refunds: "/finance/refunds",
  userMoneyLogs: "/finance/user-money-logs",
  operatorMoneyLogs: "/finance/operator-money-logs",
  platformMoneyLogs: "/finance/platform-money-logs",
  withdrawals: "/finance/withdrawals",
});

function assertReadOnlyPath(subPath) {
  if (!READ_ONLY_PATHS.some((pattern) => pattern.test(subPath))) {
    throw new Error(`OCPP live reader rejects non-read path: ${subPath}`);
  }
}

function resetCacheForUser(userId, token) {
  if (cacheUserId === userId && cacheToken === token) return;
  cacheUserId = userId;
  cacheToken = token;
  responseCache.clear();
  inflightRequests.clear();
  persistentRefreshes.clear();
  settledSnapshots.clear();
  deniedScopes.clear();
}

async function edgeContext(snapshot = OCPP_CACHE_SNAPSHOTS.logs, { refresh = false } = {}) {
  const scope = await sessionReadContext(snapshot);
  if (!scope) return null;
  const { session, client } = scope;
  if (!client?.supabaseUrl || !client?.supabaseKey || !session.access_token) {
    throw new Error("Supabase OCPP reader is not configured");
  }
  resetCacheForUser(session.user.id, session.access_token);
  if (refresh) {
    assertContext({ ...scope, accessToken: session.access_token });
    // An explicit read owns a new generation; older prefetch/SWR cannot win
    // the race or satisfy this request through either in-flight cache.
    markLiveSnapshotCacheStale(snapshot);
    scope.scopeKey = liveReadVersion(scope.userId, snapshot);
  }
  for (const cache of [responseCache, settledSnapshots]) {
    for (const [key, value] of cache) if (value.expiresAt <= Date.now()) cache.delete(key);
  }
  return {
    ...scope,
    refresh,
    accessToken: session.access_token,
    anonKey: client.supabaseKey,
    baseUrl: String(client.supabaseUrl).replace(/\/$/, ""),
  };
}

function cacheKey(subPath, context) {
  return JSON.stringify([context.userId, context.accessToken.slice(-24), context.scopeKey, subPath]);
}

function persistedScope(context) {
  return { ...context, scopeKey: JSON.stringify([...JSON.parse(context.scopeKey), context.accessToken.slice(-24)]) };
}

function contextIsCurrent(context) {
  return context.userId === cacheUserId && context.accessToken === cacheToken && isReadContextCurrent(context);
}

function assertContext(context) {
  assertReadContextCurrent(context);
  if (!contextIsCurrent(context)) throw new DOMException("OCPP session superseded", "AbortError");
}

function denialKey(context) {
  // All read paths share the existing Edge admin gate; a denial is session-wide.
  return JSON.stringify([context.userId, context.accessToken.slice(-24), JSON.parse(context.scopeKey).slice(0, 4)]);
}

async function callOcppAdmin(subPath, context, { ttlMs = context.refresh ? 0 : CACHE_TTL_MS } = {}) {
  assertReadOnlyPath(subPath);
  assertContext(context);
  const denied = deniedScopes.get(denialKey(context));
  if (denied?.expiresAt > Date.now()) throw denied.error;
  const key = cacheKey(subPath, context);
  const cached = responseCache.get(key);
  if (ttlMs > 0 && cached?.expiresAt > Date.now()) return cached.data;
  if (inflightRequests.has(key)) return inflightRequests.get(key);

  const request = (async () => {
    const response = await fetch(`${context.baseUrl}/functions/v1/ocpp-admin${subPath}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        apikey: context.anonKey,
        Authorization: `Bearer ${context.accessToken}`,
      },
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    assertContext(context);
    if (!response.ok) {
      const detail = parsed && typeof parsed === "object" ? (parsed.error ?? parsed.msg) : parsed;
      const error = Object.assign(new Error(`HTTP ${response.status}: ${detail ?? "Unknown error"}`), { status: response.status });
      if (response.status === 403) deniedScopes.set(denialKey(context), { error, expiresAt: Date.now() + CACHE_TTL_MS });
      throw error;
    }
    if (ttlMs > 0) responseCache.set(key, { data: parsed, expiresAt: Date.now() + ttlMs });
    return parsed;
  })().finally(() => { if (inflightRequests.get(key) === request) inflightRequests.delete(key); });

  inflightRequests.set(key, request);
  return request;
}

function withQuery(path, params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value != null && value !== ""),
  );
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function pageContract(response, path) {
  if (!Array.isArray(response?.data) || !response?.page || typeof response.page !== "object") {
    throw new Error(`${path} returned an invalid page contract`);
  }
  return { rows: response.data, page: response.page };
}

function summaryContract(response, path) {
  if (!response?.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    throw new Error(`${path} returned an invalid summary contract`);
  }
  return response.data;
}

function dispatchSnapshot(snapshot, value) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIVE_SNAPSHOT_UPDATED_EVENT, {
    detail: { snapshot, value },
  }));
}

async function buildAndStore(snapshot, context, loader, { notify = false } = {}) {
  assertContext(context);
  const version = liveSnapshotCacheVersion(snapshot);
  const value = await loader();
  assertContext(context);
  await writeLiveSnapshotCache({
    userId: context.userId, snapshot, value, version,
    scopeKey: persistedScope(context).scopeKey,
    isCurrent: () => contextIsCurrent(context),
  });
  assertContext(context);
  settledSnapshots.set(cacheKey(snapshot, context), { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (notify) dispatchSnapshot(snapshot, value);
  return value;
}

function buildSnapshot(snapshot, context, loader, options) {
  const key = cacheKey(snapshot, context);
  if (persistentRefreshes.has(key)) return persistentRefreshes.get(key);
  const refresh = buildAndStore(snapshot, context, loader, options)
    .finally(() => { if (persistentRefreshes.get(key) === refresh) persistentRefreshes.delete(key); });
  persistentRefreshes.set(key, refresh);
  return refresh;
}

function refreshPersistentSnapshot(snapshot, context, loader) {
  return buildSnapshot(snapshot, context, loader, { notify: true }).catch((error) => {
    if (error?.status !== 403 && error?.name !== "AbortError") console.warn(`[live-ocpp] ${snapshot} SWR refresh failed`, error);
  });
}

async function cachedSnapshot(snapshot, context, loader) {
  assertContext(context);
  if (context.refresh) return buildSnapshot(snapshot, context, loader);
  const memo = settledSnapshots.get(cacheKey(snapshot, context));
  if (memo?.expiresAt > Date.now()) return memo.value;
  const cached = await readLiveSnapshotCache({ userId: context.userId, snapshot });
  assertContext(context);
  if (cached && canAdoptReadScope(persistedScope(context), cached.scopeKey)) {
    void refreshPersistentSnapshot(snapshot, context, loader);
    return cached.value;
  }
  return buildSnapshot(snapshot, context, loader);
}

async function liveContextOrMiss(snapshot, options) {
  const context = await edgeContext(snapshot, options);
  return context ?? LIVE_OCPP_MISS;
}

// Speculation is data-only: neither route notices nor the existing admin gate
// belong here. Denied sessions are memoized, with no retry or static fallback.
export async function prefetchOcppPage(page) {
  const readers = { "ocpp-monitor": getLiveOcppMonitorData, "ocpp-charging": getLiveOcppChargingData,
    "ocpp-users": getLiveOcppUsersData, "ocpp-finance": getLiveOcppFinanceData };
  try { return await readers[page]?.(); } catch { return undefined; }
}

async function fetchPage(path, context, params = {}) {
  const response = await callOcppAdmin(withQuery(path, params), context);
  return pageContract(response, path);
}

function generatedAt() {
  return new Date().toISOString();
}

async function loadMonitor(context) {
  const summary = summaryContract(
    await callOcppAdmin("/summary/monitor", context),
    "/summary/monitor",
  );
  return {
    isLive: true,
    generatedAt: generatedAt(),
    logsScope: "latest mixed-pile messages (live readapi, loaded on demand)",
    logsDeferred: true,
    piles: Array.isArray(summary.piles) ? summary.piles : [],
    logs: [],
    commandLogs: Array.isArray(summary.commandLogs) ? summary.commandLogs : [],
    alarms: Array.isArray(summary.alarms) ? summary.alarms : [],
  };
}

export async function getLiveOcppMonitorData(options = {}) {
  const context = await liveContextOrMiss(OCPP_CACHE_SNAPSHOTS.monitor, options);
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  return await cachedSnapshot(OCPP_CACHE_SNAPSHOTS.monitor, context, () => loadMonitor(context));
}

async function loadRecentLogs(context) {
  const response = await callOcppAdmin(`/ocpp/logs/recent?limit=${PAGE_LIMIT}`, context, { ttlMs: 0 });
  const page = pageContract(response, "/ocpp/logs/recent");
  return {
    isLive: true,
    generatedAt: generatedAt(),
    logsScope: "latest mixed-pile messages (live readapi)",
    logs: page.rows,
    logsPage: page.page,
  };
}

export async function getLiveOcppMonitorLogsData() {
  const context = await liveContextOrMiss(OCPP_CACHE_SNAPSHOTS.logs);
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  return await cachedSnapshot(OCPP_CACHE_SNAPSHOTS.logs, context, () => loadRecentLogs(context));
}

export async function getLiveOcppRecentLogsPage({ beforeId = "", limit = PAGE_LIMIT } = {}) {
  const context = await liveContextOrMiss();
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  return await fetchPage("/ocpp/logs/recent", context, { before_id: beforeId, limit });
}

export async function getLiveOcppPileLogsPage({ pileNo, beforeId = "", from = "", to = "", limit = PAGE_LIMIT } = {}) {
  const context = await liveContextOrMiss();
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  return await fetchPage("/ocpp/logs", context, {
    pile_no: pileNo,
    before_id: beforeId,
    from,
    to,
    limit,
  });
}

async function loadCharging(context) {
  const summary = summaryContract(
    await callOcppAdmin("/summary/charging", context),
    "/summary/charging",
  );
  const stations = Array.isArray(summary.stations) ? summary.stations : [];
  const shareCharges = Array.isArray(summary.shareCharges) ? summary.shareCharges : [];
  const orders = pageContract(summary.orders, "/summary/charging orders");
  return {
    stations,
    piles: Array.isArray(summary.piles) ? summary.piles : [],
    operators: Array.isArray(summary.operators) ? summary.operators : [],
    orders: orders.rows,
    orderPage: orders.page,
    orderTotal: Number(orders.page.total) || 0,
    shareCharges,
    shareIncome: Array.isArray(summary.shareIncome) ? summary.shareIncome : [],
    shareBookings: Array.isArray(summary.shareBookings) ? summary.shareBookings : [],
    stationDetails: Object.fromEntries(stations
      .filter((station) => station?.stationId && station?.detail)
      .map((station) => [String(station.stationId), station.detail])),
    sharePrices: Object.fromEntries(shareCharges
      .filter((share) => share?.shareId && Array.isArray(share.prices))
      .map((share) => [String(share.shareId), share.prices])),
    reports: summary.reports && typeof summary.reports === "object"
      ? summary.reports
      : { day: [], month: [], year: [] },
  };
}

export async function getLiveOcppChargingData(options = {}) {
  const context = await liveContextOrMiss(OCPP_CACHE_SNAPSHOTS.charging, options);
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  return await cachedSnapshot(OCPP_CACHE_SNAPSHOTS.charging, context, () => loadCharging(context));
}

export async function getLiveOcppOrdersPage(params = {}) {
  const context = await liveContextOrMiss(OCPP_CACHE_SNAPSHOTS.charging);
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  return await fetchPage("/orders", context, { limit: PAGE_LIMIT, ...params });
}

async function loadUsers(context) {
  const [users, tags] = await Promise.all([
    fetchPage("/charge-users", context, { limit: PAGE_LIMIT, status: "all" }),
    fetchPage("/charge-user-tags", context, { limit: PAGE_LIMIT, status: "all" }),
  ]);
  return {
    users: users.rows,
    tags: tags.rows,
    userPage: users.page,
    userTotal: Number(users.page.total) || 0,
    tagPage: tags.page,
  };
}

export async function getLiveOcppUsersData() {
  const context = await liveContextOrMiss(OCPP_CACHE_SNAPSHOTS.users);
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  return await cachedSnapshot(OCPP_CACHE_SNAPSHOTS.users, context, () => loadUsers(context));
}

export async function getLiveOcppUsersPage(params = {}) {
  const context = await liveContextOrMiss(OCPP_CACHE_SNAPSHOTS.users);
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  return await fetchPage("/charge-users", context, { limit: PAGE_LIMIT, ...params });
}

async function loadFinance(context) {
  const summary = summaryContract(
    await callOcppAdmin("/summary/finance", context),
    "/summary/finance",
  );
  const data = {};
  const financePages = {};
  const financeTotals = {};
  for (const key of Object.keys(FINANCE_PATHS)) {
    const page = pageContract(summary[key], `/summary/finance ${key}`);
    data[key] = page.rows;
    financePages[key] = page.page;
    financeTotals[key] = Number(page.page.total) || 0;
  }
  return { ...data, financePages, financeTotals };
}

export async function getLiveOcppFinanceData(options = {}) {
  const context = await liveContextOrMiss(OCPP_CACHE_SNAPSHOTS.finance, options);
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  return await cachedSnapshot(OCPP_CACHE_SNAPSHOTS.finance, context, () => loadFinance(context));
}

export async function getLiveOcppFinancePage(key, params = {}) {
  const path = FINANCE_PATHS[key];
  if (!path) throw new Error(`Unknown OCPP finance section: ${key}`);
  const context = await liveContextOrMiss(OCPP_CACHE_SNAPSHOTS.finance);
  if (context === LIVE_OCPP_MISS) return LIVE_OCPP_MISS;
  return await fetchPage(path, context, { limit: PAGE_LIMIT, ...params });
}
