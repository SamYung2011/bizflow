import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { receiptPathFromStored, EXPENSE_RECEIPT_BUCKET, RECEIPT_SIGN_TTL_SECONDS } from "../root-site/bizflow/expense-receipt-path.js";
import { createReceiptUrlCache } from "../root-site/bizflow/expense-receipt-cache.js";
import { normalizeExpenseRows } from "../root-site/bizflow/expense-model.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const writes = read("root-site/data/live-expense-writes.js");
const root = read("root-site/bizflow/expense.js");
const legacy = read("src/views/Expense.jsx");
const hook = read("src/hooks/useSignedReceiptUrls.js");
const prefix = "https://example.invalid/storage/v1/object/";
let passed = 0;
async function test(name, run) { await run(); passed += 1; console.log(`ok ${passed} - ${name}`); }

for (const [name, value, expected] of [
  ["legacy public URL", `${prefix}public/expense-receipts/employee/a.jpg`, "employee/a.jpg"],
  ["signed URL discards token", `${prefix}sign/expense-receipts/employee/a.jpg?token=secret`, "employee/a.jpg"],
  ["raw path", "  employee/a.jpg  ", "employee/a.jpg"],
  ["leading slash", " /employee/a.jpg ", "employee/a.jpg"],
  ["URL encoded filename", `${prefix}public/expense-receipts/employee/%E6%94%B6%E6%93%9A%20a.jpg`, "employee/收據 a.jpg"],
  ["empty", " \t ", ""],
  ["other bucket URL", `${prefix}public/product-images/employee/a.jpg`, ""],
  ["non-string", { url: "employee/a.jpg" }, ""]
]) await test(name, () => assert.equal(receiptPathFromStored(value), expected));

await test("malformed URLs and bad URL escapes do not throw", () => {
  for (const value of [null, undefined, 0, [], "https:bad", `${prefix}sign/expense-receipts/a/%ZZ`, "https://example.invalid/not-a-receipt"]) {
    assert.equal(receiptPathFromStored(value), "");
  }
});
await test("normalized row keeps source/path and never renders its legacy public URL", () => {
  const stored = `${prefix}public/expense-receipts/employee/a.jpg`;
  assert.deepEqual(normalizeExpenseRows([{ receipt_urls: [stored, `${prefix}public/other/no.jpg`, null] }])[0].receipts,
    [{ path: "employee/a.jpg", stored, url: "", name: "" }]);
});
await test("cache batches duplicate paths, reuses fresh URLs and renews five minutes early", async () => {
  let time = 0;
  const calls = [];
  const cache = createReceiptUrlCache(async (paths, ttl) => {
    calls.push({ paths, ttl });
    return new Map(paths.map((path) => [path, `signed-${calls.length}/${path}`]));
  }, () => time);
  await cache.resolve(["a/1", "a/1", "a/2", ""]);
  assert.deepEqual(calls, [{ paths: ["a/1", "a/2"], ttl: 3600 }]);
  time = 54 * 60 * 1000;
  assert.equal((await cache.resolve(["a/1"])).get("a/1"), "signed-1/a/1");
  assert.equal(calls.length, 1);
  time = 55 * 60 * 1000;
  assert.equal(cache.read("a/1"), "");
  assert.equal((await cache.resolve(["a/1"])).get("a/1"), "signed-2/a/1");
  assert.equal(calls.length, 2);
});
await test("failed signing does not revive an expired or public URL", async () => {
  let time = 0;
  const cache = createReceiptUrlCache(async () => { throw new Error("sign denied"); }, () => time);
  cache.remember("a/1", "old-signed");
  time = 56 * 60 * 1000;
  await assert.rejects(cache.resolve(["a/1"]), /sign denied/);
  assert.equal(cache.read("a/1"), "");
});
await test("concurrent cache requests share a batch and clear discards late results", async () => {
  let finish;
  let calls = 0;
  const cache = createReceiptUrlCache(() => { calls += 1; return new Promise((resolve) => { finish = resolve; }); });
  const one = cache.resolve(["a/1"]);
  const two = cache.resolve(["a/1"]);
  finish(new Map([["a/1", "signed"]]));
  assert.equal((await one).get("a/1"), "signed");
  assert.equal((await two).get("a/1"), "signed");
  assert.equal(calls, 1);
  cache.clear();
  const late = cache.resolve(["a/1"]);
  const queued = cache.resolve(["a/1"]);
  cache.clear();
  finish(new Map([["a/1", "stale-user-signed"]]));
  assert.equal((await late).size, 0);
  assert.equal((await queued).size, 0);
  assert.equal(calls, 2);
});

