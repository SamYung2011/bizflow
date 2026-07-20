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
  "employee_task_feedbacks"
]);
assert.deepEqual(visibleRealtimeTables({ ...teamUser, bizflowMainAccess: true }), [
  "employee_tasks",
  "task_assignees",
  "employee_task_feedbacks",
  "invoices",
  "northbound_records",
  "northbound_statuses",
  ...WHATSAPP_REALTIME_TABLES
]);
assert.deepEqual(visibleRealtimeTables(null), []);

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
client.channels[0].status("SUBSCRIBED");
clock.run();
await settle();
assert.deepEqual(invalidations, [], "initial subscription must not evict warm caches");

client.channels[0].emit("employee_tasks");
client.channels[0].emit("employee_tasks");
client.channels[0].emit("invoices");
clock.run();
await settle();
assert.deepEqual(invalidations, [["employee_tasks", "invoices"]], "burst events must merge by table");
assert.deepEqual(refreshes, [["employee_tasks", "invoices"]]);

client.channels[0].status("CHANNEL_ERROR");
client.channels[0].status("SUBSCRIBED");
clock.run();
await settle();
assert.deepEqual(invalidations[1], visibleRealtimeTables(currentUser), "reconnect must evict every subscribed table once");
assert.deepEqual(refreshes[1], visibleRealtimeTables(currentUser));

currentUser = { ...teamUser, userId: "next-user" };
assert.equal(await manager.ensure(), true);
assert.equal(client.removed.length, 1, "user change must remove the previous channel");
assert.deepEqual(client.channels[1].handlers.map(({ filter }) => filter.table), visibleRealtimeTables(currentUser));
client.channels[0].emit("invoices");
clock.run();
await settle();
assert.equal(invalidations.length, 2, "late callbacks from an old user channel must be ignored");

await manager.dispose();
assert.equal(client.removed.length, 2);
console.log("Live Realtime contracts: PASS (scope, throttle, reconnect, user isolation)");
