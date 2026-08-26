import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { customerMatchesSearch, renderCustomerRow } from "../root-site/bizflow/customers.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const customer = {
  id: "customer-vehicle",
  name: "曾嘉欣",
  phone: "+852 9012 3987",
  joinedAt: "2026/05/04",
  source: "other",
  orderCount: 4,
  detail: { carModel: "Toyota BZ3X" }
};

for (const lang of ["zh", "en", "fr"]) {
  const html = renderCustomerRow(customer, { escapeHtml, lang });
  assert.match(html, /class="customer-row__car" title="Toyota BZ3X">Toyota BZ3X<\/span>/,
    `${lang} customer row must show the same label-free vehicle value`);
}

const missingVehicle = renderCustomerRow({ ...customer, detail: {} }, { escapeHtml, lang: "zh" });
assert.doesNotMatch(missingVehicle, /customer-row__car/,
  "an old cached customer without carModel must not render a placeholder");
assert.doesNotMatch(missingVehicle, /undefined|null/,
  "missing vehicle data must never leak JavaScript sentinel text");

const whitespaceVehicle = renderCustomerRow({
  ...customer,
  detail: { carModel: "   " }
}, { escapeHtml, lang: "zh" });
assert.doesNotMatch(whitespaceVehicle, /customer-row__car/,
  "whitespace-only vehicle data must not occupy card space");

const escapedVehicle = renderCustomerRow({
  ...customer,
  detail: { carModel: "Smart <#5> & Premium" }
}, { escapeHtml, lang: "zh" });
assert.match(escapedVehicle, /title="Smart &lt;#5&gt; &amp; Premium">Smart &lt;#5&gt; &amp; Premium<\/span>/,
  "vehicle text and its title must remain escaped");

const [customersSource, customerCss, liveSnapshotsSource, fetchAllSource, warrantySource, liveCustomerQuerySource] = await Promise.all([
  readFile(new URL("../root-site/bizflow/customers.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/customers.css", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-snapshots.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/fetch-all-pages.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/customers-warranty.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-customers-query.js", import.meta.url), "utf8")
]);

assert.match(liveSnapshotsSource, /allRows\("customers", "name"\)/,
  "customer snapshot must continue reading the customers live table");
assert.match(fetchAllSource, /columns = "\*"/,
  "the shared table reader must keep all customer columns, including car_make and car_model");
assert.match(liveSnapshotsSource, /carModel: `\$\{asText\(customer\.car_make\)\} \$\{asText\(customer\.car_model\)\}`\.trim\(\) \|\| null/,
  "snapshot vehicle value must join only the non-empty make/model content");

const filterFlow = customersSource.slice(customersSource.indexOf("function currentCustomerQuery"), customersSource.indexOf("function initials"));
assert.match(filterFlow, /search: state\.search/);
assert.match(liveCustomerQuerySource, /rpc: "bizflow_customer_page"[\s\S]*p_search: query\.search \|\| null/,
  "customer search, including the visible vehicle value, must be applied by the server page RPC");
assert.equal(customerMatchesSearch(customer, "曾嘉欣"), true);
assert.equal(customerMatchesSearch(customer, "90123987"), true);
assert.equal(customerMatchesSearch(customer, "Toyota BZ3X"), true,
  "NR-cust-1 intentionally expands customer search to the visible vehicle value");

const captureFlow = customersSource.slice(customersSource.indexOf("captureState()"), customersSource.indexOf("dispose()"));
for (const key of ["tab", "sort", "source", "imei", "search", "page", "dateFilter", "warranty"]) {
  assert.match(captureFlow, new RegExp(`\\b${key}:`), `customers captureState must retain ${key}`);
}
assert.match(warrantySource, /function renderWarrantyRow\(item, helpers\)/,
  "warranty reminders keep their distinct renderer and stay outside CU-car-1");
assert.match(customerCss, /\.customer-row__car \{[\s\S]*?min-width: 0;[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/,
  "vehicle metadata must stay secondary and truncate without widening the card");

console.log("CU-car-1 contracts: PASS (vehicle value, empty compatibility, data columns, expanded search/BF/warranty scope, trilingual render)");
