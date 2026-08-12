import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedHonnmonoApiBase,
  isAllowedHonnmonoUpstream,
  mapHonnmonoAdminPath,
  stripFunctionPrefix,
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
