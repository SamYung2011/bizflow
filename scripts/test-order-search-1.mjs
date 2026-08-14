import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { matchesSearchValues } from "../root-site/components/search-match.js";

// 订单页搜索对齐共享匹配口径(#359 同族收尾):orders.js 不便整模块导入(顶层拉 provider 链),
// 照 test-inv-negative-1 的路子把 orderMatchesSearch 函数体从源码抠出来真跑,不做纯文本断言。

const source = await readFile(new URL("../root-site/bizflow/orders.js", import.meta.url), "utf8");

// 旧写法不许回来:原文 includes 的手写匹配。
assert.doesNotMatch(
  source,
  /orderMatchesSearch[\s\S]{0,600}toLocaleLowerCase\(\)\.includes/,
  "orderMatchesSearch must not hand-roll a raw includes matcher again"
);
assert.match(
  source,
  /import \{ matchesSearchValues \} from "\.\.\/components\/search-match\.js";/,
  "orders.js must reuse the shared search matcher"
);

const bodyMatch = source.match(/export function orderMatchesSearch\(order, query\) \{([\s\S]*?)\n\}/);
assert.ok(bodyMatch, "orderMatchesSearch must exist");
const orderMatchesSearch = new Function(
  "matchesSearchValues", "order", "query",
  `${bodyMatch[1].replace(/^\s*return /m, "return ")}`
);
const run = (order, query) => orderMatchesSearch(matchesSearchValues, order, query);

const order = {
  dcNumber: "DC-2026-001",
  invoiceNumber: "INV 8001",
  customer: "陳大文",
  phone: "+852 9123 4567",
  product: "Adapter X",
  detail: {
    orderNo: "ORD-77",
    salesperson: "Helen",
    note: "急件",
    trackingNo: "SF 123-456",
    carMake: "Tesla",
    carModelValue: "Model 3",
    carModel: "Tesla Model 3",
    items: [{ name: "Charger Pro" }, null]
  }
};

// 电话:连号 / 带空格 / 带横杠 / 带区号,四个方向都要命中(与客户列表、保修提醒同口径)。
assert.equal(run(order, "91234567"), true, "compact phone must match spaced storage");
assert.equal(run(order, "9123 4567"), true);
assert.equal(run(order, "9123-4567"), true);
assert.equal(run(order, "+852 9123-4567"), true);
// 车型:与客户列表同一组三字段(carMake/carModelValue/carModel),厂牌、型号、连写都要命中。
assert.equal(run(order, "tesla"), true, "car make must match");
assert.equal(run(order, "model 3"), true, "car model must match");
assert.equal(run(order, "tesla model 3"), true);
assert.equal(run(order, "teslamodel3"), true, "compact car model must match spaced storage");
assert.equal(run(order, "Model-3"), true);
assert.equal(run(order, "bmw"), false, "other car model must not match");
const orderNoCar = { ...order, detail: { ...order.detail, carMake: null, carModelValue: null, carModel: null } };
assert.equal(run(orderNoCar, "tesla"), false, "order without car fields must not match car query");
// 其他字段原有行为不回归:原文、大小写、item 名、trackingNo 压缩形态。
assert.equal(run(order, "dc-2026-001"), true);
assert.equal(run(order, "charger pro"), true);
assert.equal(run(order, "SF123456"), true, "compact tracking number must match spaced storage");
assert.equal(run(order, "急件"), true);
assert.equal(run(order, ""), true, "empty query keeps every row");
assert.equal(run(order, "99999999"), false);
assert.equal(run(order, "undefined"), false, "null-ish fields must not surface as the text 'undefined'");

console.log("Order search contracts: PASS (shared matcher, phone normalization, no regression)");
