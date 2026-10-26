import assert from 'node:assert/strict';
import { instrumentModule, deferred, pageScope, pageBindings } from './test-support/bounded-page-runtime.mjs';

const file = name => new URL('../root-site/' + name, import.meta.url);
const copy = value => JSON.parse(JSON.stringify(value));
const helpers = { lang: 'zh', escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'), icon: () => '<svg aria-hidden="true"></svg>' };
let count = 0;
async function check(label, run) { await run(); console.log(`ok ${++count} - ${label}`); }
const fixture = () => ({
  order: { id: 'order', status: 'pending' },
  detail: { orderNo: '#84183', paymentTotal: 4388, fees: { shipping: 100, discount: 200 }, items: [
    { id: 'form', name: 'Type2 Wall charger', quantity: 0, price: 900 },
    { id: 'selected', productId: 'charger', name: 'Type2 充電樁 22kW', quantity: 1, price: 4488, warehouseId: 'warehouse', warrantyMonths: 12, imeiCode: '' }
  ] }
});
const saved = [], confirmations = [];
let access = true, saveError = null, saveWait = null, inputs = [];
const page = instrumentModule(file('bizflow/orders-detail.js'), {
  ...pageBindings,
  document: { ...pageBindings.document, querySelectorAll: selector => inputs.filter(input => input.selector === selector) },
  getOrderDetailData: async () => fixture(),
  getCurrentUser: async () => ({ hasPermission: () => true, bizflowMainAccess: access }),
  getOrderProductPickerData: async () => ({ productGroups: [] }),
  getLiveOrderWriteOptions: async () => ({ invoice: { id: 'order' }, salespeople: [], defaultWarehouseId: 'warehouse' }),
  updateLiveOrder: async (id, values) => {
    saved.push(copy({ id, values }));
    if (saveWait) await saveWait.promise;
    if (saveError) throw saveError;
    return { invoice: { total: 4388 }, deviceConflicts: [] };
  },
  confirmInPage: async message => { confirmations.push(message); return false; },
  console: { ...console, error() {} }
}, '({mountPage, ensureOrderEditData, onOrderDetailClick, removeOrderItem, resetOrderChanges, saveOrderChanges, renderLineRows, renderPaymentBox, currentTotals, getState:()=>state})');
let scope, mounted;
async function mount({ editable = true } = {}) {
  mounted?.dispose();
  scope?.stop();
  scope = pageScope();
  mounted = await page.mountPage({ scope, signal: scope.signal });
  if (editable) await page.ensureOrderEditData();
}
const remove = index => page.onOrderDetailClick({ target: {
  closest: selector => selector === '[data-line-remove]' ? { getAttribute: () => String(index) }
    : selector === '[data-orders-write]' ? {} : null
} });

await check('delete is available only after entering editable mode', async () => {
  await mount({ editable: false });
  assert.doesNotMatch(page.renderLineRows(helpers), /data-line-remove/);
  await remove(0);
  assert.equal(page.getState().items.length, 2);
  await page.ensureOrderEditData();
  assert.equal((page.renderLineRows(helpers).match(/data-line-remove=/g) || []).length, 2);
});
await check('zero quantity contributes zero to subtotal before removal', () => {
  assert.equal(page.currentTotals().subtotal, 4488);
});
await check('removing the form row keeps the selected row, fees and dirty navigation guard', async () => {
  await remove(0);
  assert.deepEqual(copy(page.getState().items), [fixture().detail.items[1]]);
  assert.deepEqual(copy(page.currentTotals()), { subtotal: 4488, paymentTotal: 4388 });
  assert.equal(saved.length, 0);
  assert.equal(mounted.hasUnsavedChanges(), true);
  assert.equal(await mounted.canLeave(), false);
  assert.match(confirmations.at(-1), /尚未保存/);
  assert.match(page.renderPaymentBox(helpers, 4488, 4388, false), /1 件商品/);
});
await check('last item is disabled and cannot be removed even by direct invocation', async () => {
  assert.match(page.renderLineRows(helpers), /data-line-remove="0"[^>]*disabled aria-disabled="true"/);
  await remove(0);
  assert.equal(page.getState().items.length, 1);
  assert.match(page.getState().notice, /至少保留/);
});
await check('cancel restores both rows and original totals without writing', () => {
  page.resetOrderChanges();
  assert.deepEqual(copy(page.getState().items), fixture().detail.items);
  assert.equal(page.currentTotals().paymentTotal, 4388);
  assert.equal(mounted.hasUnsavedChanges(), false);
  assert.equal(saved.length, 0);
});
await check('repeated products remove only the clicked occurrence', async () => {
  page.getState().items.push({ ...fixture().detail.items[1], id: 'second-occurrence', price: 100 });
  await remove(2);
  assert.deepEqual(copy(page.getState().items), fixture().detail.items);
});
await check('pending input is preserved and untouched zero quantities stay zero', async () => {
  page.getState().items.push({ id: 'extra', name: 'Extra', quantity: 1, price: 10 });
  inputs = [
    { selector: '[data-line-quantity]', getAttribute: () => 'form', value: '0' },
    { selector: '[data-line-price]', getAttribute: () => 'selected', value: '4600' }
  ];
  await remove(2);
  inputs = [];
  assert.equal(page.getState().items[0].quantity, 0);
  assert.equal(page.getState().items[1].price, 4600);
  assert.equal(page.currentTotals().paymentTotal, 4500);
  page.resetOrderChanges();
});
await check('removing the only positive-quantity product cannot save just zero lines and fees', async () => {
  const n = saved.length;
  page.getState().fees.shipping = 500;
  await remove(1);
  await page.saveOrderChanges();
  assert.match(page.getState().notice, /至少保留/);
  assert.equal(saved.length, n);
  page.resetOrderChanges();
});
await check('busy operations block removal and disable row actions', async () => {
  page.getState().busy = 'order';
  await remove(0);
  assert.equal(page.getState().items.length, 2);
  assert.match(page.renderLineRows(helpers), /data-line-remove="0"[^>]*disabled/);
  page.getState().busy = '';
});
await check('failed save retains deletion draft and allows retry', async () => {
  await remove(0);
  saveError = new Error('offline');
  await page.saveOrderChanges();
  assert.equal(page.getState().items.length, 1);
  assert.equal(page.getState().savedItems.length, 2);
  assert.equal(mounted.hasUnsavedChanges(), true);
  assert.equal(page.getState().busy, '');
  assert.match(page.getState().notice, /保存失敗/);
});
await check('successful save sends remaining products and fees without stale total override', async () => {
  saveError = null;
  await page.saveOrderChanges();
  const last = saved.at(-1);
  assert.equal(last.id, 'order');
  assert.deepEqual(last.values.items, [fixture().detail.items[1]]);
  assert.deepEqual(last.values.fees, { shipping: 100, deposit: 0, discount: 200, service: 0 });
  assert.ok(!('totalOverride' in last.values));
  assert.equal(mounted.hasUnsavedChanges(), false);
  page.resetOrderChanges();
  assert.equal(page.getState().items.length, 1);
});
await check('read-only users have no row actions and cannot mutate the draft', async () => {
  access = false;
  await mount();
  assert.doesNotMatch(page.renderLineRows(helpers), /data-line-remove/);
  await remove(0);
  page.removeOrderItem(0);
  assert.equal(page.getState().items.length, 2);
  access = true;
});
await check('row action labels support Chinese, English, French and escape product names', async () => {
  await mount();
  page.getState().items[0].name = '<img "product">';
  for (const [lang, label] of [['zh', '刪除商品'], ['en', 'Remove product'], ['fr', 'Supprimer le produit']]) {
    const html = page.renderLineRows({ ...helpers, lang });
    assert.ok(html.includes(label));
    assert.ok(html.includes('&lt;img &quot;product&quot;>'));
    assert.ok(!html.includes('<img "product">'));
  }
});
await check('save completion from a disposed page cannot update the next order', async () => {
  await remove(0);
  saveWait = deferred();
  const pending = page.saveOrderChanges();
  await mount();
  saveWait.resolve();
  await pending;
  saveWait = null;
  assert.equal(page.getState().items.length, 2);
  assert.equal(page.getState().savedItems.length, 2);
  assert.equal(page.getState().notice, '');
});
mounted.dispose(); scope.stop();

let invoice = { id: 'order', status: 'Unpaid', customer_id: null }, writeError = null;
const updates = [], invalidations = [], tables = [];
const client = { from(table) {
  tables.push(table);
  let payload;
  return {
    select() { return this; }, eq() { return this; }, update(value) { payload = value; return this; },
    async single() {
      if (!payload) return { data: invoice, error: null };
      if (writeError) return { data: null, error: writeError };
      updates.push(copy(payload)); invoice = { ...invoice, ...payload }; return { data: invoice, error: null };
    }
  };
} };
const writes = instrumentModule(file('data/live-orders-writes.js'), {
  getSupabaseClient: async () => client, getSession: async () => ({ user: { id: 'staff' } }),
  getCurrentUser: async () => ({ bizflowMainAccess: access }),
  invalidateLiveTables: async (...names) => invalidations.push(names),
  invalidateOrderQueriesAfterWrite: async row => invalidations.push(['order-queries', row.id]),
  allRows: async table => table === 'products' ? [{ id: 'charger', name: 'Type2 充電樁 22kW', category: '轉插' }] : []
}, '({updateLiveOrder, normalizedItems})');
await check('write preserves remaining zero lines, metadata, fees and invalidates order caches', async () => {
  await writes.updateLiveOrder('order', { items: fixture().detail.items, fees: { shipping: 100, discount: 200 } });
  const result = updates.at(-1);
  assert.equal(result.items[0].qty, 0);
  assert.equal(result.items[1].product_id, 'charger');
  assert.equal(result.items[1].warehouse_id, 'warehouse');
  assert.equal(result.items[1].warranty_months, 12);
  assert.equal(result.total, 4388);
  assert.deepEqual(invalidations, [['invoices', 'customer_devices'], ['order-queries', 'order']]);
  assert.ok(tables.every(table => table === 'invoices'));
});
await check('paid order editing recalculates commission from the remaining products', async () => {
  invoice = { ...invoice, status: 'Paid', date: '2026-10-23', salesperson_id: 'sales' };
  await writes.updateLiveOrder('order', { items: [fixture().detail.items[1]], fees: { discount: 200 }, salespersonId: 'sales' });
  assert.equal(updates.at(-1).commission_amount, 600);
  assert.equal(updates.at(-1).total, 4288);
});
await check('empty order, nonpositive total and invalid quantities still cannot save', async () => {
  const n = updates.length;
  await assert.rejects(writes.updateLiveOrder('order', { items: [], fees: { shipping: 100 } }), /at least one product/);
  await assert.rejects(writes.updateLiveOrder('order', { items: [fixture().detail.items[0]], fees: { shipping: 100 } }), /at least one product/);
  await assert.rejects(writes.updateLiveOrder('order', { items: [{ ...fixture().detail.items[1], price: 0 }], fees: {} }), /total must be greater/);
  for (const quantity of [-1, NaN, Infinity]) {
    assert.throws(() => writes.normalizedItems([{ name: 'Product', quantity }], { allowZeroQuantity: true }), /valid quantity/);
  }
  assert.throws(() => writes.normalizedItems(fixture().detail.items), /valid quantity/);
  assert.equal(updates.length, n);
});
await check('denied access and failed writes do not fake cache success', async () => {
  const n = invalidations.length;
  access = false;
  await assert.rejects(writes.updateLiveOrder('order', { items: fixture().detail.items }), /write context/);
  access = true; writeError = new Error('write failed');
  await assert.rejects(writes.updateLiveOrder('order', { items: fixture().detail.items }), /write failed/);
  assert.equal(invalidations.length, n);
});
console.log(`ORDER_ITEM_REMOVE=${count}/${count}`);
