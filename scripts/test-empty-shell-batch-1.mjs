import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [customers, customerDetail, liveSnapshots, liveOrderWrites, orders] = await Promise.all([
  readFile(new URL("../root-site/bizflow/customers.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/customer-detail.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-snapshots.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-orders-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/orders.js", import.meta.url), "utf8")
]);

assert.match(customers, /import \{ createLiveOrderCustomer \} from "\.\.\/data\/live-orders-writes\.js";/,
  "customer list must reuse the approved live customer create helper");
assert.match(customers, /const result = await createLiveOrderCustomer\(values\);/,
  "customer list submit must perform the live insert");
assert.match(customers, /data = await getCustomersPageData\(\);/,
  "a successful insert must refresh the customer list snapshot");
assert.match(customers, /console\.error\("\[customers\] customer write failed", error\);/,
  "customer create failures must remain visible and diagnosable");
assert.match(customers, /if \(!liveMode\) \{[\s\S]*?state\.modalOpen = false;[\s\S]*?\} else if \(liveWritable/,
  "demo submit must preserve its close-only behavior");

const addSubmit = customers.match(/<button[^>]+data-customers-modal-submit[^>]*>/)?.[0] ?? "";
assert.ok(addSubmit, "customer create modal must expose a dedicated submit control");
assert.doesNotMatch(addSubmit, /data-customers-modal-close/,
  "customer create submit must not share cancel/X close semantics");
assert.match(customers, /data-customers-modal-close[\s\S]*?data-customers-modal-submit/,
  "customer create modal must retain separate close and submit controls");
assert.match(customers, /state\.customerDraft\[customerField\.getAttribute\("data-new-customer-field"\)\] = customerField\.value;/,
  "customer create fields must feed the live-write draft");

assert.match(customerDetail, /import \{ updateLiveOrderCustomer \} from "\.\.\/data\/live-orders-writes\.js";/,
  "customer detail must reuse the approved live customer update helper");
assert.match(customerDetail, /await updateLiveOrderCustomer\(detailData\.customer\.id, values, \{ preserveCarModel \}\)/,
  "customer detail submit must update the displayed live customer");
assert.match(customerDetail, /state\.editDraft\[field\.getAttribute\("data-customer-edit-field"\)\] = field\.value;/,
  "customer detail inputs must update the saved draft");
const editSubmit = customerDetail.match(/<button[^>]+data-customer-edit-submit[^>]*>/)?.[0] ?? "";
assert.ok(editSubmit, "customer edit modal must expose a dedicated submit control");
assert.doesNotMatch(editSubmit, /data-customer-edit-close/,
  "customer edit submit must not share cancel/X close semantics");
assert.match(customerDetail, /if \(!liveMode\) closeEditModal\(\);/,
  "customer detail demo submit must remain close-only");
assert.match(customerDetail, /hasUnsavedChanges: hasCustomerDetailUnsavedChanges/,
  "customer detail must expose dirty-state detection to the SPA lifecycle");
assert.match(customerDetail, /return confirmInPage\(pageT\(currentHelpers\?\.lang \?\? "zh", "customer\.leaveUnsaved"\)\);/,
  "dirty customer edits must use the shared in-page leave confirmation");
assert.match(customerDetail, /deferredActionAttributes = liveReadOnly \? ' disabled aria-disabled="true"' : "";/,
  "later merge/delete wiring must retain the batch-1 read-only authorization gate");
assert.match(customerDetail, /state\.editModelFallback && values\.carModel === customerEditBaseline\(\)\.carModel/,
  "an untouched combined model from an old cache must be preserved rather than rewritten");

for (const source of [customers, customerDetail]) {
  assert.match(source, /liveWritable = liveMode && currentUser\?\.bizflowMainAccess === true;/,
    "live customer writes must use the same bizflowMainAccess gate as orders");
  assert.match(source, /liveReadOnly = liveMode && !liveWritable;/,
    "authenticated users without main access must receive disabled controls");
  for (const language of ["zh", "en", "fr"]) {
    assert.match(source, new RegExp(`${language}: \\{`), `${language} copy must remain present`);
  }
}

assert.match(liveSnapshots, /carMake: asText\(customer\.car_make\),\s+carModelValue: asText\(customer\.car_model\),/,
  "customer detail edits must receive raw make/model fields instead of rewriting the combined display value");
assert.match(liveOrderWrites, /if \(preserveCarModel\) delete payload\.car_model;/,
  "the shared update helper must omit car_model for an untouched legacy combined-value fallback");
assert.match(orders, /renderNorthbound\(\{ \.\.\.helpers, liveMode, liveReadOnly \}\)/,
  "northbound controls must receive the real live read-only state");
assert.doesNotMatch(orders, /renderNorthbound\(\{ \.\.\.helpers, liveMode, liveReadOnly: false \}\)/,
  "northbound must not bypass live write authorization");

console.log("Empty-shell batch 1 contracts: PASS (customer create/edit writes, modal semantics, dirty guard, northbound auth, trilingual feedback)");
