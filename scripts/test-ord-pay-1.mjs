import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { aggregateRevenue } from "../root-site/components/order-metrics.js";
import { normalizedItems } from "../root-site/data/live-orders-writes.js";

const [writes, createPage, detailPage, ordersPage, ordersCss, shopifyOrders, shopifyMigration] = await Promise.all([
  readFile(new URL("../root-site/data/live-orders-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/orders-create.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/orders-detail.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/orders.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/orders.css", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/shopify-orders/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../migrations/079_shopify_orders_variant_sync.sql", import.meta.url), "utf8")
]);

const unpaidInsert = writes.slice(
  writes.indexOf("async function insertUnpaidLiveOrder"),
  writes.indexOf("async function restoreAfterPaidFailure")
);

assert.deepEqual(normalizedItems([{
  id: "line-db-shape",
  name: "DB product",
  qty: 2,
  price: 99,
  product_id: "product-db",
  warehouse_id: "warehouse-db",
  warranty_months: 24,
  imei_code: "123456789012345"
}]), [{
  id: "line-db-shape",
  name: "DB product",
  qty: 2,
  price: 99,
  product_id: "product-db",
  warehouse_id: "warehouse-db",
  warranty_months: 24,
  imei_code: "123456789012345"
}], "DB-shaped invoice items must retain product, warehouse, warranty and IMEI fields before later payment");

assert.match(unpaidInsert, /status: "Unpaid"/,
  "manual order creation must always begin with an Unpaid invoice");
assert.doesNotMatch(unpaidInsert, /inventory_stock|inventory_movements|stock_deduction_audit/,
  "the Unpaid invoice insert half must not deduct inventory");

const createWrite = writes.slice(
  writes.indexOf("export async function createLiveOrder"),
  writes.indexOf("export async function createAndPayLiveOrder")
);
assert.match(createWrite, /if \(normalizedStatus === "unpaid"\) \{[\s\S]*?invalidateOrderReads\("invoices"\);[\s\S]*?return \{ invoice, deviceConflicts: \[\], alreadyPaid: false \};/,
  "Unpaid creation must return after invalidating invoices and before the payment half");
assert.match(createWrite, /payLiveOrderRecord\(context, invoice, \{ deleteInvoiceOnFailure: true, paymentPlan \}\)/,
  "default paid creation must retain the create-and-pay recovery contract");
assert.match(writes, /export async function createAndPayLiveOrder\(values\) \{[\s\S]*?paymentStatus: "Paid"/,
  "the legacy paid helper must remain as a paid compatibility wrapper");
assert.match(writes, /export async function markLiveOrderPaid\(invoiceId\)[\s\S]*?payLiveOrderRecord\(context, invoiceResult\.data\)/,
  "order detail must expose the reusable payment half");
assert.match(writes, /\.update\(\{ status: "Paid", commission_amount: commission \}\)[\s\S]*?\.eq\("status", recovery\.invoiceStatus\)/,
  "payment must claim the current invoice status before inventory writes");
assert.match(writes, /if \(recovery\.deleteInvoiceOnFailure && recovery\.invoiceId\)[\s\S]*?else if \(recovery\.claimed && recovery\.invoiceId\)[\s\S]*?status: recovery\.invoiceStatus/,
  "failed create-and-pay may delete its new invoice while failed later payment restores Unpaid");
assert.match(writes, /Inventory changed while the order was being paid/,
  "the existing stock compare-and-swap conflict must remain in the payment half");

assert.match(createPage, /import \{[\s\S]*?createLiveOrder,[\s\S]*?\} from "\.\.\/data\/live-orders-writes\.js";/,
  "the form must call the split order creator");
assert.match(createPage, /paymentStatus: "paid"/,
  "manual orders must default to today's paid behavior");
assert.match(createPage, /renderSharedSegment\(\{[\s\S]*?key: "paid"[\s\S]*?key: "unpaid"[\s\S]*?active: state\.paymentStatus[\s\S]*?dataAttribute: "data-payment-status"/,
  "the paid/unpaid choice must expose its real state through the shared segment");
assert.match(createPage, /paymentStatus: state\.paymentStatus === "paid" \? "Paid" : "Unpaid"/,
  "the selected payment state must reach the live write helper");
assert.match(createPage, /data-create-paid-total>[\s\S]*?paidText/,
  "Unpaid creation must display a zero paid amount");

assert.match(detailPage, /markLiveOrderPaid,/,
  "order detail must import the payment write helper");
assert.match(detailPage, /data-order-mark-paid/,
  "an Unpaid detail must render the mark-paid action");
assert.match(detailPage, /confirmInPage\(pageT\(lang, "orders\.payment\.confirm"\), \{[\s\S]*?confirmLabel:/,
  "mark-paid must require the approved in-page confirmation");
assert.match(detailPage, /if \(orderFinancialDraftChanged\(\)\)[\s\S]*?orders\.payment\.saveFirst/,
  "unsaved financial edits must be saved before payment uses the stored invoice");
assert.match(detailPage, /detailData\.order\.status = "completed"/,
  "successful payment must update the current detail without waiting for a reload");
assert.match(detailPage, /data-detail-paid-total>[\s\S]*?paidText/,
  "Unpaid details must not present the invoice total as already paid");
assert.match(detailPage, /"orders\.receipt"[\s\S]*?"receipt", !paid, helpers/,
  "the receipt action must stay disabled until payment");
assert.match(ordersCss, /\.orders-payment-check-row > \.orders-money-input\s*\{[^}]*grid-column:\s*3;[^}]*width:\s*100%;[^}]*justify-self:\s*end;/,
  "fee inputs and their disabled placeholders must share the payment card's right-hand money column at every width");
assert.match(ordersCss, /\.orders-payment-status-row > \.orders-payment-status-segment\s*\{[^}]*width:\s*min\(280px, 60%\);[^}]*flex:\s*0 0 auto;[^}]*align-self:\s*center;/,
  "the shared payment segment must retain the approved compact desktop width");
assert.match(ordersCss, /\.orders-payment-status-row > span\s*\{[^}]*flex:\s*none;/,
  "the payment-status label must retain its natural width beside the compact segment");
assert.doesNotMatch(ordersCss, /(?:^|\n)\.orders-payment-status-segment\s*\{/,
  "the compact override must not regress to a source-order-dependent single-class selector");

assert.match(ordersPage, /"in-progress": "orders\.status\.unpaid"/,
  "the order list must label Unpaid invoice rows explicitly");
assert.match(ordersPage, /order\.status === "in-progress"[\s\S]*?order-chip--unpaid[\s\S]*?statusLabel/,
  "the Unpaid label must be visible on the order card, not only exposed as an icon tooltip");
for (const source of [createPage, detailPage, ordersPage]) {
  for (const language of ["zh", "en", "fr"]) {
    assert.match(source, new RegExp(`${language}: \\{`), `${language} copy must remain present`);
  }
}

const revenue = aggregateRevenue([
  { date: "2026/07/03", status: "completed", customer: "Paid", detail: { paymentTotal: 100, items: [] } },
  { date: "2026/07/04", status: "in-progress", customer: "Unpaid", detail: { paymentTotal: 60, items: [] } }
], { aliases: [], customers: [], products: [] }, "thisMonth", new Date("2026-07-21T08:00:00Z"));
assert.equal(revenue.totalRevenue, 100, "Unpaid invoices must remain excluded from revenue");
assert.equal(revenue.paidCount, 1);
assert.equal(revenue.unpaidCount, 1);
assert.equal(revenue.unpaidAmount, 60, "the existing unpaid KPI must continue reporting unpaid value separately");
assert.equal(revenue.customers.find((customer) => customer.name === "Unpaid")?.totalAmount, 60,
  "the existing customer ranking must retain its all-in-range invoice basis");

assert.match(shopifyOrders, /financial_status:paid/,
  "Shopify polling must remain restricted to paid orders");
assert.match(shopifyMigration, /INSERT INTO invoices\([\s\S]*?COALESCE\(p_total, 0\),[\s\S]*?'Paid'/,
  "Shopify's paid invoice RPC status must remain unchanged");

console.log("ORD-pay-1 contracts: PASS (paid default, Unpaid no-deduct, confirmed later payment, rollback, status UI, revenue and Shopify parity)");
