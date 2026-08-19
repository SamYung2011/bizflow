import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { buildRootSite } from "./build-root-site.mjs";
import { spaRouteAllowlist } from "../root-site/spa/route-manifest.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repoRoot, "root-site");
const businessPages = [...spaRouteAllowlist].map((route) => route.replace(/^\//, "")).sort();

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)=["']([^"']*)["']/g)].map((match) => [match[1], match[2]]));
}

async function moduleReferences(htmlPath) {
  const html = await readFile(htmlPath, "utf8");
  const tags = [...html.matchAll(/<(?:link|script)\b[^>]*>/g)].map((match) => attributes(match[0]));
  return {
    html,
    scripts: tags.filter((tag) => tag.type === "module" && tag.src).map((tag) => tag.src),
    preloads: tags.filter((tag) => tag.rel === "modulepreload" && tag.href).map((tag) => tag.href)
  };
}

async function assetBytes(outputRoot, url) {
  return readFile(path.join(outputRoot, url.replace(/^\//, "")));
}

async function assertProductionOutput(outputRoot, result) {
  assert.equal(result.pages.length, 17, "all current SPA business pages must be rewritten");
  assert.deepEqual(result.pages, businessPages);
  assert.deepEqual(result.moduleRequests, { initial: 1, spaNavigation: 0 },
    "the atomic SPA bundle must take one initial module request and none on route changes");
  assert.match(result.bundles.spa.url, /^\/assets\/root\/spa-[A-Z0-9]+\.js$/);
  assert.match(result.bundles.login.url, /^\/assets\/root\/login-[A-Z0-9]+\.js$/);

  const assets = (await readdir(path.join(outputRoot, "assets/root"))).sort();
  assert.deepEqual(assets, [path.basename(result.bundles.login.url), path.basename(result.bundles.spa.url)].sort(),
    "the root-site build must emit only the atomic SPA and login modules");

  for (const page of businessPages) {
    const refs = await moduleReferences(path.join(outputRoot, page));
    assert.deepEqual(refs.scripts, [result.bundles.spa.url], `${page} must load only the current SPA fingerprint`);
    assert.deepEqual(refs.preloads, [result.bundles.spa.url], `${page} must preload only the current SPA fingerprint`);
    assert.doesNotMatch(refs.html, /\.\.\/spa\/entry\.js|\.\.\/(?:bizflow|team|vendor)\/[^"']+\.js/,
      `${page} must retain no source module URL`);
  }

  const login = await moduleReferences(path.join(outputRoot, "login/index.html"));
  assert.deepEqual(login.scripts, [result.bundles.login.url], "login must load its current fingerprint only");
  assert.doesNotMatch(login.html, /src=["']\.\/login\.js["']/);

  const spaBundle = (await assetBytes(outputRoot, result.bundles.spa.url)).toString("utf8");
  assert.doesNotMatch(spaBundle, /\bimport\s*\(/,
    "the atomic SPA bundle must not leave route, shell or config modules for a second request");
  assert.match(spaBundle, /data\/snapshots\/orders\.json/, "snapshot URLs must remain rooted after bundling");
  assert.match(spaBundle, /bizflow\/orders\.css/, "route stylesheet URLs must remain rooted after bundling");
  for (const bundle of Object.values(result.bundles)) {
    const checked = spawnSync(process.execPath, ["--check", path.join(outputRoot, bundle.url.slice(1))], { encoding: "utf8" });
    assert.equal(checked.status, 0, `${bundle.url} must be valid JavaScript: ${checked.stderr}`);
  }
}

const tempRoot = await mkdtemp(path.join(tmpdir(), "bizflow-root-build-"));
try {
  const outputA = path.join(tempRoot, "a");
  const outputB = path.join(tempRoot, "b");
  const outputChanged = path.join(tempRoot, "changed");
  const changedSource = path.join(tempRoot, "source");
  const sourceHtmlBefore = await Promise.all(businessPages.map((page) => readFile(path.join(sourceRoot, page), "utf8")));

  const first = await buildRootSite({ sourceRoot, outputRoot: outputA });
  const second = await buildRootSite({ sourceRoot, outputRoot: outputB });
  await assertProductionOutput(outputA, first);
  await assertProductionOutput(outputB, second);
  assert.deepEqual(second, first, "same source must produce the same filenames and metadata");
  for (const name of ["spa", "login"]) {
    assert.deepEqual(await assetBytes(outputB, second.bundles[name].url), await assetBytes(outputA, first.bundles[name].url),
      `${name} bundle bytes must be reproducible`);
  }

  await cp(sourceRoot, changedSource, { recursive: true });
  const changedEntry = path.join(changedSource, "spa/entry.js");
  await writeFile(changedEntry, `${await readFile(changedEntry, "utf8")}\nconsole.debug("root-site hash probe");\n`);
  const changed = await buildRootSite({ sourceRoot: changedSource, outputRoot: outputChanged });
  assert.notEqual(changed.bundles.spa.url, first.bundles.spa.url, "one SPA source change must produce a new filename");
  assert.equal(changed.bundles.login.url, first.bundles.login.url, "an unrelated SPA change must not invalidate login");
  const changedHtml = await readFile(path.join(outputChanged, businessPages[0]), "utf8");
  assert.match(changedHtml, new RegExp(changed.bundles.spa.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(changedHtml, new RegExp(first.bundles.spa.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "production HTML must not retain the previous fingerprint");

  const sourceHtmlAfter = await Promise.all(businessPages.map((page) => readFile(path.join(sourceRoot, page), "utf8")));
  assert.deepEqual(sourceHtmlAfter, sourceHtmlBefore, "production builds must not rewrite source development HTML");
  assert.ok(sourceHtmlAfter.every((html) => html.includes('../spa/entry.js')),
    "direct source development must keep the unbundled SPA entry");

  const vercel = JSON.parse(await readFile(path.join(repoRoot, "vercel.json"), "utf8"));
  const cacheRules = vercel.headers.flatMap((rule) => rule.headers.map((header) => ({ source: rule.source, ...header })));
  assert.equal(cacheRules.find((rule) => rule.source === "/(.*)" && rule.key === "Cache-Control")?.value,
    "public, max-age=0, must-revalidate", "HTML and unhashed files must still revalidate");
  assert.equal(cacheRules.find((rule) => rule.source === "/assets/root/(.*)" && rule.key === "Cache-Control")?.value,
    "public, max-age=31536000, immutable", "only root-site fingerprints get immutable caching");
  assert.equal(cacheRules.some((rule) => String(rule.value).includes("stale-while-revalidate")), false,
    "the July mixed-release cache policy must not return");

  const frontDoor = await readFile(path.join(repoRoot, "scripts/build-front-door.mjs"), "utf8");
  assert.match(frontDoor, /node scripts\/build-root-site\.mjs --outdir dist/,
    "the normal production build must generate current root-site fingerprints");
  assert.doesNotMatch(frontDoor, /cpSync\(join\(repoRoot, ["']root-site["']/,
    "the normal production build must not bypass fingerprint generation with a raw copy");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("PERF-build-1 root-site contracts: PASS (17 pages, 1+0 modules, reproducible hashes, immutable boundary)");
