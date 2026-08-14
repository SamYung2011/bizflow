import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// 订单卡「備註」不显示机器自动写入段(煊煊 2026-08-14 拍):Framer 表單意向时间戳 /
// Shopify 同步状态 / Notion 导入残留;人手写备注与 Promo Code 保留。
// live-snapshots.js 不便整模块导入(顶层拉 supabase 链),照 test-order-search-1 的路子
// 把 MACHINE_NOTE_SEGMENT + visibleInvoiceNotes 从源码抠出来真跑。

const source = await readFile(new URL("../root-site/data/live-snapshots.js", import.meta.url), "utf8");

const constMatch = source.match(/const MACHINE_NOTE_SEGMENT = new RegExp\([\s\S]*?\);/);
assert.ok(constMatch, "MACHINE_NOTE_SEGMENT must exist");
const fnMatch = source.match(/function visibleInvoiceNotes\(notes\) \{[\s\S]*?\n\}/);
assert.ok(fnMatch, "visibleInvoiceNotes must exist");

const asText = (value, fallback = "") => (value == null ? fallback : String(value));
const visibleInvoiceNotes = new Function(
  "asText",
  `${constMatch[0]}\n${fnMatch[0]}\nreturn visibleInvoiceNotes;`
)(asText);

// 机器备注整段隐藏(生产实存三家格式)。
assert.equal(visibleInvoiceNotes("__FORMS_BUY__ Framer 表單意向 2026-08-13 15:24"), "");
assert.equal(visibleInvoiceNotes("Shopify order #1592 | financial=PAID | fulfillment=UNFULFILLED"), "");
assert.equal(visibleInvoiceNotes("__NOTION_IMPORT__ batch=20260601-notion-inv idx=1234 raw_status=己交付"), "");
assert.equal(visibleInvoiceNotes("__FORMS_BUY__ Framer 表單意向 2026-08-13 15:24\n__BROADWAY__"), "", "multi-line marker note must vanish");
// Promo Code 是业务信息,跟着 Framer 流水也得活下来。
assert.equal(visibleInvoiceNotes("__FORMS_BUY__ Framer 表單意向 2026-08-13 15:24 | Promo Code: ABC123"), "Promo Code: ABC123");
// 人手写的备注一字不动。
assert.equal(visibleInvoiceNotes("泊邊好轉介 尾數 順豐"), "泊邊好轉介 尾數 順豐");
assert.equal(visibleInvoiceNotes("泊邊好轉介,已付尾款,8.12已交貨"), "泊邊好轉介,已付尾款,8.12已交貨");
// 句中碰巧含关键词不算机器段。
assert.equal(visibleInvoiceNotes("客人問 financial report 幾時有"), "客人問 financial report 幾時有");
// 既有行为不回归:marker 剥离 + UTC 转 HK 时间。
assert.equal(visibleInvoiceNotes("__PENDING_MERGE__:abc-123 回電"), "回電");
assert.equal(visibleInvoiceNotes("回電 2026-08-13T07:24:00Z"), "回電 2026-08-13 15:24");
assert.equal(visibleInvoiceNotes(null), "");

console.log("Order note visibility contracts: PASS (machine segments hidden, human notes kept)");
