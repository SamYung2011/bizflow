import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const warranty = read("root-site/bizflow/customers-warranty.css");
const orders = read("root-site/bizflow/orders.css");

assert.match(
  warranty,
  /\.warranty-renewal-term\s*>\s*\.warranty-renewal-options\s*\{[\s\S]*?height:\s*40px;[\s\S]*?padding:\s*0;[\s\S]*?border-radius:\s*var\(--radius-10\);[\s\S]*?background:\s*var\(--gray-11\);[\s\S]*?\}[\s\S]*?\.warranty-renewal-term\s*>\s*\.warranty-renewal-options\s*>\s*button\s*\{[\s\S]*?height:\s*40px;[\s\S]*?\}[\s\S]*?\.warranty-renewal-term\s*>\s*\.warranty-renewal-options\s*>\s*button\.is-active\s*\{[\s\S]*?color:\s*var\(--blue\);[\s\S]*?background:\s*var\(--white\);/,
  "renewal term must use the structural 40px gray form segment with a white active slice"
);

assert.match(
  warranty,
  /\.warranty-renewal-modal\s*>\s*\.form-new-customer__footer\s*>\s*\.btn--hug\s*\{[\s\S]*?height:\s*40px;[\s\S]*?min-height:\s*40px;/,
  "renewal footer buttons must be 40px without changing the global btn--hug"
);

assert.match(
  orders,
  /--orders-status-selected:\s*var\(--blue\);\s*\/\*[^\n]*\u00a72\.1[^\n]*\*\//,
  "order selected controls must follow the documented shared blue decision"
);

console.log("UI-unify-2 contracts: PASS");
