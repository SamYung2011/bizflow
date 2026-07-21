import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../root-site/bizflow/inventory.css", import.meta.url), "utf8");

const desktop = css.match(/\.inventory-basic\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(desktop, /align-items:\s*flex-start\s*;/,
  "desktop product image must align with the top of the first form row");
assert.doesNotMatch(desktop, /align-items:\s*center\s*;/,
  "the old vertically-centered image layout must not return");

const narrow = css.match(/\.inventory-detail-page\[data-inventory-detail-page\] \.inventory-basic\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(narrow, /flex-direction:\s*column\s*;/);
assert.match(narrow, /align-items:\s*flex-start\s*;/,
  "narrow layout must retain top/left alignment when the columns stack");

console.log("INV-align-1 contracts: PASS (desktop top alignment, narrow stacked alignment)");
