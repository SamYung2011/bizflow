import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderSegment } from "../root-site/components/segment.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const detail = read("root-site/bizflow/orders-detail.js");
const ordersCss = read("root-site/bizflow/orders.css");

assert.match(detail, /import \{ renderSegment as renderSharedSegment \} from "\.\.\/components\/segment\.js"/);
assert.match(
  detail,
  /renderSharedSegment\(\{[\s\S]*?key: "delivery", label: pageT\(lang, "orders\.shipping"\)[\s\S]*?key: "pickup", label: pageT\(lang, "orders\.pickup"\)[\s\S]*?active: state\.shippingMode[\s\S]*?dataAttribute: "data-shipping-mode"/,
  "the tracking card must use the shared segment with the existing delivery/pickup labels"
);
assert.doesNotMatch(detail, /<div class="orders-logistics-segment" role="tablist">/,
  "the order-detail tracking card must not retain its self-drawn segment");

const rendered = renderSegment({
  items: [
    { key: "delivery", label: "Shipping" },
    { key: "pickup", label: "Pickup" }
  ],
  active: "pickup",
  ariaLabel: "Tracking",
  escapeHtml: (value) => String(value),
  dataAttribute: "data-shipping-mode",
  buttonDataAttributes: ["data-shipping-write", "data-orders-write"],
  disabled: true,
  disabledTitle: "Shipping permission required"
});
assert.match(rendered, /class="app-segment app-segment--domain app-segment--sliding"/);
assert.match(rendered, /data-shipping-mode="delivery" data-shipping-write data-orders-write disabled aria-disabled="true"/);
assert.match(rendered, /data-shipping-mode="pickup" data-shipping-write data-orders-write disabled aria-disabled="true"/);
assert.match(rendered, /title="Shipping permission required"/);

assert.match(
  detail,
  /const shippingMode = event\.target\.closest\("\[data-shipping-mode\]"\);[\s\S]*?state\.shippingMode = shippingMode\.getAttribute\("data-shipping-mode"\);[\s\S]*?rerender\(\);/,
  "shared segment clicks must keep the existing mode-switch behavior"
);
assert.match(
  detail,
  /if \(event\.target\.closest\("\[data-shipping-cancel\]"\)\) \{[\s\S]*?state\.shippingMode = state\.savedShippingMode;[\s\S]*?state\.trackingNumber = state\.savedTrackingNumber;/,
  "cancel must still restore the saved mode and tracking number"
);
assert.match(
  detail,
  /updateLiveOrderShipping\([\s\S]*?mode: state\.shippingMode,[\s\S]*?trackingNumber: state\.trackingNumber/,
  "saving must still submit the selected mode and tracking number through the live write path"
);

assert.doesNotMatch(ordersCss, /\.orders-pickup-(?:border-box|line|box|row)\b/,
  "unreferenced pickup-only CSS must be removed");
assert.match(ordersCss, /\.orders-logistics-segment\s*\{/,
  "the create-order form still uses its logistics segment family and must not regress in this detail-only change");

console.log("SEG-ship-1 contracts: PASS (shared segment, permissions, switch/save/cancel parity)");
