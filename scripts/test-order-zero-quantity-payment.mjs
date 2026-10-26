import assert from 'node:assert/strict';
import { instrumentModule } from './test-support/bounded-page-runtime.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const zeroImei = '111111111111111', selectedImei = '222222222222222';
let count = 0;
async function check(label, run) { await run(); console.log(`ok ${++count} - ${label}`); }

// Keep the actual update/payment/stock logic; replace only Supabase IO with local rows.
function harness(items) {
  const tables = {
    invoices: [{ id: 'order', status: 'Unpaid', total: 900, customer_id: 'customer', items }],
    products: [{ id: 'charger', name: 'Selected charger', warranty_months: 0 }],
    warehouses: [{ id: 'warehouse', sort_order: 0 }],
    inventory_stock: [{ id: 'stock', product_id: 'charger', warehouse_id: 'warehouse', qty: 10 }],
    inventory_movements: [], stock_deduction_audit: [], inventory: [], customer_devices: [], line_item_aliases: []
  };
  const calls = [], invalidated = [];
  const client = { from(table) {
    assert.ok(table in tables, `unexpected table: ${table}`);
    const filters = [];
    let operation = 'select', payload;
    const run = single => {
      calls.push({ table, operation, payload: copy(payload ?? null) });
      let rows = tables[table].filter(row => filters.every(matches => matches(row)));
      if (operation === 'update') rows.forEach(row => Object.assign(row, copy(payload)));
      if (operation === 'insert') {
        rows = copy(Array.isArray(payload) ? payload : [payload]);
        tables[table].push(...rows);
      }
      return { data: copy(single ? rows[0] ?? null : rows), error: null };
    };
    return {
      select() { return this; }, order() { return this; },
      eq(key, value) { filters.push(row => row[key] === value); return this; },
      in(key, values) { filters.push(row => values.includes(row[key])); return this; },
      update(value) { operation = 'update'; payload = value; return this; },
      insert(value) { operation = 'insert'; payload = value; return this; },
      async single() { return run(true); }, async maybeSingle() { return run(true); },
      then(resolve, reject) { return Promise.resolve().then(() => run(false)).then(resolve, reject); }
    };
  } };
  const writes = instrumentModule(new URL('../root-site/data/live-orders-writes.js', import.meta.url), {
    getSupabaseClient: async () => client, getSession: async () => ({ user: { id: 'staff' } }),
    getCurrentUser: async () => ({ bizflowMainAccess: true, employeeId: 'employee' }),
    allRows: async table => copy(tables[table]),
    invalidateLiveTables: async (...names) => invalidated.push(names),
    invalidateOrderQueriesAfterWrite: async () => invalidated.push(['order-queries'])
  }, '({updateLiveOrder, markLiveOrderPaid})');
  return { writes, tables, calls, invalidated };
}
const remaining = [
  { id: 'zero-unmapped', name: 'Unselected option', qty: 0, price: 900, imei_code: zeroImei },
  { id: 'zero-mapped', name: 'Unselected archived option', qty: 0, price: 500, product_id: 'missing-product', warehouse_id: 'missing-warehouse', imei_code: zeroImei },
  { id: 'selected', name: 'Selected charger', qty: 2, price: 500, product_id: 'charger', warehouse_id: 'warehouse', imei_code: selectedImei }
];

await check('save after deleting one line then pay with other zero-quantity options retained', async () => {
  const { writes, tables, calls, invalidated } = harness([...remaining, { id: 'removed', name: 'Removed product', qty: 1, price: 99 }]);
  await writes.updateLiveOrder('order', { items: remaining, fees: { discount: 100 } });
  assert.equal(tables.invoices[0].total, 900);
  assert.ok(!tables.invoices[0].items.some(item => item.id === 'removed'));
  assert.deepEqual(tables.customer_devices.map(row => row.imei), [selectedImei]);
  const result = await writes.markLiveOrderPaid('order');
  assert.equal(result.invoice.status, 'Paid');
  assert.equal(result.alreadyPaid, false);
  assert.deepEqual(tables.invoices[0].items.slice(0, 2).map(item => item.qty), [0, 0]);
  assert.equal(tables.inventory_stock.length, 1);
  assert.equal(tables.inventory_stock[0].qty, 8);
  assert.deepEqual(tables.inventory_movements.map(row => [row.product_id, row.delta]), [['charger', -2]]);
  assert.deepEqual(tables.stock_deduction_audit.map(row => [row.item_name, row.mapped_qty]), [['Selected charger', 2]]);
  assert.deepEqual(tables.customer_devices.map(row => row.imei), [selectedImei]);
  assert.ok(!calls.some(call => call.table === 'inventory'));
  assert.ok(invalidated.some(names => names.includes('inventory_stock')));
  const repeat = await writes.markLiveOrderPaid('order');
  assert.equal(repeat.alreadyPaid, true);
  assert.equal(tables.inventory_stock[0].qty, 8);
  assert.equal(tables.inventory_movements.length, 1);
});
await check('paying imported zero-quantity options directly also binds only the selected IMEI', async () => {
  const { writes, tables } = harness(remaining);
  await writes.markLiveOrderPaid('order');
  assert.equal(tables.invoices[0].status, 'Paid');
  assert.equal(tables.inventory_stock[0].qty, 8);
  assert.deepEqual(tables.customer_devices.map(row => row.imei), [selectedImei]);
});
await check('all zero products plus positive fees cannot be saved or marked paid', async () => {
  const items = remaining.slice(0, 2);
  const { writes, tables, calls } = harness([...items, { id: 'fee', name: '運費', qty: 1, price: 100 }]);
  await assert.rejects(writes.updateLiveOrder('order', { items, fees: { shipping: 100 } }), /at least one product/);
  await assert.rejects(writes.markLiveOrderPaid('order'), /at least one product/);
  assert.equal(tables.invoices[0].status, 'Unpaid');
  assert.equal(tables.inventory_stock[0].qty, 10);
  assert.equal(calls.filter(call => call.operation !== 'select').length, 0);
});
await check('negative or missing quantities still fail before payment writes', async () => {
  for (const qty of [-1, undefined, 'invalid']) {
    const { writes, tables, calls } = harness([{ ...remaining[2], qty }]);
    await assert.rejects(writes.markLiveOrderPaid('order'), /valid quantity/);
    assert.equal(tables.invoices[0].status, 'Unpaid');
    assert.equal(calls.filter(call => call.operation !== 'select').length, 0);
  }
});
console.log(`ORDER_ZERO_QUANTITY_PAYMENT=${count}/${count}`);
