import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// G-inv-17 负库存口径（todo #261）：使用者拍板「库存可以负」。
// 扣减不设下限，负数一路写到 DB，并按现有低库存红字样式显示。
// 本文件锁住：① 三处 Math.max(0,…) 抹零已移除 ② Edge 写入不再拒绝负数 ③ 订单扣减可越过 0
// ④ 负数正常渲染 ⑤ 价格 / 保修月数的非负钳制不受牵连 ⑥ DB 侧 qty 没有非负 CHECK。

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [detail, inventory, css, writes, orders, snapshot, catalog, warehouseMigration] = await Promise.all([
  read("root-site/bizflow/inventory-detail.js"),
  read("root-site/bizflow/inventory.js"),
  read("root-site/bizflow/inventory.css"),
  read("root-site/data/live-inventory-writes.js"),
  read("root-site/data/live-orders-writes.js"),
  read("root-site/data/live-inventory-snapshot.js"),
  read("supabase/functions/shopify-catalog-write/catalog.ts"),
  read("migrations/002_warehouse_inventory.sql")
]);

// Lift the shipped expression out of the source and run it, so the assertions below
// exercise the real arithmetic rather than a copy that could drift from it.
function liveExpression(source, pattern, description) {
  const match = source.match(pattern);
  assert.ok(match?.[1], description);
  return match[1];
}

// 1. Detail-page payload keeps the sign instead of clamping to 0.
const stockExpression = liveExpression(
  detail,
  /quantity: (Math\.trunc\(Number\(row\.quantity\) \|\| 0\))/,
  "catalogPayload stocks() must keep the signed warehouse quantity"
);
const toStockQuantity = new Function("row", `return ${stockExpression};`);
assert.equal(toStockQuantity({ quantity: -3 }), -3, "a stored -3 must survive the detail payload");
assert.equal(toStockQuantity({ quantity: "-7" }), -7, "a typed -7 must survive the detail payload");
assert.equal(toStockQuantity({ quantity: 12 }), 12, "positive stock must be unchanged");
assert.equal(toStockQuantity({ quantity: "" }), 0, "blank input must still fall back to 0");

// 2. Subitem modal totals sum signed warehouse rows (a negative row must pull the total down).
const modalTotalCallback = liveExpression(
  detail,
  /quantity: state\.modalItem\.warehouses\.reduce\((\(sum, row\) => sum \+ \(Number\(row\.quantity\) \|\| 0\)), 0\)/,
  "the subitem modal must sum signed warehouse quantities"
);
const sumWarehouses = new Function("rows", `return rows.reduce(${modalTotalCallback}, 0);`);
assert.equal(sumWarehouses([{ quantity: 2 }, { quantity: -5 }]), -3, "one negative warehouse must drag the total below 0");
assert.equal(sumWarehouses([{ quantity: -1 }, { quantity: -2 }]), -3, "all-negative warehouses must stay negative");
assert.equal(sumWarehouses([{ quantity: 4 }, { quantity: 6 }]), 10, "positive totals must be unchanged");

// 3. The BizFlow-only write path persists the signed qty.
const persistedQtyExpression = liveExpression(
  writes,
  /qty: (Math\.trunc\(Number\(stock\.quantity\) \|\| 0\))/,
  "localStockRows must persist the signed qty"
);
const toPersistedQty = new Function("stock", `return ${persistedQtyExpression};`);
assert.equal(toPersistedQty({ quantity: -3 }), -3, "a -3 must reach inventory_stock.qty as -3, not 0");
assert.equal(toPersistedQty({ quantity: 9 }), 9, "positive stock must be unchanged");

