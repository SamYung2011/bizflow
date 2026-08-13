import assert from "node:assert/strict";

import {
  createLiveRealtimeManager,
  visibleRealtimeTables
} from "../root-site/data/live-realtime.js";
import { WHATSAPP_REALTIME_TABLES } from "../root-site/data/live-whatsapp-contract.js";

function scheduler() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    schedule(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    },
    run() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    }
  };
}

function fakeClient() {
  const channels = [];
  const removed = [];
  return {
    channels,
    removed,
    channel(name) {
      const handlers = [];
      let statusHandler = null;
      const channel = {
        name,
        handlers,
        on(type, filter, callback) {
          handlers.push({ type, filter, callback });
          return channel;
        },
        subscribe(callback) {
          statusHandler = callback;
          return channel;
        },
        status(value) {
          statusHandler?.(value);
        },
        emit(table) {
          handlers.find((handler) => handler.filter.table === table)?.callback({ table });
        }
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      removed.push(channel);
    }
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

const teamUser = { userId: "team-user", bizflowMainAccess: false, isBfAdmin: false };
assert.deepEqual(visibleRealtimeTables(teamUser), [
  "employee_tasks",
  "task_assignees",
  "employee_task_feedbacks",
  "employees",
  "employee_departments"
]);
const nonAdminBizflowUser = { ...teamUser, bizflowMainAccess: true };
assert.deepEqual(visibleRealtimeTables(nonAdminBizflowUser), [
  "employee_tasks",
  "task_assignees",
  "employee_task_feedbacks",
  "employees",
  "employee_departments",
  "invoices",
  "customers",
  "charger_leads",
  "northbound_records",
  "northbound_statuses",
  "shipment_events",
  "products",
  "inventory_stock",
  "inventory_movements",
  "shopify_catalog_bindings",
  "shopify_variant_links",
  "shopify_resource_mappings",
  "expense_reimbursements",
  ...WHATSAPP_REALTIME_TABLES
]);
assert.deepEqual(visibleRealtimeTables(null), []);

// G-exp-8/E4 regression guard: "我的報銷" is a self-view every bizflow-main-access
// employee uses (not just isBfAdmin), and RLS (migration 088) requires
// has_bizflow_main_access() for a reimbursement row to exist at all -- so a
// non-admin submitter (isBfAdmin: false, bizflowMainAccess: true) must be
// subscribed to expense_reimbursements or their own cross-tab edits never
// arrive. See VERIFY-ROUND-B.md E4.
assert.equal(nonAdminBizflowUser.isBfAdmin, false, "fixture must stay non-admin to guard the E4 regression");
assert.ok(visibleRealtimeTables(nonAdminBizflowUser).includes("expense_reimbursements"),
  "non-admin bizflowMainAccess users must be subscribed to expense_reimbursements (G-exp-8/E4)");
assert.ok(!visibleRealtimeTables(teamUser).includes("expense_reimbursements"),
  "users without bizflow main access must not subscribe to expense_reimbursements");

const clock = scheduler();
const client = fakeClient();
const invalidations = [];
const refreshes = [];
let currentUser = { ...teamUser, userId: "main-user", bizflowMainAccess: true };
const manager = createLiveRealtimeManager({
  loadClient: async () => client,
  loadSession: async () => ({ user: { id: currentUser.userId } }),
  loadCurrentUser: async () => currentUser,
  invalidateTables: async (tables) => invalidations.push([...tables]),
  refreshTables: async (tables) => refreshes.push([...tables]),
  invalidationDelay: 1,
  scheduleTimeout: (callback) => clock.schedule(callback),
  cancelTimeout: (id) => clock.cancel(id),
  warn: (message, error) => assert.fail(`${message}: ${error}`)
});

assert.equal(await manager.ensure(), true);
assert.equal(client.channels.length, 1);
assert.deepEqual(client.channels[0].handlers.map(({ filter }) => filter.table), visibleRealtimeTables(currentUser));
// todo #270: nobody was holding this channel open while other people wrote, and
// live-table-cache hands back IndexedDB rows as fresh for 10 minutes -- so the first
// SUBSCRIBED must run the same catch-up pass a reconnect does, or a returning user
// stares at stale rows for up to a TTL even after a hard reload.
const mainUserTables = visibleRealtimeTables(currentUser);
client.channels[0].status("SUBSCRIBED");
clock.run();
await settle();
assert.deepEqual(invalidations, [mainUserTables], "first subscription must catch up on writes missed while away");
assert.deepEqual(refreshes, [mainUserTables]);

// A second SUBSCRIBED with no disconnect in between is not a reconnect: staying quiet
// keeps a chatty transport from turning the catch-up into a refresh loop.
client.channels[0].status("SUBSCRIBED");
clock.run();
await settle();
assert.equal(invalidations.length, 1, "repeated SUBSCRIBED without a disconnect must not re-trigger the catch-up");
assert.equal(refreshes.length, 1);

client.channels[0].emit("employee_tasks");
client.channels[0].emit("employee_tasks");
client.channels[0].emit("invoices");
clock.run();
await settle();
assert.deepEqual(invalidations[1], ["employee_tasks", "invoices"], "burst events must merge by table");
assert.deepEqual(refreshes[1], ["employee_tasks", "invoices"]);
assert.equal(invalidations.length, 2, "the burst must stay one flush, not double with the catch-up");

client.channels[0].status("CHANNEL_ERROR");
client.channels[0].status("SUBSCRIBED");
clock.run();
await settle();
assert.deepEqual(invalidations[2], mainUserTables, "reconnect must evict every subscribed table once");
assert.deepEqual(refreshes[2], mainUserTables);
assert.equal(invalidations.length, 3, "reconnect must flush exactly once");

currentUser = { ...teamUser, userId: "next-user" };
assert.equal(await manager.ensure(), true);
assert.equal(client.removed.length, 1, "user change must remove the previous channel");
assert.deepEqual(client.channels[1].handlers.map(({ filter }) => filter.table), visibleRealtimeTables(currentUser));
client.channels[0].emit("invoices");
clock.run();
await settle();
assert.equal(invalidations.length, 3, "late callbacks from an old user channel must be ignored");

// A re-established channel is a fresh first subscribe, and it must catch up on the new
// user's own scope only.
client.channels[1].status("SUBSCRIBED");
clock.run();
await settle();
assert.deepEqual(invalidations[3], visibleRealtimeTables(currentUser), "a re-established channel must catch up on its own scope");
assert.deepEqual(refreshes[3], visibleRealtimeTables(currentUser));
assert.equal(invalidations.length, 4, "the re-established catch-up must flush exactly once");

await manager.dispose();
assert.equal(client.removed.length, 2);
console.log("Live Realtime contracts: PASS (scope, throttle, first-subscribe catch-up, reconnect, user isolation)");