// Execute the real write/sign functions with only their imports injected; no network.
const makeWrites = new Function("getCurrentUser", "getSession", "getSupabaseClient", "invalidateLiveTables",
  "EXPENSE_RECEIPT_BUCKET", "RECEIPT_SIGN_TTL_SECONDS", "receiptPathFromStored",
  `${writes.replace(/^import .*;\n/gm, "").replace(/^export /gm, "")}\nreturn { uploadLiveExpenseReceipt, signLiveExpenseReceipts, createLiveExpense, updateLiveExpense };`);
function fixture(options = {}) {
  const calls = { client: 0, uploads: [], signs: [], batches: [], removed: [], payloads: [] };
  const storage = {
    async upload(path) { calls.uploads.push(path); return { error: null }; },
    async createSignedUrl(path, ttl) {
      calls.signs.push([path, ttl]);
      if (options.throwSign) throw new Error("sign failed");
      return { data: { signedUrl: "https://signed.invalid/preview" }, error: options.signError || null };
    },
    async createSignedUrls(paths, ttl) {
      calls.batches.push([paths, ttl]);
      return { data: paths.map((path) => path.endsWith("bad") ? { path, error: "denied" } : { path, signedUrl: `https://signed.invalid/${path}` }), error: options.batchError || null };
    },
    async remove(paths) { calls.removed.push(paths); return { error: null }; }
  };
  const client = {
    storage: { from(bucket) { assert.equal(bucket, "expense-receipts"); return storage; } },
    from(table) {
      assert.equal(table, "expense_reimbursements");
      const query = { select() { return this; }, eq() { return this; }, async single() { return { data: calls.payloads.at(-1), error: options.saveError || null }; } };
      return { insert(payload) { calls.payloads.push(payload); return query; }, update(payload) { calls.payloads.push(payload); return query; } };
    }
  };
  const api = makeWrites(async () => ({ employeeId: "employee" }), async () => ({ user: { id: "user" } }),
    async () => { calls.client += 1; return client; }, async () => {}, EXPENSE_RECEIPT_BUCKET, RECEIPT_SIGN_TTL_SECONDS, receiptPathFromStored);
  return { api, calls };
}
const file = { name: "receipt.jpg", type: "image/jpeg" };
await test("upload returns its object path and one-hour signed preview", async () => {
  const { api, calls } = fixture();
  const result = await api.uploadLiveExpenseReceipt(file);
  assert.match(result.path, /^employee\/\d+-[a-z0-9]+\.jpg$/);
  assert.equal(result.url, "https://signed.invalid/preview");
  assert.deepEqual(calls.signs, [[result.path, 3600]]);
});
await test("API and thrown signing errors leave successful uploads intact", async () => {
  for (const options of [{ signError: new Error("denied") }, { throwSign: true }]) {
    const { api, calls } = fixture(options);
    const result = await api.uploadLiveExpenseReceipt(file);
    assert.equal(result.url, ""); assert.ok(result.path);
    assert.equal(calls.uploads.length, 1); assert.deepEqual(calls.removed, []);
  }
});
await test("batch signer normalizes/deduplicates and leaves individual failures unsigned", async () => {
  const { api, calls } = fixture();
  const signed = await api.signLiveExpenseReceipts(["employee/1", `${prefix}public/expense-receipts/employee/1`, "employee/bad"]);
  assert.deepEqual(calls.batches, [[["employee/1", "employee/bad"], 3600]]);
  assert.deepEqual([...signed], [["employee/1", "https://signed.invalid/employee/1"]]);
});
await test("empty batches skip auth; batch errors propagate", async () => {
  const { api, calls } = fixture({ batchError: new Error("denied") });
  assert.equal((await api.signLiveExpenseReceipts([])).size, 0); assert.equal(calls.client, 0);
  await assert.rejects(api.signLiveExpenseReceipts(["employee/1"]), /denied/);
});
await test("create persists paths despite preview failure; insert failure still removes uploaded paths", async () => {
  const legacyUrl = `${prefix}public/expense-receipts/employee/old.jpg`;
  const { api, calls } = fixture({ throwSign: true });
  await api.createLiveExpense({ files: [file], receiptUrls: [legacyUrl, `${prefix}public/other/no.jpg`] });
  assert.deepEqual(calls.payloads[0].receipt_urls, ["employee/old.jpg", calls.uploads[0]]);
  assert.deepEqual(calls.removed, []);
  const failure = fixture({ saveError: new Error("insert failed") });
  await assert.rejects(failure.api.createLiveExpense({ files: [file] }), /insert failed/);
  assert.deepEqual(failure.calls.removed, [failure.calls.uploads]);
});
await test("editing migrates legacy URL values to paths and drops invalid values", async () => {
  const { api, calls } = fixture();
  await api.updateLiveExpense("row", { receiptUrls: [`${prefix}public/expense-receipts/employee/old.jpg`, null] });
  assert.deepEqual(calls.payloads[0].receipt_urls, ["employee/old.jpg"]);
});
await test("both frontends render signed receipts and persist paths without public URLs", () => {
  for (const text of [writes, legacy]) assert.doesNotMatch(text, /getPublicUrl\s*\(/);
  assert.match(writes, /createSignedUrls\(cleanPaths, ttl\)/);
  assert.match(hook, /createSignedUrls\(paths, ttl\)/);
  assert.match(legacy, /uploaded\.push\(path\)/);
  assert.match(legacy, /receipt_urls: receiptUrls\.map\(receiptPathFromStored\)/);
  assert.match(legacy, /<Lightbox signedUrl=\{signedReceipts\[lightboxPath\]/);
  assert.doesNotMatch(legacy, /<img[^>]*src=\{(?:u|url)\}/);
  assert.match(root, /\.map\(\(receipt\) => receipt\.path\)/);
  assert.match(root, /signExpenseReceiptsInBackground\(mountId, scope\)/);
  assert.equal((root.match(/receiptUnavailable:/g) || []).length, 3);
});
await test("background signing preserves open draft focus, including drafts opened in flight", async () => {
  const background = root.slice(root.indexOf("function signExpenseReceiptsInBackground"), root.indexOf("async function prepareExpenseReceiptUrls"));
  assert.match(background, /if \(changed && !state\.draft\) rerender\(\)/);
  for (const [draftBefore, draftAfter, changed, expectedRenders] of [
    [{}, {}, true, 0],
    [null, {}, true, 0],
    [null, null, true, 1],
    [null, null, false, 0],
  ]) {
    const state = { draft: draftBefore };
    let finish, renders = 0;
    const pending = new Promise((resolve) => { finish = resolve; });
    const sign = new Function("state", "prepareExpenseReceiptUrls", "rerender", `${background}; return signExpenseReceiptsInBackground;`)(
      state, () => pending, () => { renders++; },
    );
    sign(1, {});
    state.draft = draftAfter;
    finish(changed);
    await pending;
    assert.equal(renders, expectedRenders);
  }
});
await test("drafts preserve paths; local blob previews and upload cleanup remain", () => {
  const draft = root.slice(root.indexOf("function draftFromExpenseRow"), root.indexOf("function formatAmount"));
  assert.doesNotMatch(draft, /path: ""/);
  assert.match(draft, /receipt\.path \|\| receipt\.url/);
  assert.match(root, /URL\.createObjectURL\(file\)/);
  assert.match(root, /if \(authenticated\) \{[^]*receiptUrlCache\?\.read/);
  assert.match(writes, /if \(uploaded\.length\)[^]*expense-receipts[^]*remove\(uploaded\.map/);
});
console.log(`EXPENSE_RECEIPTS_SIGNED=${passed}/${passed} (path compatibility, TTL cache, real write/sign behavior, frontend contracts)`);
