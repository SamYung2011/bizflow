import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";
import { getReadState, rememberUnreadWatermarks, setReadStateAccount } from "./read-state.js";
import { asArray, asNumber, asText } from "./live-snapshot-utils.js";

export const LIVE_HOME_QUERY_MISS = Symbol("live-home-query-miss");

async function context() {
  const [client, session, currentUser] = await Promise.all([
    getSupabaseClient(), getSession(), getCurrentUser()
  ]);
  if (!client || !session?.user?.id || !currentUser) return null;
  return { client, currentUser };
}

function metricNumber(source, key) {
  return asNumber(source?.[key]);
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

export async function getLiveHomeDashboard() {
  const live = await context();
  if (!live) return LIVE_HOME_QUERY_MISS;
  const result = await live.client.rpc("bizflow_home_dashboard", {
    p_company_id: live.currentUser.activeCompanyId || null
  });
  if (result.error) throw result.error;
  return mapDashboard(result.data, live.currentUser);
}

export async function getLiveUnreadState() {
  const live = await context();
  if (!live) return LIVE_HOME_QUERY_MISS;
  setReadStateAccount(live.currentUser.id || null);
  const read = getReadState();
  const result = await live.client.rpc("bizflow_unread_summary", {
    p_company_id: live.currentUser.activeCompanyId || null,
    p_tasks_read: read.tasks || null,
    p_orders_read: read.orders || null,
    p_messages_read: read.messages || null,
    p_inventory_read: read.inventory || null,
    p_updates_read: read.updates || null
  });
  if (result.error) throw result.error;
  const unread = Object.fromEntries(["tasks", "orders", "messages", "inventory", "updates"]
    .map((key) => [key, metricNumber(result.data?.unread, key)]));
  const watermarks = Object.fromEntries(["tasks", "orders", "messages", "inventory", "updates"]
    .map((key) => [key, asText(result.data?.watermarks?.[key])]));
  rememberUnreadWatermarks(watermarks);
  return { unread, watermarks };
}
