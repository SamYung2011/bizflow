import assert from "node:assert/strict";

import { fetchAllTablePages } from "../root-site/data/fetch-all-pages.js";

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        const call = { table, columns: null, options: null, from: null, to: null, orders: [] };
        calls.push(call);
        const chain = {
          select(columns, options) {
            call.columns = columns;
            call.options = options;
            return chain;
          },
          range(from, to) {
            call.from = from;
            call.to = to;
            return chain;
          },
          order(column, options) {
            call.orders.push([column, options]);
            return chain;
          },
          then(resolve, reject) {
            return Promise.resolve(responses.shift()).then(resolve, reject);
          }
        };
        return chain;
      }
    }
  };
}

const page = (start, length) => Array.from({ length }, (_, index) => ({ id: start + index }));
const counted = fakeClient([
  { data: page(0, 1000), count: 2001, error: null },
  { data: page(1000, 1000), count: null, error: null },
  { data: [{ id: 1999 }, { id: 2000 }], count: null, error: null }
]);
const countedRows = await fetchAllTablePages({
  client: counted.client,
  table: "northbound_records",
  columns: "*, status:northbound_statuses(id,label,color,sort_order)",
  orderCol: "created_at",
  ascending: false
});
assert.equal(countedRows.length, 2001, "parallel pages must deduplicate overlapping ids");
assert.equal(counted.calls.length, 3);
assert.deepEqual(counted.calls[0].options, { count: "exact" });
assert.equal(counted.calls[0].columns, "*, status:northbound_statuses(id,label,color,sort_order)");
assert.equal(Object.hasOwn(counted.calls[0].options, "head"), false, "count request must stay GET-based");
assert.deepEqual(counted.calls.map(({ from, to }) => [from, to]), [[0, 999], [1000, 1999], [2000, 2999]]);
assert.deepEqual(counted.calls[0].orders, [
  ["created_at", { ascending: false }],
  ["id", { ascending: true }]
]);

const fallback = fakeClient([
  { data: null, count: null, error: { message: "upstream 503" } },
  { data: page(0, 1000), count: null, error: null },
  { data: page(1000, 3), count: null, error: null }
]);
const fallbackRows = await fetchAllTablePages({
  client: fallback.client,
  table: "wa_logs",
  orderCol: "created_at"
});
assert.equal(fallbackRows.length, 1003, "failed counts must fall back to GET-only page walking");
assert.equal(fallback.calls.length, 3);
assert.deepEqual(fallback.calls[0].options, { count: "exact" });
assert.equal(fallback.calls[1].options, undefined);
assert.equal(fallback.calls[2].options, undefined);

const empty = fakeClient([{ data: [], count: 0, error: null }]);
assert.deepEqual(await fetchAllTablePages({ client: empty.client, table: "roles" }), []);
assert.equal(empty.calls.length, 1);

console.log("GET-based full-table pagination: PASS");
