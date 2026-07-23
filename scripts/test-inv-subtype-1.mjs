import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [detail, css] = await Promise.all([
  read("root-site/bizflow/inventory-detail.js"),
  read("root-site/bizflow/inventory.css")
]);

function dictionaryBlock(source, language, nextLanguage) {
  const end = nextLanguage ? `\\n  ${nextLanguage}: \\{` : "\\n\\};";
  const match = source.match(new RegExp(`\\n  ${language}: \\{([\\s\\S]*?)${end}`));
  assert.ok(match, `missing ${language} dictionary`);
  return match[1];
}

function dictionaryValue(block, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`"${escapedKey}": "([^"]+)"`));
  assert.ok(match, `missing ${key}`);
  return match[1];
}

for (const [language, nextLanguage] of [["zh", "en"], ["en", "fr"], ["fr", null]]) {
  const block = dictionaryBlock(detail, language, nextLanguage);
  assert.equal(
    dictionaryValue(block, "inventory.modal.warranty"),
    dictionaryValue(block, "inventory.field.warranty"),
    `${language} modal warranty label must keep the stored month unit`
  );
  assert.notEqual(
    dictionaryValue(block, "inventory.modal.titleNew"),
    dictionaryValue(block, "inventory.modal.title"),
    `${language} create and edit modal titles must stay distinct`
  );
  assert.ok(dictionaryValue(block, "inventory.modal.validation.name"));
  assert.ok(dictionaryValue(block, "inventory.modal.validation.sku"));
}

assert.match(
  detail,
  /item\.id === "new" \? "inventory\.modal\.titleNew" : "inventory\.modal\.title"/,
  "new subitems must render the create title while existing rows retain the edit title"
);
assert.match(detail, /data-modal-name[\s\S]*?aria-invalid="true"[\s\S]*?inventory\.modal\.validation\.name/);
assert.match(detail, /data-modal-code[\s\S]*?aria-invalid="true"[\s\S]*?inventory\.modal\.validation\.sku/);
assert.match(
  detail,
  /state\.modalValidation = \{\s*name: !name,\s*code: !internalCode\s*\};[\s\S]*?rerenderDetailPage\(\);[\s\S]*?\.focus\(\);[\s\S]*?return;/,
  "confirm must show and focus validation feedback instead of silently returning"
);
assert.doesNotMatch(detail, /if \(!item\.name \|\| !item\.internalCode\) return;/,
  "the old silent validation branch must be removed");
assert.match(detail, /warrantyMonths: Math\.max\(0, Math\.trunc\(Number\(state\.modalItem\.warrantyMonths\)/,
  "the subitem payload must continue storing warranty in months");

const modalBlock = css.slice(
  css.indexOf(".inventory-subitem-modal {"),
  css.indexOf(".inventory-subitem-modal__head {")
);
assert.match(modalBlock, /width:\s*560px;/);
assert.match(modalBlock, /height:\s*555px;/);
assert.match(
  css,
  /\.inventory-subitem-modal__body\s*\{[\s\S]*?overflow-y:\s*auto;/,
  "warehouse-heavy modal content must scroll inside the fixed Figma frame"
);
assert.match(css, /\.inventory-modal-input\.is-invalid\s*\{[\s\S]*?border:\s*1px solid var\(--red\)/);
assert.match(css, /\.inventory-modal-field-error\s*\{[\s\S]*?color:\s*var\(--red\)/);

console.log("INV-subtype-1 contracts: PASS (validation feedback, create/edit title, scroll body, warranty months)");
