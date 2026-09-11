import { sessionReadContext, assertReadContextCurrent, readScopedQueryCache, writeScopedQueryCache } from "./live-read-scope.js";
import { getCurrentUser, getRememberedActiveCompanyId, getRememberedEmployeeId } from "./auth.js";
import { getReadState, peekReadState, rememberUnreadWatermarks, setReadStateAccount } from "./read-state.js";
import { asArray, asNumber, asText } from "./live-snapshot-utils.js";
import { liveQueryKey } from "./live-query-cache.js";

export const LIVE_HOME_QUERY_MISS = Symbol("live-home-query-miss");

const HOME_DASHBOARD_NAMESPACE = "home-dashboard";
const HOME_REQUESTS = new Map();
const UNREAD_REQUESTS = new Map();
const UNREAD_MEMO_TTL_MS = 30_000;
const UNREAD_KEYS = Object.freeze(["tasks", "orders", "messages", "inventory", "updates"]);

async function homeContext({ prefetch = false } = {}) {
  const started = await sessionReadContext(HOME_DASHBOARD_NAMESPACE);
  if (!started) return null;
  const rememberedCompany = getRememberedActiveCompanyId(started.userId);
  if (prefetch && rememberedCompany) return { ...started, companyId: rememberedCompany };
  // No remembered company: wait for the real membership selection. Never guess
  // the first company or send a speculative null-company dashboard request.
  const currentUser = await getCurrentUser();
  const verified = await sessionReadContext(HOME_DASHBOARD_NAMESPACE);
  if (!currentUser || !verified || verified.userId !== started.userId) return null;
  return { ...verified, companyId: currentUser.activeCompanyId || '', currentUser };
}

function metricNumber(source, key) {
  return asNumber(source?.[key]);
}

function mapUnreadState(payload) {
  return {
    unread: Object.fromEntries(UNREAD_KEYS.map((key) => [key, metricNumber(payload?.unread, key)])),
    watermarks: Object.fromEntries(UNREAD_KEYS.map((key) => [key, asText(payload?.watermarks?.[key])]))
  };
}

function unreadRequestKey(live, read) {
  return liveQueryKey({
    userId: live.userId,
    companyId: live.currentUser.activeCompanyId || "",
    scopeKey: live.scopeKey, employeeId: live.currentUser.id,
    read
  });
}

function rememberUnreadMemo(live, read, value, now = Date.now()) {
  const requestKey = unreadRequestKey(live, read);
  const promise = Promise.resolve(value);
  rememberUnreadWatermarks(value.watermarks);
  UNREAD_REQUESTS.set(requestKey, { expiresAt: now + UNREAD_MEMO_TTL_MS, promise, live, read });
  return value;
}

function unreadAfterLocalWatermarks(value, read) {
  const next = mapUnreadState(value);
  for (const key of UNREAD_KEYS) {
    const readValue = asText(read?.[key]);
    const watermark = next.watermarks[key];
    if (!readValue || !watermark) continue;
    if (key === "inventory") {
      if (readValue === watermark) next.unread[key] = 0;
      continue;
    }
    const readTime = Date.parse(readValue);
    const watermarkTime = Date.parse(watermark);
    if (Number.isFinite(readTime) && Number.isFinite(watermarkTime) && readTime >= watermarkTime) {
      next.unread[key] = 0;
    }
  }
  return next;
}

async function currentLiveUnreadSummary(value, suppliedRead = null) {
  const live = await unreadContext();
  if (!live || !value || typeof value !== "object" || Array.isArray(value)) return null;
  setReadStateAccount(live.currentUser.id || null);
  const read = suppliedRead && typeof suppliedRead === "object" ? suppliedRead : getReadState();
  const current = unreadAfterLocalWatermarks(value, read);
  return rememberUnreadMemo(live, read, current);
}

export function rememberLiveUnreadSummary(value, { read = null } = {}) {
  return currentLiveUnreadSummary(value, read);
}

