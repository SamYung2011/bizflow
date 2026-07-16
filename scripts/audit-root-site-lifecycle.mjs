import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { routeManifest } from "../root-site/spa/route-manifest.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = path.join(rootDir, "root-site/spa/lifecycle-baseline.json");
const write = process.argv.includes("--write");
const check = process.argv.includes("--check");

const counters = Object.freeze({
  documentListeners: /\bdocument\.addEventListener\s*\(/g,
  windowListeners: /\bwindow\.addEventListener\s*\(/g,
  mediaQueryListeners: /\b(?:mobileViewport|mediaQuery|query)\.(?:addEventListener|addListener)\s*\(/g,
  timeouts: /\bsetTimeout\s*\(/g,
  intervals: /\bsetInterval\s*\(/g,
  animationFrames: /\brequestAnimationFrame\s*\(/g,
  observers: /\bnew\s+(?:MutationObserver|ResizeObserver|IntersectionObserver)\s*\(/g,
  authSubscriptions: /\.onAuthStateChange\s*\(/g,
  realtimeSubscriptions: /\.subscribe\s*\(/g
});

function imports(source) {
  const values = new Set();
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /^\s*import\s*["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ]) {
    for (const match of source.matchAll(pattern)) values.add(match[1]);
  }
  return [...values].filter((value) => value.startsWith("."));
}

function resolveModule(fromFile, specifier) {
  const candidate = path.resolve(path.dirname(fromFile), specifier);
  for (const file of [candidate, `${candidate}.js`, path.join(candidate, "index.js")]) {
    if (existsSync(file)) return file;
  }
  return null;
}

async function moduleClosure(entry) {
  const pending = [entry];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(file, "utf8");
    for (const specifier of imports(source)) {
      const dependency = resolveModule(file, specifier);
      if (dependency?.startsWith(path.join(rootDir, "root-site"))) pending.push(dependency);
    }
  }
  return [...seen].sort();
}

function count(source, pattern) {
  return [...source.matchAll(new RegExp(pattern.source, pattern.flags))].length;
}

async function auditRoute(route) {
  const files = await moduleClosure(fileURLToPath(route.entry));
  const totals = Object.fromEntries(Object.keys(counters).map((key) => [key, 0]));
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const calls = Object.fromEntries(Object.entries(counters).map(([key, pattern]) => [key, count(source, pattern)]));
    Object.entries(calls).forEach(([key, value]) => totals[key] += value);
  }
  return { moduleCount: files.length, totals };
}

const routes = {};
for (const route of Object.values(routeManifest)) routes[route.path] = await auditRoute(route);
const baseline = {
  schemaVersion: 1,
  kind: "static-source-call-sites",
  note: "Current source baseline; browser acceptance must also compare runtime listener and timer watermarks.",
  routes
};
const serialized = `${JSON.stringify(baseline, null, 2)}\n`;

if (write) await writeFile(outputFile, serialized);
if (check) {
  const current = await readFile(outputFile, "utf8");
  if (current !== serialized) {
    console.error("Lifecycle baseline is stale. Run: node scripts/audit-root-site-lifecycle.mjs --write");
    process.exitCode = 1;
  }
}
if (!write && !check) process.stdout.write(serialized);
else console.log(`Lifecycle baseline ${write ? "written" : "verified"}: ${path.relative(rootDir, outputFile)}`);
