import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedFlashAdminBase,
  isAllowedHonnmonoApiBase,
  isAllowedHonnmonoUpstream,
  isAllowedOtaAdminBase,
  mapHonnmonoAdminPath,
  mapFlashAdminPath,
  mapOtaAdminPath,
  stripFunctionPrefix,
  validateOtaAdminBody,
} from "./routing.mjs";


test("maps only the feedback and device-admin routes", () => {
  assert.equal(stripFunctionPrefix("/honnmono-admin/feedback"), "/feedback");
  assert.equal(mapHonnmonoAdminPath("/feedback", "GET"), "/internal/admin/feedback");
  assert.equal(mapHonnmonoAdminPath("/feedback/", "GET"), "/internal/admin/feedback");
  assert.equal(
    mapHonnmonoAdminPath("/feedback/42", "GET"),
    "/internal/admin/feedback/42",
  );
  assert.equal(
    mapHonnmonoAdminPath("/feedback/42/log-link", "POST"),
    "/internal/admin/feedback/42/log-link",
  );
  assert.equal(
    mapHonnmonoAdminPath("/device/binding", "GET"),
    "/internal/admin/device/binding",
  );
  assert.equal(
    mapHonnmonoAdminPath("/device/unbind", "POST"),
    "/internal/admin/device/unbind",
  );
});


test("rejects writes, raw download proxying, and unrelated routes", () => {
  assert.equal(mapHonnmonoAdminPath("/feedback", "POST"), "");
  assert.equal(mapHonnmonoAdminPath("/feedback/42", "DELETE"), "");
  assert.equal(mapHonnmonoAdminPath("/feedback-log/token", "GET"), "");
  assert.equal(mapHonnmonoAdminPath("/internal/admin/feedback", "GET"), "");
  assert.equal(mapHonnmonoAdminPath("/feedback/0", "GET"), "");
  assert.equal(mapHonnmonoAdminPath("/feedback/not-an-id", "GET"), "");
  assert.equal(mapHonnmonoAdminPath("/device/binding", "POST"), "");
  assert.equal(mapHonnmonoAdminPath("/device/unbind", "GET"), "");
  assert.equal(mapHonnmonoAdminPath("/device/unbind/extra", "POST"), "");
});


test("maps only the OTA package read and replace routes", () => {
  assert.equal(stripFunctionPrefix("/honnmono-admin/ota/package"), "/ota/package");
  assert.equal(mapOtaAdminPath("/ota/package", "GET"), "/package");
  assert.equal(mapOtaAdminPath("/ota/package/", "POST"), "/package");
  assert.equal(mapOtaAdminPath("/ota/package", "DELETE"), "");
  assert.equal(mapOtaAdminPath("/ota/backups", "GET"), "");
  assert.equal(mapOtaAdminPath("/package", "GET"), "");
});


test("maps only the flash-device key-rotation write to the HK test-server", () => {
  assert.equal(
    mapFlashAdminPath("/devices/flash/CERT_1/unbind", "POST"),
    "/internal/admin/devices/flash/CERT_1/unbind",
  );
  assert.equal(mapFlashAdminPath("/devices/flash/CERT_1/unbind/", "POST"), "/internal/admin/devices/flash/CERT_1/unbind");
  assert.equal(mapFlashAdminPath("/devices/flash/CERT_1/unbind", "GET"), "");
  assert.equal(mapFlashAdminPath("/devices/dc-pro/CERT_1/unbind", "POST"), "");
  assert.equal(mapFlashAdminPath("/devices/flash/CERT_1/actions", "POST"), "");
});


test("preserves optional OTA package version fields in the forwarded JSON", () => {
  const body = {
    filename: "gbccs25.bin",
    content_base64: "AQIDBA==",
    mainver: 1,
    subver: 20,
  };
  const rawBody = JSON.stringify(body);
  assert.equal(validateOtaAdminBody(rawBody), rawBody);
  assert.deepEqual(JSON.parse(validateOtaAdminBody(rawBody)), body);
  assert.throws(() => validateOtaAdminBody("[]"), TypeError);
  assert.throws(() => validateOtaAdminBody("not-json"), SyntaxError);
});


test("pins the bridge to the Shenzhen app-api host and JSON endpoints", () => {
  assert.equal(isAllowedHonnmonoApiBase("https://app-api.honnmono.top"), true);
  assert.equal(isAllowedHonnmonoApiBase("https://app-api.honnmono.top/"), true);
  assert.equal(isAllowedHonnmonoApiBase("http://app-api.honnmono.top"), false);
  assert.equal(isAllowedHonnmonoApiBase("https://evil.example"), false);
  assert.equal(
    isAllowedHonnmonoUpstream(
      new URL("https://app-api.honnmono.top/internal/admin/feedback?page=1"),
    ),
    true,
  );
  assert.equal(
    isAllowedHonnmonoUpstream(
      new URL("https://app-api.honnmono.top/internal/admin/feedback/42/log-link"),
    ),
    true,
  );
  assert.equal(
    isAllowedHonnmonoUpstream(
      new URL(
        "https://app-api.honnmono.top/internal/admin/device/binding?imei=862635066123456",
      ),
    ),
    true,
  );
  assert.equal(
    isAllowedHonnmonoUpstream(
      new URL("https://app-api.honnmono.top/internal/admin/device/unbind"),
    ),
    true,
  );
  assert.equal(
    isAllowedHonnmonoUpstream(
      new URL("https://app-api.honnmono.top/internal/admin/feedback-log/token"),
    ),
    false,
  );
});


test("accepts a clean internal OTA service base and rejects unsafe URL shapes", () => {
  assert.equal(isAllowedOtaAdminBase("http://172.18.0.1:8086"), true);
  assert.equal(isAllowedOtaAdminBase("http://127.0.0.1:8086/"), false);
  assert.equal(isAllowedOtaAdminBase("ftp://172.18.0.1:8086"), false);
  assert.equal(isAllowedOtaAdminBase("http://user:pass@172.18.0.1:8086"), false);
  assert.equal(isAllowedOtaAdminBase("http://172.18.0.1:8086/base"), false);
  assert.equal(isAllowedOtaAdminBase("http://172.18.0.1:8086?next=evil"), false);
});


test("pins the flash admin service to the HK Docker bridge", () => {
  assert.equal(isAllowedFlashAdminBase("http://172.18.0.1:8090"), true);
  assert.equal(isAllowedFlashAdminBase("http://127.0.0.1:8090"), false);
  assert.equal(isAllowedFlashAdminBase("https://172.18.0.1:8090"), false);
  assert.equal(isAllowedFlashAdminBase("http://user:pass@172.18.0.1:8090"), false);
  assert.equal(isAllowedFlashAdminBase("http://172.18.0.1:8090/base"), false);
  assert.equal(isAllowedFlashAdminBase("http://172.18.0.1:8090?next=evil"), false);
});