function mapDashboard(payload, currentUser) {
  const counts = payload?.counts ?? {};
  const revenue = payload?.revenue ?? {};
  const shipping = payload?.shipping ?? {};
  const inventory = payload?.inventory ?? {};
  const warrantyCount = metricNumber(counts, "warranty");
  const data = {
    __live: true,
    generated_at: asText(payload?.generated_at),
    unread: { tasks: 0, orders: 0, inventory: 0, messages: 0, updates: 0 },
    stats: [
      { key: "orders", tone: "", value: metricNumber(counts, "orders") },
      { key: "customers", tone: "blue", value: metricNumber(counts, "customers") },
      { key: "members", tone: "green", value: metricNumber(counts, "members") },
      { key: "warranty", tone: "yellow", value: warrantyCount, alert: warrantyCount > 0 }
    ],
    tasks: asArray(payload?.tasks),
    feed: asArray(payload?.feed),
    chart: asArray(payload?.chart),
    orders: asArray(payload?.orders),
    stock: asArray(payload?.stock),
    members: asArray(payload?.members),
    membersStats: {
      all: metricNumber(payload?.members_stats, "all"),
      active: metricNumber(payload?.members_stats, "active"),
      pendingReview: metricNumber(payload?.members_stats, "pending_review"),
      left: metricNumber(payload?.members_stats, "left")
    },
    currentUser: {
      name: currentUser.name || "",
      email: currentUser.email || "",
      dept: currentUser.role || "",
      bizflowMainAccess: currentUser.bizflowMainAccess === true
    },
    warrantyItems: asArray(payload?.warranty_items)
  };
  return {
    data,
    revenueMetrics: {
      totalRevenue: metricNumber(revenue, "total_revenue"),
      paidCount: metricNumber(revenue, "paid_count"),
      average: metricNumber(revenue, "average"),
      unpaidCount: metricNumber(revenue, "unpaid_count"),
      unpaidAmount: metricNumber(revenue, "unpaid_amount")
    },
    shippingMetrics: {
      all: metricNumber(shipping, "all"),
      pending: metricNumber(shipping, "pending"),
      in_transit: metricNumber(shipping, "in_transit"),
      exception: metricNumber(shipping, "exception"),
      delivered: metricNumber(shipping, "delivered")
    },
    inventoryMetrics: {
      carrierCount: metricNumber(inventory, "carrier_count"),
      activeSkuCount: metricNumber(inventory, "active_sku_count"),
      totalQuantity: metricNumber(inventory, "total_quantity"),
      lowStockCount: metricNumber(inventory, "low_stock_count")
    },
    currentUser
  };
}

async function fetchHomeDashboard(live, query) {
  const requestKey = `${live.scopeKey}:${liveQueryKey(query)}`;
  if (HOME_REQUESTS.has(requestKey)) return HOME_REQUESTS.get(requestKey);
  const promise = live.client.rpc('bizflow_home_dashboard', {
    p_company_id: query.companyId || null
  }).then((result) => {
    if (result.error) throw result.error;
    // Cache the server package, never a speculative user's permissions/profile.
    const value = { payload: result.data };
    writeScopedQueryCache(live, query, value);
    return value;
  }).finally(() => HOME_REQUESTS.delete(requestKey));
  HOME_REQUESTS.set(requestKey, promise);
  return promise;
}

async function readHomePackage(live, { refresh = false } = {}) {
  const query = { companyId: live.companyId };
  const entry = readScopedQueryCache(live, query);
  // Pre-split cache entries contain a mapped dashboard; fetch once to upgrade.
  const cached = entry && Object.hasOwn(entry.value, 'payload') ? entry : null;
  if (cached && !refresh) {
    if (cached.stale) void fetchHomeDashboard(live, query).catch((error) => {
      if (error?.name !== 'AbortError') console.warn('[home-query] background refresh failed', error);
    });
    return { ...cached.value, cached: true, stale: cached.stale };
  }
  try { return await fetchHomeDashboard(live, query); }
  catch (error) {
    assertReadContextCurrent(live);
    if (cached) return { ...cached.value, cached: true, stale: true, offline: true };
    throw error;
  }
}

export async function prefetchLiveHomeDashboard({ retry = true } = {}) {
  try {
    const live = await homeContext({ prefetch: true });
    if (!live) return LIVE_HOME_QUERY_MISS;
    return await readHomePackage(live);
  } catch (error) {
    if (error?.name === 'AbortError' && retry) return prefetchLiveHomeDashboard({ retry: false });
    throw error;
  }
}

