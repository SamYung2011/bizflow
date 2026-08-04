import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderEmailSuggestion, safeSetSelectionRange, suggestEmail } from "../root-site/components/email-suggest.js";
import { renderNewCustomerFields } from "../root-site/components/new-customer-fields.js";
import {
  customerDictionaries,
  customerMatchesSearch,
  renderCustomerRow
} from "../root-site/bizflow/customers.js";
import {
  warrantyBucket,
  warrantyBucketCounts,
  warrantyDictionaries
} from "../root-site/bizflow/customers-warranty.js";
import {
  chargerLeadDictionaries,
  renderChargerLeadCards
} from "../root-site/bizflow/orders-charger-leads.js";
import {
  orderDictionaries,
  orderMatchesSearch,
  renderOrderCard
} from "../root-site/bizflow/orders.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };

// G-cus-1: the old tolerance contract is preserved and both form surfaces expose a clickable suggestion.
assert.equal(suggestEmail("person@gmial.com"), "person@gmail.com");
assert.equal(suggestEmail("person@gmail.com"), null);
assert.equal(suggestEmail("person@unknown.invalid"), null);
assert.match(renderEmailSuggestion({ value: "person@gmial.com", lang: "zh", escapeHtml, target: "new-customer" }), /是不是 person@gmail\.com？/);
const newFields = renderNewCustomerFields({
  lang: "zh",
  escapeHtml,
  label: (key) => key,
  idPrefix: "test",
  values: { email: "person@gmial.com" }
});
assert.match(newFields, /data-email-suggestion="person@gmail\.com"/);
assert.match(newFields, /data-email-suggestion-target="new-customer"/);

// G-cus-1 regression (2026-08-04 nightrun cust-1 FAIL): <input type="email"> does not support
// setSelectionRange() and throws InvalidStateError; safeSetSelectionRange must skip it instead of
// calling through, while still restoring the caret on input types that do support selection.
{
  const calls = [];
  const mockInput = (type, value) => ({
    type,
    value,
    setSelectionRange: (start, end) => calls.push([type, start, end])
  });
  safeSetSelectionRange(mockInput("email", "person@gmail.com"));
  safeSetSelectionRange(mockInput("number", "123"));
  safeSetSelectionRange(mockInput("text", "hello"));
  safeSetSelectionRange(mockInput("search", "abc"), 1, 2);
  safeSetSelectionRange(null);
  assert.deepEqual(calls, [["text", 5, 5], ["search", 1, 2]], "safeSetSelectionRange must skip email/number inputs and no-op on null, but still restore the caret on text/search inputs");
}

const customer = {
  id: "customer-1",
  name: "主名",
  phone: "+852 9000 0000",
  source: "other",
  joinedAt: "2026/08/03",
  imei: "8626 3506-6310 269",
  imeiCodes: ["8626 3506-6310 269"],
  allNames: ["主名", "Alias Chan"],
  allEmails: ["alias@example.com"],
  allPhones: ["+852 9123 4567"],
  allPhoneMainlands: ["+86 138 0013 8000"],
  allCarMakes: ["Tesla"],
  allCarModels: ["Model 3"],
  type: "VIP",
  hasEmail: true,
  hasPhone: true,
  hasImei: true,
  orderCount: 2,
  detail: { totalAmount: 12345, carModel: "Tesla Model 3", email: "alias@example.com" }
};

// G-cus-3/12/13: every normalized search dimension is represented and the row shows type, IMEI and spend.
for (const query of ["Alias Chan", "alias@example.com", "9123 4567", "91234567", "862635066310269", "Tesla", "Model 3"]) {
  assert.equal(customerMatchesSearch(customer, query), true, `customer search missed ${query}`);
}
assert.equal(customerMatchesSearch(customer, "not-present"), false);
const customerHtml = renderCustomerRow(customer, helpers);
assert.match(customerHtml, />VIP</);
assert.match(customerHtml, /IMEI：8626 3506-6310 269/);
assert.match(customerHtml, /HKD\$12,345/);

// G-cus-15: buckets are mutually exclusive and their total equals all.
const today = new Date(2026, 7, 3);
const bucketRows = [
  { expiry: "2026/08/02", bucket: warrantyBucket("2026/08/02", today) },
  { expiry: "2026/08/07", bucket: warrantyBucket("2026/08/07", today) },
  { expiry: "2026/08/20", bucket: warrantyBucket("2026/08/20", today) },
  { expiry: "2026/10/01", bucket: warrantyBucket("2026/10/01", today) },
  { expiry: "2027/01/01", bucket: warrantyBucket("2027/01/01", today) }
];
assert.deepEqual(bucketRows.map((row) => row.bucket), ["expired", "week", "month", "quarter", "year"]);
assert.deepEqual(warrantyBucketCounts(bucketRows), { all: 5, expired: 1, week: 1, month: 1, quarter: 1, year: 1 });

