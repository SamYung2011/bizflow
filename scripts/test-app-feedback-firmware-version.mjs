import assert from "node:assert/strict";
import { assertHonnmonoAdminRequest } from "../root-site/bizflow/app-feedback-api.js";
import { selectAdapterOtaPackage } from "../root-site/bizflow/app-feedback.js";
import { createOtaPackageController, createOtaPackageState, renderOtaPackage } from "../root-site/bizflow/app-feedback-ota.js";

const state = createOtaPackageState();
const requests = [];
const previews = [];
const encoded = [];
const controller = createOtaPackageController({
  otaState: state,
  scope: { signal: new AbortController().signal },
  isActive: () => true,
  isDeviceTab: () => true,
  rerender() {},
  focus() {},
  async encodeFile(file) { encoded.push(file); return file.bytes; },
  async request(path, options = {}) {
    assertHonnmonoAdminRequest(path, options.method);
    requests.push({ path, body: options.body });
    if (path === "/ota/package/inspect") {
      return new Promise((resolve, reject) => previews.push({ resolve, reject }));
    }
    if (options.method === "POST") return { md5: "test-digest" };
    return { current: null, backups: [] };
  },
});
const html = () => renderOtaPackage({ otaState: state, t: (key) => key,
  escapeHtml: String, formatTime: String, errorCopy: (error) => error.code });
const first = { name: "firmware.bin", size: 20, bytes: "first" };
const second = { ...first, bytes: "second" }; // same filename, different bytes
const old = controller.selectFile(first);
controller.openConfirm();
await controller.submit();
assert.equal(state.confirmOpen, false);
assert.match(html(), /data-ota-replace disabled/);
const latest = controller.selectFile(second);
await Promise.resolve();
previews[1].resolve({ version: { mainver: 1, subver: 20 } });
await latest;
previews[0].resolve({ version: { mainver: 86, subver: 16 } });
await old;
assert.deepEqual(requests.map(({ path }) => path), ["/ota/package/inspect", "/ota/package/inspect"]);
assert.match(html(), /otaVersionDetected/);
assert.match(html(), /value="V1\.20"[^>]*data-ota-version readonly/);
controller.setVersionInput("9.9");
controller.openConfirm();
assert.equal(state.versionInput, "1.20");
assert.match(html(), /data-ota-confirm-overlay/);
await controller.submit();
assert.deepEqual(requests[2], { path: "/ota/package", body: {
  filename: "firmware.bin", content_base64: "second", mainver: 1, subver: 20,
} });
assert.deepEqual(encoded, [first, second]);

const failure = controller.selectFile(first);
await Promise.resolve();
previews[2].reject(new Error("temporarily offline"));
await failure;
assert.match(html(), /otaVersionPreviewError/);
assert.match(html(), /data-ota-inspect-retry/);
assert.equal(state.versionInput, "");
const retry = controller.selectFile(first);
await Promise.resolve();
previews[3].resolve({ version: null });
await retry;
assert.match(html(), /otaVersionManual/);
controller.setVersionInput("8.1");
await controller.selectFile(null);
assert.equal(state.versionInput, "");
assert.doesNotMatch(html(), /data-ota-version/);
assert.throws(() => assertHonnmonoAdminRequest("/ota/package/inspect", "GET"));

const confirm = { packages: [
  { filename: "current.bin", version: { mainver: 1, subver: 20 }, versionSource: "firmware" },
  { filename: "old.bin", version: null },
] };
selectAdapterOtaPackage(confirm, "current.bin");
assert.equal(confirm.versionInput, "1.20");
selectAdapterOtaPackage(confirm, "old.bin");
assert.equal(confirm.versionInput, "");
console.log("Flash OTA file selection, preview, retry, confirmation and package switching passed");
