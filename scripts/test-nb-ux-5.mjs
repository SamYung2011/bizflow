import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { clearPhoneCopyNotice, copyPhoneNumber, phoneCopyLabel } from "../root-site/components/phone-copy.js";

let clipboardValue = "";
let notice = null;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { clipboard: { writeText: async (value) => { clipboardValue = value; } } }
});
globalThis.window = { clearTimeout() {}, setTimeout: () => 1 };
globalThis.document = {
  body: { append(value) { notice = value; } },
  createElement() {
    return {
      className: "",
      dataset: {},
      attributes: {},
      textContent: "",
      setAttribute(name, value) { this.attributes[name] = value; },
      remove() { if (notice === this) notice = null; }
    };
  },
  querySelector(selector) {
    return selector === "[data-phone-copy-notice]" ? notice : null;
  }
};

assert.equal(phoneCopyLabel("+852 1234", "zh"), "複製電話 +852 1234");
assert.equal(phoneCopyLabel("+852 1234", "en"), "Copy phone +852 1234");
assert.equal(phoneCopyLabel("+852 1234", "fr"), "Copier le téléphone +852 1234");
assert.equal(await copyPhoneNumber("  +852 1234  ", "zh"), true);
assert.equal(clipboardValue, "+852 1234", "clipboard must receive the trimmed phone value without a tel: prefix");
assert.equal(notice?.textContent, "已複製 +852 1234");
clearPhoneCopyNotice();
assert.equal(notice, null);

const [orders, customers, warranty, datePanel, northbound, domainCss] = await Promise.all([
  readFile(new URL("../root-site/bizflow/orders.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/customers.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/customers-warranty.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/components/date-range-panel.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/orders-northbound.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/orders-domain.css", import.meta.url), "utf8")
]);

assert.match(orders, /from "\.\.\/components\/phone-copy\.js"/);
assert.match(customers, /from "\.\.\/components\/phone-copy\.js"/);
assert.match(warranty, /from "\.\.\/components\/phone-copy\.js"/);
assert.match(orders, /scope\.listen\(document, "contextmenu", onOrdersContextMenu\)/);
assert.match(orders, /event\.stopPropagation\(\)/);
assert.match(datePanel, /data-date-range-action="jump"/);
assert.match(datePanel, /data-date-range-year/);
assert.match(datePanel, /data-date-range-month/);
assert.equal((northbound.match(/chooseMonth:/g) ?? []).length, 3, "northbound date panel text must have three languages");
assert.equal((warranty.match(/chooseMonth:/g) ?? []).length, 3, "warranty date panel text must have three languages");
assert.match(northbound, /northbound-cell--long northbound-cell--address/);
assert.match(domainCss, /\.northbound-cell--address:not\(\[data-northbound-edit-active\]\)/);

console.log("NB-ux-5 contracts: PASS (shared phone copy, quick month jump, address wrapping)");
