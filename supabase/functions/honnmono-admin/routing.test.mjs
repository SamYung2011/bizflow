import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedHonnmonoApiBase,
  isAllowedHonnmonoUpstream,
  mapHonnmonoAdminPath,
  stripFunctionPrefix,
} from "./routing.mjs";


test("maps only the feedback read and link-issuance routes", () => {
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
});


test("rejects writes, raw download proxying, and unrelated routes", () => {
  assert.equal(mapHonnmonoAdminPath("/feedback", "POST"), "");
  assert.equal(mapHonnmonoAdminPath("/feedback/42", "DELETE"), "");
  assert.equal(mapHonnmonoAdminPath("/feedback-log/token", "GET"), "");
  assert.equal(mapHonnmonoAdminPath("/internal/admin/feedback", "GET"), "");
  assert.equal(mapHonnmonoAdminPath("/feedback/0", "GET"), "");
  assert.equal(mapHonnmonoAdminPath("/feedback/not-an-id", "GET"), "");
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
      new URL("https://app-api.honnmono.top/internal/admin/feedback-log/token"),
    ),
    false,
  );
});
