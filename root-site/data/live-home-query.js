import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";
import { getReadState, rememberUnreadWatermarks, setReadStateAccount } from "./read-state.js";
import { asArray, asNumber, asText } from "./live-snapshot-utils.js";
import { liveQueryKey, readLiveQueryCache, writeLiveQueryCache } from "./live-query-cache.js";

export const LIVE_HOME_QUERY_MISS = Symbol("live-home-query-miss");

const HOME_DASHBOARD_NAMESPACE = "home-dashboard";
const HOME_REQUESTS = new Map();
const UNREAD_REQUESTS = new Map();
const UNREAD_MEMO_TTL_MS = 30_000;
const UNREAD_KEYS = Object.freeze(["tasks", "orders", "messages", "inventory", "updates"]);

async function context() {
  const [client, session, currentUser] = await Promise.all([
    getSupabaseClient(), getSession(), getCurrentUser()
  ]);
  if (!client || !session?.user?.id || !currentUser) return null;
  return { client, currentUser, userId: session.user.id };
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
    read
  });
}

function rememberUnreadMemo(live, read, value, now = Date.now()) {
  const requestKey = unreadRequestKey(live, read);
  const promise = Promise.resolve(value);
  rememberUnreadWatermarks(value.watermarks);
  UNREAD_REQUESTS.clear();
  UNREAD_REQUESTS.set(requestKey, { expiresAt: now + UNREAD_MEMO_TTL_MS, promise });
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

async function currentLiveUnreadSummary(value, remember, suppliedRead = null) {
  const live = await context();
  if (!live || !value || typeof value !== "object" || Array.isArray(value)) return null;
  setReadStateAccount(live.currentUser.id || null);
  const read = suppliedRead && typeof suppliedRead === "object" ? suppliedRead : getReadState();
  const current = unreadAfterLocalWatermarks(value, read);
  return remember ? rememberUnreadMemo(live, read, current) : current;
}

export function clampLiveUnreadSummary(value) {
  return currentLiveUnreadSummary(value, false);
}

export function rememberLiveUnreadSummary(value, { read = null } = {}) {
  return currentLiveUnreadSummary(value, true, read);
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
  const requestKey = `${live.userId}:${liveQueryKey(query)}`;
  if (HOME_REQUESTS.has(requestKey)) return HOME_REQUESTS.get(requestKey);
  const promise = live.client.rpc("bizflow_home_dashboard", {
    p_company_id: query.companyId || null
  }).then((result) => {
    if (result.error) throw result.error;
    const value = mapDashboard(result.data, live.currentUser);
    writeLiveQueryCache({
      userId: live.userId,
      namespace: HOME_DASHBOARD_NAMESPACE,
      query,
      value
    });
    return value;
  }).finally(() => {
    HOME_REQUESTS.delete(requestKey);
  });
  HOME_REQUESTS.set(requestKey, promise);
  return promise;
}

function backgroundHomeRefresh(live, query) {
  void fetchHomeDashboard(live, query)
    .catch((error) => console.warn("[home-query] background refresh failed", error));
}

export async function getLiveHomeDashboard({ refresh = false } = {}) {
  const live = await context();
  if (!live) return LIVE_HOME_QUERY_MISS;
  const query = { companyId: live.currentUser.activeCompanyId || "" };
  const cached = readLiveQueryCache({
    userId: live.userId,
    namespace: HOME_DASHBOARD_NAMESPACE,
    query
  });
  if (cached && !refresh) {
    backgroundHomeRefresh(live, query);
    return { ...cached.value, cached: true, stale: cached.stale };
  }
  try {
    return await fetchHomeDashboard(live, query);
  } catch (error) {
    if (cached) return { ...cached.value, cached: true, stale: true, offline: true };
    throw error;
  }
}

export async function getLiveUnreadState() {
  const live = await context();
  if (!live) return LIVE_HOME_QUERY_MISS;
  setReadStateAccount(live.currentUser.id || null);
  const read = getReadState();
  const requestKey = unreadRequestKey(live, read);
  const now = Date.now();
  const memo = UNREAD_REQUESTS.get(requestKey);
  if (memo?.expiresAt > now) return memo.promise;

  // The first realtime SUBSCRIBED catch-up can advance snapshot revisions while
  // a page is mounting. Keep the resolved result briefly so that follow-up
  // getUnread()/getUnreadWatermarks() reads do not repeat the same RPC.
  const promise = live.client.rpc("bizflow_unread_summary", {
    p_company_id: live.currentUser.activeCompanyId || null,
    p_tasks_read: read.tasks || null,
    p_orders_read: read.orders || null,
    p_messages_read: read.messages || null,
    p_inventory_read: read.inventory || null,
    p_updates_read: read.updates || null
  }).then((result) => {
    if (result.error) throw result.error;
    const value = mapUnreadState(result.data);
    rememberUnreadWatermarks(value.watermarks);
    return value;
  }).catch((error) => {
    if (UNREAD_REQUESTS.get(requestKey)?.promise === promise) UNREAD_REQUESTS.delete(requestKey);
    throw error;
  });
  UNREAD_REQUESTS.clear();
  UNREAD_REQUESTS.set(requestKey, { expiresAt: now + UNREAD_MEMO_TTL_MS, promise });
  return promise;
}
