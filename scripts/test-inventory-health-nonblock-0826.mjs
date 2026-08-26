import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { inventoryWriteAccess, runInventoryHealthCheck } from "../root-site/bizflow/inventory-health.js";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [inventory, detail, healthHelper, shopify] = await Promise.all([
  read("root-site/bizflow/inventory.js"),
  read("root-site/bizflow/inventory-detail.js"),
  read("root-site/bizflow/inventory-health.js"),
  read("root-site/bizflow/inventory-shopify.js"),
]);

const readyHealth = { connected: true, writeReady: true };
assert.deepEqual(
  inventoryWriteAccess({ authenticated: true, isAdmin: true, checking: true, health: null }),
  { checking: true, ready: false, liveReadOnly: true, writeAttributes: ' disabled aria-disabled="true"' },
  "an administrator must paint disabled controls while health is pending",
);
assert.deepEqual(
  inventoryWriteAccess({ authenticated: true, isAdmin: true, checking: false, health: readyHealth }),
  { checking: false, ready: true, liveReadOnly: false, writeAttributes: "" },
  "a ready health response must enable administrator controls",
);
assert.equal(
  inventoryWriteAccess({ authenticated: true, isAdmin: true, checking: false, health: null }).liveReadOnly,
  true,
  "a failed health response must remain read-only",
);
assert.equal(
  inventoryWriteAccess({ authenticated: true, isAdmin: false, checking: false, health: readyHealth }).liveReadOnly,
  true,
  "a non-administrator must remain read-only even if the shared health response is ready",
);

let resolveHealth;
let appliedHealth = "pending";
let loadOptions = null;
const deferredCheck = runInventoryHealthCheck({
  isCurrent: () => true,
  loadHealth: (options) => {
    loadOptions = options;
    return new Promise((resolve) => { resolveHealth = resolve; });
  },
  onSettled: (health) => { appliedHealth = health; },
});
assert.equal(appliedHealth, "pending", "health must remain asynchronous after activation");
resolveHealth(readyHealth);
assert.equal(await deferredCheck, true);
assert.deepEqual(loadOptions, { refresh: true });
assert.equal(appliedHealth, readyHealth, "the current page must receive the ready health response");

let staleApplied = false;
assert.equal(await runInventoryHealthCheck({
  isCurrent: () => false,
  loadHealth: async () => readyHealth,
  onSettled: () => { staleApplied = true; },
}), false);
assert.equal(staleApplied, false, "a stale page scope must never apply or rerender from a late response");

let rejectedHealth = "pending";
assert.equal(await runInventoryHealthCheck({
  isCurrent: () => true,
  loadHealth: async () => { throw new Error("edge unavailable"); },
  onSettled: (health) => { rejectedHealth = health; },
}), true);
assert.equal(rejectedHealth, null, "a rejected health request must settle into the fail-closed state");

for (const [name, source] of [["inventory", inventory], ["inventory-detail", detail]]) {
  assert.equal((source.match(/"inventory\.shopifyWriteChecking":/g) ?? []).length, 3,
    `${name} checking banner must have zh/en/fr copy`);
  assert.match(source, /shopifyHealthChecking = authenticated && currentUser\?\.isBfAdmin === true/,
    `${name} must check only for an authenticated administrator`);
  assert.match(source, /inventoryWriteAccess\(\{[\s\S]*?checking: shopifyHealthChecking,[\s\S]*?health: shopifyHealth/,
    `${name} must derive control state from the shared behavioral gate`);
  assert.match(source, /data-shopify-health-checking="\$\{checking\}" aria-busy="\$\{checking\}"/,
    `${name} banner must expose its transition state without hardcoded UI copy`);

  const mount = source.slice(source.indexOf("export async function mountPage"), source.indexOf("    activate()"));
  assert.doesNotMatch(mount, /getShopifyCredentialHealth/,
    `${name} mount must not start or await the Edge health call`);
  assert.match(mount, /shopifyHealth = null;[\s\S]*?shopifyHealthChecking = authenticated/,
    `${name} first paint must use an explicit checking state`);
  const activate = source.slice(source.indexOf("    activate()"), source.indexOf("    hasUnsavedChanges"));
  assert.match(activate, /if \(shopifyHealthChecking\) void refreshShopifyHealth\(scope\)/,
    `${name} must start the health request only after activation`);

  const refresh = source.slice(source.indexOf("function refreshShopifyHealth"), source.indexOf("function formatHkd"));
  assert.match(refresh, /runInventoryHealthCheck\(\{/);
  assert.match(refresh, /onSettled\(nextHealth\)[\s\S]*?shopifyHealthChecking = false;[\s\S]*?syncShopifyWriteAccess\(\);[\s\S]*?rerender/,
    `${name} must apply health, recompute controls and rerender together`);
}

assert.match(healthHelper, /await loadHealth\(\{ refresh: true \}\)[\s\S]*?if \(!isCurrent\(\)\) return false;[\s\S]*?onSettled\(health\)/,
  "the shared runner must refresh health before its stale-scope guard and apply only current results");
assert.match(inventory, /isCurrent: \(\) => isCurrentInventoryScope\(scope\)/,
  "inventory list health completion must retain the page-scope guard");
assert.match(detail, /isCurrent: \(\) => scope\.isCurrent\(\)/,
  "inventory detail health completion must retain the page-scope guard");
assert.match(inventory, /focusSearch: document\.activeElement\?\.matches\("\[data-inventory-search\]"\) === true/,
  "the delayed list rerender must preserve an active search input");
assert.match(shopify, /export async function ensureShopifyData[\s\S]*?getShopifyCredentialHealth\(\)/,
  "the Shopify tab must keep its existing lazy data/health path");

console.log("inventory health non-blocking contracts: PASS (paint-first, fail-closed, guarded enable, lazy Shopify tab)");
