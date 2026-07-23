import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [create, detail] = await Promise.all([
  read("root-site/bizflow/orders-create.js"),
  read("root-site/bizflow/orders-detail.js")
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
  const createBlock = dictionaryBlock(create, language, nextLanguage);
  const detailBlock = dictionaryBlock(detail, language, nextLanguage);

  assert.equal(
    dictionaryValue(createBlock, "orders.delivery"),
    dictionaryValue(detailBlock, "orders.shipping"),
    `${language} create-order delivery label must match order-detail shipping`
  );
  assert.equal(
    dictionaryValue(createBlock, "orders.pickup"),
    dictionaryValue(detailBlock, "orders.pickup"),
    `${language} create-order pickup label must match order-detail pickup`
  );
}

console.log("WORD-ship-1 contracts: PASS (create/detail shipping labels match in zh/en/fr)");
