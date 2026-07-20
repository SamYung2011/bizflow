import assert from "node:assert/strict";

import { clearPhoneCopyNotice, copyPhoneNumber } from "../root-site/components/phone-copy.js";

let notice = null;
let appended = [];
let execCalls = 0;
let execResult = true;
let selectedValue = "";

function makeElement(tag) {
  return {
    tag,
    className: "",
    dataset: {},
    attributes: {},
    style: {},
    value: "",
    textContent: "",
    setAttribute(name, value) { this.attributes[name] = value; },
    select() { selectedValue = this.value; },
    setSelectionRange() {},
    remove() {
      appended = appended.filter((el) => el !== this);
      if (notice === this) notice = null;
    }
  };
}

globalThis.window = { clearTimeout() {}, setTimeout: () => 1, getSelection: () => null };
globalThis.document = {
  body: { append(el) { appended.push(el); if (el.tag === "p") notice = el; } },
  createElement(tag) { return makeElement(tag); },
  querySelector(selector) { return selector === "[data-phone-copy-notice]" ? notice : null; },
  execCommand(cmd) {
    if (cmd !== "copy") return false;
    execCalls += 1;
    return execResult;
  }
};

// 场景1：无 navigator.clipboard（老内核壳浏览器 / 非安全上下文）→ execCommand 兜底成功
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
assert.equal(await copyPhoneNumber(" +852 9876 ", "zh"), true);
assert.equal(execCalls, 1, "legacy path must run when clipboard API is missing");
assert.equal(selectedValue, "+852 9876", "fallback textarea must carry the trimmed phone");
assert.equal(notice?.textContent, "已複製 +852 9876");
assert.equal(appended.filter((el) => el.tag === "textarea").length, 0, "fallback textarea must be removed");
clearPhoneCopyNotice();

// 场景2：clipboard.writeText 被拒（权限/焦点）→ execCommand 兜底成功
execCalls = 0;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { clipboard: { writeText: async () => { throw new Error("NotAllowedError"); } } }
});
assert.equal(await copyPhoneNumber("+852 1111", "en"), true);
assert.equal(execCalls, 1, "legacy path must run when writeText rejects");
assert.equal(notice?.textContent, "Copied +852 1111");
clearPhoneCopyNotice();

// 场景3：clipboard 缺失且 execCommand 也失败 → 「未能複製」且返回 false
execCalls = 0;
execResult = false;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
assert.equal(await copyPhoneNumber("+852 2222", "zh"), false);
assert.equal(execCalls, 1);
assert.equal(notice?.textContent, "未能複製");
assert.equal(notice?.className.includes("phone-copy-notice--error"), true);
clearPhoneCopyNotice();

// 场景4：writeText 等待期间 scope 失效（用户已切走）→ 不跑兜底、不弹 notice、统一返回 false
execCalls = 0;
execResult = true;
let scopeCurrent = true;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { clipboard: { writeText: async () => { scopeCurrent = false; throw new Error("late reject"); } } }
});
assert.equal(await copyPhoneNumber("+852 3333", "zh", { scope: { isCurrent: () => scopeCurrent } }), false);
assert.equal(execCalls, 0, "stale scope must not trigger the legacy fallback");
assert.equal(notice, null, "stale scope must not show any notice");

// 场景5：writeText 成功但 scope 已失效 → 同样静默返回 false（沿用旧语义）
scopeCurrent = true;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { clipboard: { writeText: async () => { scopeCurrent = false; } } }
});
assert.equal(await copyPhoneNumber("+852 4444", "zh", { scope: { isCurrent: () => scopeCurrent } }), false);
assert.equal(execCalls, 0);
assert.equal(notice, null, "stale scope must stay silent even on success");

console.log("phone-copy fallback contracts: PASS (no-clipboard fallback, reject fallback, double-failure notice, stale-scope silence)");
