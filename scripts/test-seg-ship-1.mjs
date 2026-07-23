import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderSegment } from "../root-site/components/segment.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const detail = read("root-site/bizflow/orders-detail.js");
const create = read("root-site/bizflow/orders-create.js");
const ordersCss = read("root-site/bizflow/orders.css");
const legacySegmentClass = ["orders", "logistics", "segment"].join("-");

assert.match(detail, /import \{ renderSegment as renderSharedSegment \} from "\.\.\/components\/segment\.js"/);
assert.match(create, /import \{ renderSegment as renderSharedSegment \} from "\.\.\/components\/segment\.js"/);
assert.match(
  detail,
  /renderSharedSegment\(\{[\s\S]*?key: "delivery", label: pageT\(lang, "orders\.shipping"\)[\s\S]*?key: "pickup", label: pageT\(lang, "orders\.pickup"\)[\s\S]*?active: state\.shippingMode[\s\S]*?dataAttribute: "data-shipping-mode"/,
  "the tracking card must use the shared segment with the existing delivery/pickup labels"
);
assert.match(
  create,
  /renderSharedSegment\(\{[\s\S]*?key: "paid", label: pageT\(lang, "orders\.paid"\)[\s\S]*?key: "unpaid", label: pageT\(lang, "orders\.unpaid"\)[\s\S]*?active: state\.paymentStatus[\s\S]*?dataAttribute: "data-payment-status"[\s\S]*?className: "orders-payment-status-segment"[\s\S]*?buttonDataAttributes: \["data-orders-write"\][\s\S]*?disabled: liveReadOnly/,
  "the create-order payment choice must use the shared segment without changing its write gate"
);
assert.match(
  create,
  /renderSharedSegment\(\{[\s\S]*?key: "delivery", label: pageT\(lang, "orders\.delivery"\)[\s\S]*?key: "pickup", label: pageT\(lang, "orders\.pickup"\)[\s\S]*?active: state\.shippingMode[\s\S]*?dataAttribute: "data-shipping-mode"[\s\S]*?buttonDataAttributes: \["data-shipping-write", "data-orders-write"\][\s\S]*?disabled: shippingPermissionDenied/,
  "the create-order delivery/pickup choice must use the shared segment and retain shipping authorization"
);

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
assert.match(rendered, /aria-selected="true" class="app-segment__button is-active" data-shipping-mode="pickup"/);
assert.match(rendered, /title="Shipping permission required"/);

assert.match(create, /function initialState\(\)[\s\S]*?paymentStatus: "paid"/,
  "new manual orders must still default to paid");
assert.match(
  create,
  /const paymentStatus = event\.target\.closest\("\[data-payment-status\]"\);[\s\S]*?state\.paymentStatus = paymentStatus\.getAttribute\("data-payment-status"\) === "unpaid" \? "unpaid" : "paid";[\s\S]*?rerender\(\);/,
  "explicitly selecting unpaid must retain the existing state transition"
);
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
for (const [name, source] of [["order detail", detail], ["order create", create], ["orders CSS", ordersCss]]) {
  assert.equal(source.includes(legacySegmentClass), false, `${name} must not retain the legacy self-drawn segment`);
}

console.log("SEG-ship-1 contracts: PASS (three shared segments, permissions, paid default, switch/save/cancel parity)");
