const METRIC_PATHS = Object.freeze([
  ["orders", (state) => state.data.stats.find((row) => row.key === "orders")?.value],
  ["customers", (state) => state.data.stats.find((row) => row.key === "customers")?.value],
  ["members", (state) => state.data.stats.find((row) => row.key === "members")?.value],
  ["warranty", (state) => state.data.stats.find((row) => row.key === "warranty")?.value],
  ["monthlyRevenue", (state) => state.revenueMetrics?.totalRevenue],
  ["paidOrders", (state) => state.revenueMetrics?.paidCount],
  ["pendingShipment", (state) => state.shippingMetrics?.pending],
  ["inTransit", (state) => state.shippingMetrics?.in_transit],
  ["shippingException", (state) => state.shippingMetrics?.exception],
  ["inventoryCarriers", (state) => state.inventoryMetrics?.carrierCount],
  ["inventoryActive", (state) => state.inventoryMetrics?.activeSkuCount],
  ["inventoryQuantity", (state) => state.inventoryMetrics?.totalQuantity],
  ["inventoryLow", (state) => state.inventoryMetrics?.lowStockCount]
]);

export function homeMetricVector(state) {
  return Object.fromEntries(METRIC_PATHS.map(([key, read]) => [key, Number(read(state) ?? 0)]));
}

export function compareHomeMetricSets(legacyState, serverState) {
  const legacy = homeMetricVector(legacyState);
  const server = homeMetricVector(serverState);
  const rows = METRIC_PATHS.map(([key]) => ({ key, legacy: legacy[key], server: server[key], equal: legacy[key] === server[key] }));
  return { equal: rows.every((row) => row.equal), rows, legacy, server };
}
