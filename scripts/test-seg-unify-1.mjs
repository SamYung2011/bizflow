import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderSegment } from "../root-site/components/segment.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("root-site/components/segment.css");
const loginHtml = read("root-site/login/index.html");
const loginJs = read("root-site/login/login.js");

assert.match(
  css,
  /--app-segment-radius:\s*calc\(var\(--radius-10\)\s*\+\s*var\(--app-segment-padding\)\)/,
  "the shared segment radius must stay concentric with its 10px button and track padding"
);
assert.doesNotMatch(css, /--app-segment-figma-radius/,
  "the former login-only 14px radius must be absorbed by the concentric formula");
assert.match(css, /--app-segment-bg:\s*var\(--gray-15\)/);
assert.match(css, /\.app-segment--login\s*\{[\s\S]*?--app-segment-bg:\s*var\(--gray-12\)/,
  "the approved base and login track colors must remain unchanged");

assert.match(
  css,
  /width:\s*calc\(\(100%\s*-\s*var\(--app-segment-padding\)\s*-\s*var\(--app-segment-padding\)\s*-\s*\(var\(--app-segment-count\)\s*-\s*1\)\s*\*\s*var\(--app-segment-gap\)\)\s*\/\s*var\(--app-segment-count\)\)/,
  "the sliding indicator width must account for N equal buttons, N-1 gaps, and both track paddings"
);
assert.match(
  css,
  /translateX\(calc\(var\(--app-segment-active-index\)\s*\*\s*\(100%\s*\+\s*var\(--app-segment-gap\)\)\)\)/,
  "the sliding indicator must advance by activeIndex button widths and gaps"
);
assert.doesNotMatch(css, /app-segment--sliding\[data-active-index="1"\]/,
  "the shared slider must no longer be hard-coded to two buttons");

const escapeHtml = (value) => String(value);
const sliding = renderSegment({
  items: ["one", "two", "three", "four", "five"].map((key) => ({ key, label: key })),
  active: "three",
  ariaLabel: "tabs",
  escapeHtml,
  dataAttribute: "data-test-tab"
});
assert.match(sliding, /class="app-segment app-segment--domain app-segment--sliding"/);
assert.match(sliding, /data-active-index="2"/);
assert.match(sliding, /style="--app-segment-count:5;--app-segment-active-index:2"/);

const parallel = renderSegment({
  items: ["one", "two", "three"].map((key) => ({ key, label: key })),
  active: "two",
  ariaLabel: "parallel tabs",
  escapeHtml,
  dataAttribute: "data-test-tab",
  sliding: false
});
assert.match(parallel, /app-segment--parallel/);
assert.doesNotMatch(parallel, /app-segment--sliding/);

assert.match(loginHtml, /data-segment data-active-index="0" style="--app-segment-count:2;--app-segment-active-index:0"/);
assert.match(loginJs, /segment\.dataset\.activeIndex\s*=\s*String\(segmentIndex\)/);
assert.match(loginJs, /segment\.style\.setProperty\("--app-segment-count"/);
assert.match(loginJs, /segment\.style\.setProperty\("--app-segment-active-index"/);

for (const [path, attribute] of [
  ["root-site/bizflow/orders.js", "data-orders-domain-tab"],
  ["root-site/bizflow/customers.js", "data-customers-tab"],
  ["root-site/bizflow/inventory.js", "data-inventory-tab"],
  ["root-site/bizflow/expense.js", "data-expense-filter"],
  ["root-site/bizflow/ocpp-shared.js", "tabAttribute"]
]) {
  const source = read(path);
  assert.match(source, /render(?:Shared)?Segment\(\{/,
    `${path} must render its page tabs through the N-key shared segment`);
  assert.ok(source.includes(attribute), `${path} must retain ${attribute}`);
}

assert.match(read("root-site/bizflow/whatsapp.js"), /dataAttribute:\s*"data-wa-tab",\s*sliding:\s*false/,
  "the WhatsApp long-tab family must retain its existing non-sliding behavior");
assert.match(read("root-site/bizflow/ocpp-charging-share.js"), /dataAttribute:\s*"data-ocpp-share-tab",\s*sliding:\s*false/,
  "the OCPP inner segment must retain its existing non-sliding behavior");

console.log("SEG-unify-1 contracts: PASS (concentric radius, N-key slider, page coverage, parallel-family exclusions)");
