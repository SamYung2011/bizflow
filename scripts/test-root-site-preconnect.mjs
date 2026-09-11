import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { injectApiPreconnect, readApiOrigin } from "./root-site-preconnect.mjs";

async function fixture(files, check) {
  const root = await mkdtemp(join(tmpdir(), "preconnect-"));
  try {
    for (const [name, source] of Object.entries(files)) await writeFile(join(root, name), source);
    await check(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const config = (url) => `export const SUPABASE_URL = ${JSON.stringify(url)};`;

test("local config wins and supplies only its origin", () => fixture({
  "config.local.js": config("https://api.example.net:8443/subpath/?x=1"),
  "config.example.js": config("https://fallback.example.net")
}, async (root) => assert.equal(await readApiOrigin(root), "https://api.example.net:8443")));

test("example config is used only when local config is absent", () => fixture({
  "config.example.js": config("https://fallback.example.net/")
}, async (root) => assert.equal(await readApiOrigin(root), "https://fallback.example.net")));

for (const [name, files] of [
  ["missing", {}],
  ["placeholder", { "config.example.js": config("https://your-project.supabase.co") }],
  ["malformed", { "config.local.js": "export const SUPABASE_URL = ;" }],
  ["invalid local does not use example", { "config.local.js": config(""), "config.example.js": config("https://fallback.example.net") }],
  ["credentials", { "config.local.js": config("https://user:secret@api.example.net") }],
  ["non-HTTP", { "config.local.js": config("file:///tmp/config") }]
]) test(`${name}: omit hint and warn without exposing config`, () => fixture(files, async (root) => {
  const warnings = [];
  assert.equal(await readApiOrigin(root, (message) => warnings.push(message)), null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /preconnect omitted/);
  assert.doesNotMatch(warnings[0], /secret|SUPABASE_ANON_KEY/);
}));

test("hint precedes every resource, is anonymous, and controlled block is replaceable", () => {
  const source = '<html><head><meta charset="utf-8"><link rel="stylesheet" href="x.css"><script src="x.js"></script></head></html>';
  const once = injectApiPreconnect(source, "https://api.example.net");
  const twice = injectApiPreconnect(once, "https://new.example.net");
  assert.equal((twice.match(/rel="preconnect"/g) || []).length, 1);
  assert.match(twice.match(/<(?:link|script)\b[^>]*>/)[0], /rel="preconnect" href="https:\/\/new.example.net" crossorigin="anonymous"/);
  assert.equal(injectApiPreconnect(twice, null), source);
});
