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
const catchUps = [];
let currentTime = 0;
let currentUser = { ...teamUser, userId: "main-user", bizflowMainAccess: true };
const manager = createLiveRealtimeManager({
  loadClient: async () => client,
  loadSession: async () => ({ user: { id: currentUser.userId } }),
  loadCurrentUser: async () => currentUser,
  invalidateTables: async (tables) => invalidations.push([...tables]),
  refreshTables: async (tables) => refreshes.push([...tables]),
  markTablesStale: async (tables) => catchUps.push([...tables]),
  invalidationDelay: 1,
  catchUpMinInterval: 60_000,
  now: () => currentTime,
  scheduleTimeout: (callback) => clock.schedule(callback),
  cancelTimeout: (id) => clock.cancel(id),
  warn: (message, error) => assert.fail(`${message}: ${error}`)
});

assert.equal(await manager.ensure(), true);
assert.equal(client.channels.length, 1);
assert.deepEqual(client.channels[0].handlers.map(({ filter }) => filter.table), visibleRealtimeTables(currentUser));
const mainUserTables = visibleRealtimeTables(currentUser);
client.channels[0].status("SUBSCRIBED");
clock.run();
await settle();
assert.deepEqual(catchUps, [mainUserTables], "first subscription must mark missed tables stale");
assert.deepEqual(invalidations, [], "first subscription must not enqueue eager table invalidation");
assert.deepEqual(refreshes, [], "first subscription must not refetch every previously queried table");

// A second SUBSCRIBED with no disconnect in between is not a reconnect: staying quiet
// keeps a chatty transport from turning the catch-up into a refresh loop.
client.channels[0].status("SUBSCRIBED");
clock.run();
await settle();
assert.equal(catchUps.length, 1, "repeated SUBSCRIBED without a disconnect must not re-trigger the catch-up");
assert.equal(refreshes.length, 0);

client.channels[0].emit("employee_tasks");
client.channels[0].emit("employee_tasks");
client.channels[0].emit("invoices");
clock.run();
await settle();
assert.deepEqual(invalidations[0], ["employee_tasks", "invoices"], "burst events must merge by table");
assert.deepEqual(refreshes[0], ["employee_tasks", "invoices"]);
assert.equal(invalidations.length, 1, "the burst must stay one flush");

client.channels[0].status("CHANNEL_ERROR");
client.channels[0].status("SUBSCRIBED");
clock.run();
await settle();
assert.equal(catchUps.length, 1, "a reconnect inside 60 seconds must be throttled");
assert.equal(refreshes.length, 1, "a throttled reconnect must not start a refresh storm");

currentTime += 60_000;
client.channels[0].status("CHANNEL_ERROR");
client.channels[0].status("SUBSCRIBED");
await settle();
assert.deepEqual(catchUps[1], mainUserTables, "a reconnect after the throttle window must mark tables stale once");
assert.equal(refreshes.length, 1, "catch-up after the throttle window must remain stale-only");

currentUser = { ...teamUser, userId: "next-user" };
assert.equal(await manager.ensure(), true);
assert.equal(client.removed.length, 1, "user change must remove the previous channel");
assert.deepEqual(client.channels[1].handlers.map(({ filter }) => filter.table), visibleRealtimeTables(currentUser));
client.channels[0].emit("invoices");
clock.run();
await settle();
assert.equal(invalidations.length, 1, "late callbacks from an old user channel must be ignored");

// A re-established channel is a fresh first subscribe, and it must catch up on the new
// user's own scope only.
client.channels[1].status("SUBSCRIBED");
clock.run();
await settle();
assert.deepEqual(catchUps[2], visibleRealtimeTables(currentUser), "a re-established channel must mark its own scope stale");
assert.equal(refreshes.length, 1, "the re-established catch-up must not eagerly refresh tables");
assert.equal(catchUps.length, 3, "the re-established catch-up must run exactly once");

await manager.dispose();
assert.equal(client.removed.length, 2);
console.log("Live Realtime contracts: PASS (scope, event batching, stale-only catch-up, 60s reconnect throttle, user isolation)");