// None of the three former clamp sites may come back.
assert.doesNotMatch(detail, /quantity: Math\.max\(0/, "the detail payload must not re-clamp stock to 0");
assert.doesNotMatch(detail, /sum \+ Math\.max\(0/, "the modal total must not re-clamp stock to 0");
assert.doesNotMatch(writes, /qty: Math\.max\(0/, "the write path must not re-clamp qty to 0");

// 4. The Shopify-bound save path (Edge function) must accept a negative quantity.
const normalizeStockBody = catalog.match(/function normalizeStock\(value: unknown\): NormalizedStock \{([\s\S]*?)\n\}/);
assert.ok(normalizeStockBody, "normalizeStock must be readable");
assert.doesNotMatch(
  normalizeStockBody[1],
  /quantity < 0/,
  "normalizeStock must not reject negative stock: it would hard-throw on every Shopify-bound save"
);
assert.match(
  normalizeStockBody[1],
  /if \(!UUID_PATTERN\.test\(warehouseId\)\) throw new Error\("Invalid warehouse stock payload"\);/,
  "normalizeStock must still validate the warehouse id"
);
assert.match(catalog, /quantity: stock\.quantity,/, "the Shopify push must forward the signed quantity");
// Price and warranty validation in the sibling normalizer must survive.
assert.match(
  catalog,
  /!Number\.isFinite\(price\) \|\| price < 0 \|\| warrantyMonths < 0/,
  "normalizeVariant must keep rejecting negative price and warranty"
);

// 5. Marking an order paid deducts across 0 into negative territory.
const deductionExpression = liveExpression(
  orders,
  /\.update\(\{ qty: (currentQty - deduction\.qty), updated_at/,
  "order payment must deduct without a floor"
);
const afterDeduction = new Function("currentQty", "deduction", `return ${deductionExpression};`);
assert.equal(afterDeduction(2, { qty: 5 }), -3, "deducting 5 from 2 must land on -3, not 0");
assert.equal(afterDeduction(0, { qty: 1 }), -1, "deducting from an empty warehouse must go negative");
assert.equal(afterDeduction(10, { qty: 4 }), 6, "an ordinary deduction must be unchanged");
assert.match(orders, /qty: -deduction\.qty,/, "a missing stock row must be inserted at the negative balance");
assert.doesNotMatch(orders, /Math\.max\(0[^\n]*qty/, "the deduction path must not gain a floor");

// 6. Negative stock renders through the existing low-stock convention (red count), not a new style.
const lowStockExpression = liveExpression(
  inventory,
  /const lowStock = (product\.status !== "discontinued" && Number\(product\.stock\) < 50);/,
  "the product card must derive low stock from the shared threshold"
);
const isLowStock = new Function("product", `return ${lowStockExpression};`);
assert.equal(isLowStock({ status: "active", stock: -3 }), true, "negative stock must pick up the low-stock treatment");
assert.equal(isLowStock({ status: "draft", stock: -1 }), true, "a negative draft SKU must also be flagged");
assert.equal(isLowStock({ status: "active", stock: 80 }), false, "healthy stock must stay unflagged");
assert.match(
  inventory,
  /<span class="inventory-stock-count">\$\{escapeHtml\(String\(product\.stock\)\)\}<\/span>/,
  "the card must print the raw stock value so the minus sign shows"
);
assert.match(
  css,
  /\.inventory-product-card--low-stock \.inventory-stock-count \{\s*color: var\(--red\);/,
  "the low-stock count must keep its red token: negatives reuse it instead of inventing a style"
);

// The parent warehouse input must accept a typed minus sign.
assert.match(
  detail,
  /<input class="inventory-quantity-input" type="number" step="1" data-parent-warehouse-qty=/,
  "the parent warehouse quantity input must not carry min=\"0\""
);
assert.doesNotMatch(
  detail,
  /min="0"[^>]*data-parent-warehouse-qty/,
  "the parent warehouse quantity input must not block negative entry"
);

// 7. The snapshot must carry negatives through aggregation untouched.
assert.match(
  snapshot,
  /reduce\(\(sum, stock\) => sum \+ asNumber\(stock\.qty\), 0\)/,
  "per-product stock must be a plain signed sum"
);
assert.doesNotMatch(snapshot, /Math\.max\(0/, "the snapshot must not clamp aggregated stock");

// 8. Money and warranty stay non-negative: removing the stock floor must not spill over.
assert.match(detail, /price: Math\.max\(0, Number\(detail\.product\.price\) \|\| 0\)/, "price must stay non-negative");
assert.match(detail, /warrantyMonths: Math\.max\(0, Math\.trunc\(Number\(item\.warrantyMonths\) \|\| 0\)\)/,
  "warranty months must stay non-negative");
assert.match(writes, /warranty_months: Math\.max\(0, Math\.trunc\(Number\(product\.warrantyMonths\) \|\| 0\)\)/,
  "persisted warranty months must stay non-negative");
assert.match(detail, /type="number" min="0" step="1" data-modal-warranty/, "the warranty input must keep min=\"0\"");

// 9. DB side: inventory_stock.qty is a plain signed INTEGER with no non-negative CHECK.
assert.match(
  warehouseMigration,
  /CREATE TABLE IF NOT EXISTS inventory_stock \([\s\S]*?qty INTEGER NOT NULL DEFAULT 0,/,
  "inventory_stock.qty must remain a plain signed INTEGER"
);
const stockTable = warehouseMigration.match(/CREATE TABLE IF NOT EXISTS inventory_stock \(([\s\S]*?)\n\);/);
assert.ok(stockTable, "inventory_stock DDL must be readable");
assert.doesNotMatch(stockTable[1], /CHECK/i, "inventory_stock must not gain a non-negative CHECK constraint");

console.log("INV-negative-1 contracts: PASS (signed writes, deduction across 0, negative rendering, no DB floor)");
