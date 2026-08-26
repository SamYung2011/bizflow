// WAR-search-1(todo #359,使用者 2026-08-13 报):客户列表输电话能搜到人,保修提醒输同一个电话搜不到。
// 根因不是组件没复用,是两页各写了一份搜索判断:客户列表把搜索词和字段都压掉空格/横杠再比,
// 保修提醒用的是原文 includes,而 customers 表里的电话本来就带空格(「+852 9123 4567」),
// 使用者敲连号「91234567」永远命中不了;而且保修行只带客户组主号,别名号和内地号根本没进搜索面。
// 这里锁三件事:①保修搜带空格/横杠的电话能中 ②压缩形态互搜能中 ③客户列表老行为不回归。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { compactSearchText, matchesSearchValues, normalizeSearchText } from "../root-site/components/search-match.js";
import { customerMatchesSearch } from "../root-site/bizflow/customers.js";
import {
  applyWarrantyPageData,
  ensureWarrantyData,
  renderWarranty,
  setWarrantySearch,
  warrantyMatchesSearch
} from "../root-site/bizflow/customers-warranty.js";
import { getCustomersPageData, getWarrantyData } from "../root-site/data/provider.js";
import { updateProviderSnapshotMemo } from "../root-site/data/provider-snapshot-cache.js";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [sharedMatcher, customersSource, warrantySource, providerSource, liveCustomerQuerySource] = await Promise.all([
  read("root-site/components/search-match.js"),
  read("root-site/bizflow/customers.js"),
  read("root-site/bizflow/customers-warranty.js"),
  read("root-site/data/provider.js"),
  read("root-site/data/live-customers-query.js")
]);

// ---------- 一份匹配口径:两页共用 components/search-match.js ----------
assert.match(sharedMatcher, /export function matchesSearchValues\(values, query\)/);
assert.match(sharedMatcher, /text\.includes\(term\)[\s\S]*compactSearchText\(text\)\.includes\(compactTerm\)/,
  "共享匹配必须同时比原文和压缩形态,只留一种就等于回到 bug 现场");
assert.match(sharedMatcher, /replace\(\/\[\\s-\]\+\/g, ""\)/,
  "压缩口径必须继续吃掉空格和横杠");
for (const [source, name] of [[customersSource, "customers.js"], [warrantySource, "customers-warranty.js"]]) {
  assert.match(source, /import \{ matchesSearchValues \} from "\.\.\/components\/search-match\.js";/,
    `${name} 必须走共享匹配,不许自己再写一份`);
}
assert.doesNotMatch(warrantySource, /String\(value\)\.toLocaleLowerCase\(\)\.includes\(term\)/,
  "保修提醒不得回退成原文 includes 的私有匹配");
assert.doesNotMatch(customersSource, /const compactTerm = term\.replace/,
  "客户列表不得把压缩逻辑再抄回本地");
