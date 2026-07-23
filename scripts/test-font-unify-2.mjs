import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pageCssUrls = {
  orders: new URL("../root-site/bizflow/orders.css", import.meta.url),
  customers: new URL("../root-site/bizflow/customers.css", import.meta.url),
  inventory: new URL("../root-site/bizflow/inventory.css", import.meta.url),
  expense: new URL("../root-site/bizflow/expense.css", import.meta.url)
};

const [ordersCss, customersCss, inventoryCss, expenseCss, sharedStyles] = await Promise.all([
  readFile(pageCssUrls.orders, "utf8"),
  readFile(pageCssUrls.customers, "utf8"),
  readFile(pageCssUrls.inventory, "utf8"),
  readFile(pageCssUrls.expense, "utf8"),
  readFile(new URL("../root-site/components/styles.css", import.meta.url), "utf8")
]);

assert.doesNotMatch(customersCss, /\.customer-row\s*>\s*\.avatar--initial\s*\{/,
  "customer list initials must inherit the shared Figma avatar type without a redundant override");
assert.match(sharedStyles, /\.avatar,\s*\n\.avatar--initial\s*\{[\s\S]*?font-size:\s*var\(--font-title-2-size\);[\s\S]*?font-weight:\s*var\(--font-title-2-weight\)/,
  "the shared avatar initial must use the Figma 24px SemiBold default type");

assert.match(inventoryCss, /\.inventory-category__trigger,\s*\n\.inventory-search\s*\{[\s\S]*?font-size:\s*var\(--font-title-3-size\);[\s\S]*?font-weight:\s*var\(--font-body-weight\)/,
  "inventory category and search controls must use Figma 16px Regular text");
assert.match(inventoryCss, /\.inventory-search input\s*\{[\s\S]*?font:\s*inherit/,
  "the inventory search input must inherit the verified 16px Regular control typography");
assert.match(inventoryCss, /\.inventory-stock-label\s*\{[\s\S]*?font-size:\s*var\(--font-body-size\);[\s\S]*?font-weight:\s*var\(--font-body-weight\)/,
  "inventory stock labels must use the Figma 10px Regular body type");
assert.match(inventoryCss, /\.inventory-stock-count\s*\{[\s\S]*?font-size:\s*var\(--font-body-size\);[\s\S]*?font-weight:\s*var\(--font-body-weight\)/,
  "inventory stock values must use the Figma 10px Regular body type");
assert.match(inventoryCss, /\.inventory-warehouse-scope-badge\s*\{[\s\S]*?font-size:\s*var\(--font-description-size\);[\s\S]*?font-weight:\s*600/,
  "inventory warehouse badges must stay on the legal 12px SemiBold type bucket");

assert.match(expenseCss, /\.expense-add\s*\{[\s\S]*?font-size:\s*var\(--font-title-3-size\);[\s\S]*?font-weight:\s*var\(--font-title-3-weight\)/,
  "the expense page primary add action must match sibling page headers at 16px Medium");

assert.match(ordersCss, /\.orders-title\s*\{[\s\S]*?font-size:\s*var\(--font-display-size\)/,
  "the already-aligned orders title must remain on the display type bucket");

const legalLiteralSizes = new Set([8, 10, 12, 16, 24, 32, 40]);
for (const [page, url] of Object.entries(pageCssUrls)) {
  const css = await readFile(url, "utf8");
  const literalSizes = [...css.matchAll(/font-size:\s*([0-9]+(?:\.[0-9]+)?)px\s*;/g)]
    .map((match) => Number(match[1]));
  const invalid = [...new Set(literalSizes.filter((size) => !legalLiteralSizes.has(size)))];
  assert.deepEqual(invalid, [], `${page}.css has out-of-scale literal font sizes: ${invalid.join(", ")}`);
}

console.log("FONT-unify-2 contracts: PASS (customers, inventory, expense typography; orders unchanged; four-page type scale)");