export async function getLiveHomeDashboard({ refresh = false, retry = true } = {}) {
  try {
    const live = await homeContext();
    if (!live) return LIVE_HOME_QUERY_MISS;
    const { payload, ...cacheState } = await readHomePackage(live, { refresh });
    assertReadContextCurrent(live);
    // The existing mapper and all revenue visibility gates are unchanged. Only
    // the verified currentUser is allowed to reach the UI mapping stage.
    return { ...mapDashboard(payload, live.currentUser), ...cacheState };
  } catch (error) {
    if (error?.name === 'AbortError' && retry) return getLiveHomeDashboard({ refresh, retry: false });
    throw error;
  }
}

// Hints only select a speculative request. The normal reader always resolves
// currentUser and must match user/company/employee/version before claiming it.
async function unreadContext({ prefetch = false } = {}) {
  let live = await sessionReadContext('unread');
  if (!live) return null;
  const companyId = getRememberedActiveCompanyId(live.userId);
  const employeeId = getRememberedEmployeeId(live.userId);
  if (prefetch && companyId && employeeId) {
    return { ...live, currentUser: { id: employeeId, activeCompanyId: companyId } };
  }
  const currentUser = await getCurrentUser();
  const verified = await sessionReadContext('unread');
  if (!currentUser || !verified || verified.userId !== live.userId) return null;
  return { ...verified, currentUser: { id: currentUser.id, activeCompanyId: currentUser.activeCompanyId } };
}

function canApplyReadWatermarks(before, after, value) {
  return UNREAD_KEYS.every((key) => {
    if ((before[key] || '') === (after[key] || '')) return true;
    const watermark = value.watermarks[key];
    return after[key] && watermark && (key === 'inventory' ? after[key] === watermark
      : Date.parse(after[key]) >= Date.parse(watermark));
  });
}

export async function getLiveUnreadState({ prefetch = false, retry = true } = {}) {
  const live = await unreadContext({ prefetch });
  if (!live) return LIVE_HOME_QUERY_MISS;
  const read = peekReadState(live.currentUser.id);
  const requestKey = unreadRequestKey(live, read);
  const now = Date.now();
  for (const [key, entry] of UNREAD_REQUESTS) if (entry.expiresAt <= now) UNREAD_REQUESTS.delete(key);
  try {
    const memo = UNREAD_REQUESTS.get(requestKey);
    if (memo) {
      const value = await memo.promise;
      assertReadContextCurrent(live);
      if (!prefetch) rememberUnreadWatermarks(value.watermarks);
      return value;
    }
    // Pages mark their section read after mounting. A fully-read watermark can
    // zero that count locally; partial/backward changes still require an RPC.
    for (const entry of UNREAD_REQUESTS.values()) {
      if (unreadRequestKey(entry.live, read) !== requestKey) continue;
      const value = await entry.promise;
      assertReadContextCurrent(live);
      if (canApplyReadWatermarks(entry.read, read, value)) {
        return rememberUnreadMemo(live, read, unreadAfterLocalWatermarks(value, read));
      }
    }
    const promise = live.client.rpc('bizflow_unread_summary', {
      p_company_id: live.currentUser.activeCompanyId || null,
      p_tasks_read: read.tasks || null, p_orders_read: read.orders || null,
      p_messages_read: read.messages || null, p_inventory_read: read.inventory || null,
      p_updates_read: read.updates || null
    }).then((result) => {
      if (result.error) throw result.error;
      assertReadContextCurrent(live);
      const value = mapUnreadState(result.data);
      const entry = UNREAD_REQUESTS.get(requestKey);
      if (entry?.promise === promise) entry.expiresAt = Date.now() + UNREAD_MEMO_TTL_MS;
      if (!prefetch) rememberUnreadWatermarks(value.watermarks);
      return value;
    }).catch((error) => {
      if (UNREAD_REQUESTS.get(requestKey)?.promise === promise) UNREAD_REQUESTS.delete(requestKey);
      throw error;
    });
    UNREAD_REQUESTS.set(requestKey, { expiresAt: Infinity, promise, live, read });
    return await promise;
  } catch (error) {
    if (error?.name === 'AbortError' && retry) return getLiveUnreadState({ prefetch, retry: false });
    throw error;
  }
}

export function prefetchLiveUnreadState() { return getLiveUnreadState({ prefetch: true }); }
