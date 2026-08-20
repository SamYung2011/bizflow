import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  attachLiveSnapshotRefresh,
  liveSnapshotEventMatches
} from "../root-site/data/live-snapshot-listener.js";
import { LIVE_SNAPSHOT_UPDATED_EVENT } from "../root-site/data/live-snapshot-dependencies.js";

function event(detail) {
  const value = new Event(LIVE_SNAPSHOT_UPDATED_EVENT);
  Object.defineProperty(value, "detail", { value: detail });
  return value;
}

function pageScope() {
  const cleanups = [];
  let current = true;
  return {
    isCurrent: () => current,
    listen(target, type, handler) {
      target.addEventListener(type, handler);
      cleanups.push(() => target.removeEventListener(type, handler));
    },
    onCleanup(cleanup) {
      cleanups.push(cleanup);
    },
    dispose() {
      current = false;
      cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
    }
  };
}

async function settle() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

assert.equal(liveSnapshotEventMatches(event({ snapshot: "orders.json" }), {
  snapshots: ["orders.json"],
  tables: ["invoices"]
}), true);
assert.equal(liveSnapshotEventMatches(event({ snapshots: ["orders.json"], tables: ["customers"] }), {
  snapshots: ["orders.json"],
  tables: ["invoices"]
}), true);
assert.equal(liveSnapshotEventMatches(event({ tables: ["invoices"] }), {
  snapshots: ["orders.json"],
  tables: ["invoices"]
}), true);
assert.equal(liveSnapshotEventMatches(event({ tables: ["customers"] }), {
  snapshots: ["orders.json"],
  tables: ["invoices"]
}), false);

const target = new EventTarget();
const scope = pageScope();
let editing = false;
let sourceValue = 1;
let stateValue = 0;
let renders = 0;
const refresh = attachLiveSnapshotRefresh({
  scope,
  target,
  snapshots: ["orders.json"],
  tables: ["invoices"],
  isBlocked: () => editing,
  async refresh() {
    stateValue = sourceValue;
    renders += 1;
  },
  warn: (message, error) => assert.fail(`${message}: ${error}`)
});

target.dispatchEvent(event({ tables: ["customers"] }));
await settle();
assert.equal(renders, 0, "unrelated tables must not refresh the page");

sourceValue = 2;
target.dispatchEvent(event({ snapshot: "orders.json" }));
await settle();
assert.equal(stateValue, 2, "a relevant snapshot event must update page state");
assert.equal(renders, 1, "a relevant snapshot event must rerender once");

editing = true;
sourceValue = 3;
target.dispatchEvent(event({ tables: ["invoices"] }));
await settle();
assert.equal(stateValue, 2, "editing must defer realtime page updates");
assert.equal(refresh.pending, true, "a deferred refresh must remain observable");

editing = false;
assert.equal(await refresh.flush(), true, "editing completion must flush the deferred refresh");
assert.equal(stateValue, 3);
assert.equal(renders, 2, "a deferred burst must rerender once after editing");

scope.dispose();
sourceValue = 4;
target.dispatchEvent(event({ tables: ["invoices"] }));
await settle();
assert.equal(stateValue, 3, "disposed page scopes must ignore realtime events");

const [ordersSource, northboundSource, tasksControllerSource, whatsappSource, tableSource] = await Promise.all([
  readFile(new URL("../root-site/bizflow/orders.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/orders-northbound.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain-controller.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/whatsapp.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-snapshot-utils.js", import.meta.url), "utf8")
]);
assert.match(ordersSource, /snapshots:\s*\["orders\.json"\]/);
assert.match(northboundSource, /snapshots:\s*\["northbound\.json"\]/);
assert.match(tasksControllerSource, /snapshots:\s*\["tasks\.json"\]/);
assert.match(whatsappSource, /snapshots:\s*\[WHATSAPP_SNAPSHOT\]/);
assert.match(whatsappSource, /tables:\s*WHATSAPP_REALTIME_TABLES/);
assert.match(tableSource, /detail:\s*\{\s*tables:\s*refreshedTables,\s*snapshots\s*\}/);

console.log("Live snapshot page refresh contracts: PASS (match, rerender, edit deferral, disposal)");
