const METRIC_PATHS = Object.freeze([
  ["orders", (state) => state.data.stats.find((row) => row.key === "orders")?.value],
  ["customers", (state) => state.data.stats.find((row) => row.key === "customers")?.value],
  ["members", (state) => state.data.stats.find((row) => row.key === "members")?.value],
  ["warranty", (state) => state.data.stats.find((row) => row.key === "warranty")?.value],
  ["monthlyRevenue", (state) => state.revenueMetrics?.totalRevenue],
  ["paidOrders", (state) => state.revenueMetrics?.paidCount],
  ["averageOrder", (state) => state.revenueMetrics?.average],
  ["unpaidOrders", (state) => state.revenueMetrics?.unpaidCount],
  ["unpaidAmount", (state) => state.revenueMetrics?.unpaidAmount],
  ["shippingAll", (state) => state.shippingMetrics?.all],
  ["pendingShipment", (state) => state.shippingMetrics?.pending],
  ["inTransit", (state) => state.shippingMetrics?.in_transit],
  ["shippingException", (state) => state.shippingMetrics?.exception],
  ["shippingDelivered", (state) => state.shippingMetrics?.delivered],
  ["inventoryCarriers", (state) => state.inventoryMetrics?.carrierCount],
  ["inventoryActive", (state) => state.inventoryMetrics?.activeSkuCount],
  ["inventoryQuantity", (state) => state.inventoryMetrics?.totalQuantity],
  ["inventoryLow", (state) => state.inventoryMetrics?.lowStockCount],
  ["membersAll", (state) => state.data.membersStats?.all],
  ["membersActive", (state) => state.data.membersStats?.active],
  ["membersPendingReview", (state) => state.data.membersStats?.pendingReview],
  ["membersLeft", (state) => state.data.membersStats?.left]
]);

const LIST_PATHS = Object.freeze([
  ["tasks", (state) => state.data.tasks],
  ["feed", (state) => state.data.feed],
  ["chart", (state) => state.data.chart],
  ["recentOrders", (state) => state.data.orders],
  ["stock", (state) => state.data.stock],
  ["memberRows", (state) => state.data.members],
  ["warrantyItems", (state) => state.data.warrantyItems]
]);

function comparableList(value) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

export function homeMetricVector(state) {
  return Object.fromEntries(METRIC_PATHS.map(([key, read]) => [key, Number(read(state) ?? 0)]));
}

export function homeListVector(state) {
  return Object.fromEntries(LIST_PATHS.map(([key, read]) => [key, Array.isArray(read(state)) ? read(state) : []]));
}

export function compareHomeMetricSets(legacyState, serverState) {
  const legacy = homeMetricVector(legacyState);
  const server = homeMetricVector(serverState);
  const legacyLists = homeListVector(legacyState);
  const serverLists = homeListVector(serverState);
  const rows = [
    ...METRIC_PATHS.map(([key]) => ({
      key,
      kind: "metric",
      legacy: legacy[key],
      server: server[key],
      equal: legacy[key] === server[key]
    })),
    ...LIST_PATHS.map(([key]) => ({
      key,
      kind: "list",
      legacy: legacyLists[key],
      server: serverLists[key],
      equal: comparableList(legacyLists[key]) === comparableList(serverLists[key])
    }))
  ];
  return {
    equal: rows.every((row) => row.equal),
    rows,
    legacy: { ...legacy, ...legacyLists },
    server: { ...server, ...serverLists }
  };
}