assert.match(warrantySource, /export function warrantyMatchesSearch\(item, query\) \{[\s\S]*matchesSearchValues\(\[item\.customer, item\.phone, item\.phones, item\.product, item\.no\], query\)/,
  "保修搜索面必须含整组电话 item.phones");
assert.match(liveCustomerQuerySource, /rpc: "bizflow_warranty_page"[\s\S]*p_search: query\.search \|\| null/,
  "保修筛选必须把搜索词交给服务器分页函数");
assert.match(customersSource, /export function customerMatchesSearch\(customer, query\) \{\s*return matchesSearchValues\(\[/,
  "客户列表匹配必须只剩字段声明");

// ---------- provider 把整组电话补回保修行 ----------
assert.match(providerSource, /function warrantySearchPhones\(item, customer\)[\s\S]*customer\?\.allPhones[\s\S]*customer\?\.allPhoneMainlands/,
  "保修行必须补上客户组的全部电话与内地号");
assert.match(providerSource, /\{ \.\.\.item, customerId, phones: warrantySearchPhones\(item, customerByGroupId\.get\(customerId\)\) \}/,
  "保修行的电话补齐必须发生在客户组 join 之后");

// ---------- 单元口径 ----------
assert.equal(normalizeSearchText("  +852 9123 4567 "), "+852 9123 4567");
assert.equal(compactSearchText(" +852 9123-4567 "), "+85291234567");
assert.equal(matchesSearchValues(["+852 9123 4567"], ""), true, "空搜索词必须放行全部");
assert.equal(matchesSearchValues([null, undefined], "undefined"), false,
  "空字段不能被 String() 变成能搜到的 \"undefined\"");
assert.equal(matchesSearchValues([["9123 4567", "6012 3456"]], "60123456"), true, "嵌套多值字段必须展开");

// ---------- 真数据形态:seed 快照后跑真 provider ----------
function snapshotDate(offsetDays) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

// customers 表里的真实写法:香港号带空格,合并组还挂着别名号,内地号单独一列。
const seededCustomer = {
  id: "cust-1",
  name: "陳大文",
  phone: "+852 9123 4567",
  source: "other",
  joinedAt: "2026/02/03",
  imei: "8626 3506-6310 269",
  imeiCodes: ["8626 3506-6310 269"],
  allNames: ["陳大文"],
  allEmails: ["chan@example.com"],
  allPhones: ["+852 9123 4567", "6012 3456"],
  allPhoneMainlands: ["+86 138 0013 8000"],
  allCarMakes: ["Tesla"],
  allCarModels: ["Model 3"],
  type: "Regular",
  hasEmail: true,
  hasPhone: true,
  hasImei: true,
  orderCount: 1,
  detail: { totalAmount: 2134, email: "chan@example.com", carModel: "Tesla Model 3", order: null, orders: [] }
};
// 第二位客户只为验证搜索真的把别人筛掉了,不是全放行。
const otherCustomer = {
  id: "cust-2",
  name: "Vicky Chan",
  phone: "+852 5600 8904",
  source: "other",
  joinedAt: "2026/02/11",
  imei: "",
  imeiCodes: [],
  allNames: ["Vicky Chan"],
  allEmails: [],
  allPhones: ["+852 5600 8904"],
  allPhoneMainlands: [],
  allCarMakes: [],
  allCarModels: [],
  type: "Regular",
  hasEmail: false,
  hasPhone: true,
  hasImei: false,
  orderCount: 1,
  detail: { totalAmount: 900, email: "", carModel: null, order: null, orders: [] }
};
const seededWarrantyItems = [
  {
    invoiceId: "inv-1",
    productId: "prod-1",
    no: "#1241343",
    product: "車載電池",
    customer: "陳大文",
    customerId: "cust-1",
    phone: "+852 9123 4567",
    purchaseDate: snapshotDate(-300),
    expiry: snapshotDate(60),
    warrantyMonths: 12,
    latestRenewal: null
  },
  {
    invoiceId: "inv-2",
    productId: "prod-2",
    no: "#1241344",
    product: "車載電池",
    customer: "Vicky Chan",
    customerId: "cust-2",
    phone: "+852 5600 8904",
    purchaseDate: snapshotDate(-200),
    expiry: snapshotDate(120),
    warrantyMonths: 12,
    latestRenewal: null
  }
];
updateProviderSnapshotMemo("customers.json", { __live: true, customers: [seededCustomer, otherCustomer] });
updateProviderSnapshotMemo("warranty.json", { __live: true, items: seededWarrantyItems });

const warranty = await getWarrantyData();
assert.equal(warranty.items.length, 2, "seed 的保修行必须通过 provider 校验并落在 [-30, +365] 天窗口内");
const warrantyRow = warranty.items.find((item) => item.customerId === "cust-1");
assert.deepEqual(warrantyRow.phones, ["+852 9123 4567", "6012 3456", "+86 138 0013 8000"],
  "保修行必须带上整组电话(主号 + 别名号 + 内地号),展示仍只用 item.phone");
assert.equal(warrantyRow.phone, "+852 9123 4567", "补电话不能改动行上展示的主号");

const customerRow = (await getCustomersPageData()).customers.find((row) => row.id === "cust-1");
assert.ok(customerRow, "seed 的客户必须出现在客户列表");

// ① 带空格/横杠的电话、② 压缩形态互搜:两页必须给出同一个结果。
const phoneQueries = [
  "91234567",        // 使用者敲连号,库里存的是带空格 —— 报的就是这条
  "9123 4567",
  "9123-4567",
  "+852 9123 4567",
  "+852 9123-4567",
  "852 9123 4567",
  "60123456",        // 合并组里的别名号
  "6012 3456",
  "13800138000",     // 内地号
  "138 0013 8000"
];
for (const query of phoneQueries) {
  assert.equal(warrantyMatchesSearch(warrantyRow, query), true, `保修搜索漏了电话 ${query}`);
  assert.equal(customerMatchesSearch(customerRow, query), true, `客户列表搜索漏了电话 ${query}`);
  assert.equal(
    warrantyMatchesSearch(warrantyRow, query),
    customerMatchesSearch(customerRow, query),
    `同一个电话在两页必须同一个结果:${query}`
  );
}
for (const query of ["55667788", "5566 7788"]) {
  assert.equal(warrantyMatchesSearch(warrantyRow, query), false, `无关号码 ${query} 不该命中保修行`);
  assert.equal(customerMatchesSearch(customerRow, query), false, `无关号码 ${query} 不该命中客户行`);
}

// 保修行原有的搜索面(客户名/产品/单号)与大小写不敏感继续有效。
for (const query of ["陳大文", "車載電池", "#1241343", "1241343"]) {
  assert.equal(warrantyMatchesSearch(warrantyRow, query), true, `保修搜索漏了 ${query}`);
}
assert.equal(warrantyMatchesSearch({ ...warrantyRow, customer: "Vicky Chan" }, "vicky chan"), true,
  "客户名搜索必须大小写不敏感");
assert.equal(warrantyMatchesSearch(warrantyRow, "not-present"), false);
assert.equal(warrantyMatchesSearch(warrantyRow, ""), true, "空搜索词必须放行全部保修行");
assert.equal(warrantyMatchesSearch({ no: "#1", product: "x", customer: "y" }, "undefined"), false,
  "缺字段的保修行不能被 \"undefined\" 搜到");

// 整页跑一遍:服务器已筛好的分页结果必须原样渲染,不再对当前页做二次假全量筛选。
// renderWarranty 里的 managementPageSize() 要读 window.matchMedia,这里按 REDDOT-1 的
// globalThis.window 存档-还原写法临时补一个双列桌面视口。
const originalWindow = globalThis.window;
globalThis.window = { matchMedia: () => ({ matches: false }) };
try {
  await ensureWarrantyData();
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const renderWithItems = (items, search = "") => {
    setWarrantySearch(search);
    applyWarrantyPageData({ items, totalCount: items.length, pages: 1, pageSize: 18 });
    return renderWarranty({ escapeHtml, icon: () => "", lang: "zh" });
  };
  const allRows = renderWithItems([warrantyRow, warranty.items.find((item) => item.customerId === "cust-2")]);
  assert.match(allRows, /data-warranty-filtered="2"/, "空搜索词必须列出全部保修行");
  for (const query of ["91234567", "9123 4567", "9123-4567", "13800138000"]) {
    const html = renderWithItems([warrantyRow], query);
    assert.match(html, /data-warranty-filtered="1"/, `保修列表搜 ${query} 必须只剩命中的那一行`);
    assert.ok(html.includes("陳大文"), `保修列表搜 ${query} 必须留下陳大文那行`);
    assert.ok(!html.includes("Vicky Chan"), `保修列表搜 ${query} 不该带出别的客户`);
  }
  const otherHit = renderWithItems([warranty.items.find((item) => item.customerId === "cust-2")], "56008904");
  assert.match(otherHit, /data-warranty-filtered="1"/);
  assert.ok(otherHit.includes("Vicky Chan"), "另一位客户的连号同样要能搜到");
  assert.match(renderWithItems([], "00000000"), /data-warranty-filtered="0"/, "服务器空结果必须一行都不剩");
  setWarrantySearch("");
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}

// ③ 客户列表不回归:NR-cust-1 的老用例逐条复跑。
const legacyCustomer = {
  id: "customer-1",
  name: "主名",
  phone: "+852 9000 0000",
  imei: "8626 3506-6310 269",
  imeiCodes: ["8626 3506-6310 269"],
  allNames: ["主名", "Alias Chan"],
  allEmails: ["alias@example.com"],
  allPhones: ["+852 9123 4567"],
  allPhoneMainlands: ["+86 138 0013 8000"],
  allCarMakes: ["Tesla"],
  allCarModels: ["Model 3"],
  detail: { totalAmount: 12345, carModel: "Tesla Model 3", email: "alias@example.com" }
};
for (const query of ["Alias Chan", "alias@example.com", "9123 4567", "91234567", "862635066310269", "Tesla", "Model 3", "曾"]) {
  const expected = query !== "曾";
  assert.equal(customerMatchesSearch(legacyCustomer, query), expected, `客户列表搜索行为变了:${query}`);
}
assert.equal(customerMatchesSearch(legacyCustomer, "not-present"), false);
assert.equal(customerMatchesSearch(legacyCustomer, ""), true);

console.log("WAR-search-1 contracts: PASS (保修电话搜索对齐客户列表:共享匹配 + 整组电话 + 客户列表无回归)");