// G-ord-5: the existing raw lead payload now surfaces every read-only information slot.
const leadHtml = renderChargerLeadCards([{
  id: "lead-1",
  name: "Lead User",
  phone: "91234567",
  phone_mainland: "13800138000",
  status: "interested",
  charger_model: "HM-AC7",
  install_service: "Standard",
  car_make: "Tesla",
  car_model: "Model Y",
  selected_products: ["Cable", "Box"],
  address: "Hong Kong",
  quoted_fee: 8000,
  referral: "Friend",
  created_at: "2026-08-03T12:34:00Z",
  pending_merge_cid: "customer-old"
}], helpers);
for (const expected of ["HM-AC7", "Standard", "Tesla Model Y", "Cable", "HK$ 8,000", "Friend", "2026-08-03 12:34", "疑似老客戶待合併"]) {
  assert.match(leadHtml, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `lead card missed ${expected}`);
}

// G-ord-13: DC form and raw form both match; visible card includes sales, note and second line item.
const order = {
  id: "order-1",
  invoiceNumber: "123",
  dcNumber: "DC00123",
  status: "completed",
  customer: "Order User",
  phone: "91234567",
  channel: "Framer",
  product: "First item",
  qty: "×1",
  date: "2026/08/03",
  amount: "HKD$ 100",
  detail: {
    orderNo: "#123",
    salesperson: "Helen",
    note: "Front desk",
    items: [
      { name: "First item", quantity: 1 },
      { name: "Second item", quantity: 2 }
    ]
  }
};
assert.equal(orderMatchesSearch(order, "DC00123"), true);
assert.equal(orderMatchesSearch(order, "123"), true);
assert.equal(orderMatchesSearch(order, "Second item"), true);
const orderHtml = renderOrderCard(order, helpers);
for (const expected of ["DC00123", "負責銷售：Helen", "備註：Front desk", "Second item", "×2"]) assert.match(orderHtml, new RegExp(expected));

for (const lang of ["zh", "en", "fr"]) {
  for (const key of ["customers.count", "customers.totalSpend", "customers.imei"]) assert.equal(typeof customerDictionaries[lang][key], "string", `${lang}.${key}`);
  for (const key of ["count", "all", "expired", "week", "month", "quarter", "year"]) assert.equal(typeof warrantyDictionaries[lang][key], "string", `${lang}.warranty.${key}`);
  for (const key of ["installService", "vehicle", "accessories", "address", "quotedFee", "referral", "submittedAt", "pendingMerge"]) assert.equal(typeof chargerLeadDictionaries[lang][key], "string", `${lang}.lead.${key}`);
  for (const key of ["orders.salesperson", "orders.note"]) assert.equal(typeof orderDictionaries[lang][key], "string", `${lang}.${key}`);
}

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [customersUi, customerDetailUi, warrantyUi, snapshots, cache, provider] = await Promise.all([
  read("root-site/bizflow/customers.js"),
  read("root-site/bizflow/customer-detail.js"),
  read("root-site/bizflow/customers-warranty.js"),
  read("root-site/data/live-snapshots.js"),
  read("root-site/data/live-table-cache.js"),
  read("root-site/data/provider.js")
]);
assert.match(customersUi, /!c\.hasEmail && !c\.hasPhone && !c\.hasImei/);
assert.match(customersUi, /data-customers-visible-count/);
assert.match(customerDetailUi, /data-email-suggestion-target="edit-customer"/);
assert.match(warrantyUi, /data-warranty-bucket=/);

// G-cus-1 static guard: the email field's caret restore must always go through the type-aware
// helper, never call setSelectionRange on the email input directly (that's what threw
// InvalidStateError in the 2026-08-04 nightrun cust-1 verify round).
assert.doesNotMatch(customersUi, /email\?\.setSelectionRange\(/, "customers.js must not call setSelectionRange directly on the email input");
assert.doesNotMatch(customerDetailUi, /email\?\.setSelectionRange\(/, "customer-detail.js must not call setSelectionRange directly on the email input");
const safeSelectionCallCount = (source) => (source.match(/safeSetSelectionRange\(email\)/g) ?? []).length;
assert.equal(safeSelectionCallCount(customersUi), 2, "customers.js should route both email caret restores (click suggestion + input) through safeSetSelectionRange");
assert.equal(safeSelectionCallCount(customerDetailUi), 2, "customer-detail.js should route both email caret restores (click suggestion + input) through safeSetSelectionRange");
for (const field of ["allNames", "allEmails", "allPhones", "allPhoneMainlands", "allCarMakes", "allCarModels", "imeiCodes", "type"]) assert.match(snapshots, new RegExp(`${field}:`), `snapshot missing ${field}`);
for (const field of ["invoiceNumber", "dcNumber", "note"]) assert.match(snapshots, new RegExp(`${field}:`), `order snapshot missing ${field}`);
assert.match(cache, /\["customers\.json", 2\]/);
assert.match(cache, /\["orders\.json", 2\]/);
assert.match(provider, /typeof row\.invoiceNumber === "string" && typeof row\.dcNumber === "string"/);

console.log("NR-cust-1 contracts: PASS (email suggestion, customer search/rows, warranty buckets, lead/order information, cache generations, email selectionrange safety)");
