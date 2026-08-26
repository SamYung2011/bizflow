import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { cachedPageUnread, loadPageUnread } from "../root-site/data/page-unread.js";

const routeFiles = [
  "home.js",
  "orders.js",
  "orders-create.js",
  "orders-detail.js",
  "customers.js",
  "customer-detail.js",
  "inventory.js",
  "inventory-detail.js",
  "expense.js",
  "whatsapp.js",
  "app-feedback.js",
  "ocpp-monitor.js",
  "ocpp-charging.js",
  "ocpp-users.js",
  "ocpp-finance.js",
];
const routeSources = await Promise.all(routeFiles.map(async (file) => [
  file,
  await readFile(new URL(`../root-site/bizflow/${file}`, import.meta.url), "utf8"),
]));
const teamSources = await Promise.all(["tasks.js", "members.js"].map(async (file) => [
  `team/${file}`,
  await readFile(new URL(`../root-site/team/${file}`, import.meta.url), "utf8"),
]));

for (const [file, source] of [...routeSources, ...teamSources]) {
  const mount = source.slice(source.indexOf("export async function mountPage"));
  assert.ok(mount.startsWith("export async function mountPage"), `${file} must expose mountPage`);
  assert.doesNotMatch(mount, /await[^;\n]*(?:getUnread|getUnreadWatermarks)|Promise\.all\([^)]*(?:getUnread|getUnreadWatermarks)/s,
    `${file} must not await unread before first paint`);
  assert.match(source, /cachedPageUnread/, `${file} must render its cached or empty unread state`);
  assert.match(source, /loadPageUnread/, `${file} must refresh unread after activation`);
}

const authUser = { id: "spa-swr-contract-user", hasPermission() { return true; } };
assert.deepEqual(cachedPageUnread(authUser), { unread: {}, watermarks: {} });
let resolveUnread;
let resolveWatermarks;
let updated = null;
let dispatches = 0;
const unreadPromise = loadPageUnread({
  scope: { isCurrent: () => true },
  currentUser: authUser,
  readUnread: () => new Promise((resolve) => { resolveUnread = resolve; }),
  readWatermarks: () => new Promise((resolve) => { resolveWatermarks = resolve; }),
  onUpdate: (next) => { updated = next; },
  dispatchUpdated: () => { dispatches += 1; },
});
assert.equal(updated, null, "unread refresh must stay in the background");
resolveUnread({ orders: 2, messages: 1 });
resolveWatermarks({ orders: "2026-08-26T00:00:00.000Z" });
await unreadPromise;
assert.deepEqual(updated, {
  unread: { orders: 2, messages: 1 },
  watermarks: { orders: "2026-08-26T00:00:00.000Z" },
});
assert.equal(dispatches, 1, "resolved unread must trigger one badge-only shell update");
assert.deepEqual(cachedPageUnread(authUser), updated, "the next page must reuse the last unread state");

const orders = routeSources.find(([file]) => file === "orders.js")[1];
const ordersCss = await readFile(new URL("../root-site/bizflow/orders.css", import.meta.url), "utf8");
assert.equal((orders.match(/"orders\.updating":/g) ?? []).length, 3,
  "the lightweight updating badge must have zh/en/fr copy");
assert.match(orders, /ordersKeepRowsWhileLoading = currentDataMatchesOrderQuery\(\) && currentPageOrders\(\)\.length > 0/,
  "a same-query refresh must retain existing order rows");
assert.match(orders, /ordersLoading && !ordersKeepRowsWhileLoading \? \[\] : currentPageOrders\(\)/,
  "a genuinely uncached query variant may use the existing empty loading state");
assert.match(orders, /class="orders-updating"[^>]*role="status"/,
  "retained rows must expose a non-blocking updating status");
assert.match(ordersCss, /\.orders-toolbar\s*\{[\s\S]*?align-items:\s*flex-end/,
  "rerendered order filters must share one bottom alignment");
assert.match(ordersCss, /\.orders-table-region\s*\{[\s\S]*?position:\s*relative/);

const customers = routeSources.find(([file]) => file === "customers.js")[1];
assert.match(customers, /const nextData = await getCustomersPageData\(\);[\s\S]*?data = nextData;/,
  "customer realtime refresh must keep current rows until replacement data resolves");

console.log("SPA switch SWR contracts: PASS (orders retain rows, aligned filters, async unread, customer SWR)");
