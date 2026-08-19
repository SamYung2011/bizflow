import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = path.join(repoRoot, "root-site");
const startMarker = "    <!-- modulepreload:start -->";
const endMarker = "    <!-- modulepreload:end -->";
const spaEntryPath = path.join(siteRoot, "spa/entry.js");
const vendorPath = path.join(siteRoot, "vendor/supabase-js.esm.js");

function sitePath(filePath) {
  return path.relative(siteRoot, filePath).split(path.sep).join("/");
}

function assertInsideSite(filePath) {
  const relative = path.relative(siteRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Module escaped root-site: ${filePath}`);
  }
}

function resolveModule(importer, specifier) {
  if (/^[a-z]+:/i.test(specifier)) return null;
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    throw new Error(`Bare module import is unsupported: ${specifier} in ${sitePath(importer)}`);
  }
  const resolved = specifier.startsWith("/")
    ? path.resolve(siteRoot, `.${specifier}`)
    : path.resolve(path.dirname(importer), specifier);
  assertInsideSite(resolved);
  return resolved;
}

function extractLiteralImports(source) {
  const specifiers = new Set();
  const staticImport = /(?:^|\n)\s*(?:import|export)\s+(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [staticImport, dynamicImport]) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

async function moduleDependencies(filePath) {
  const relative = sitePath(filePath);
  // The vendored browser bundle is already a leaf; parsing its bundled Node fallbacks
  // would mistake unreachable bare imports for browser dependencies.
  if (relative.startsWith("vendor/")) return [];

  const source = await fs.readFile(filePath, "utf8");
  const dependencies = extractLiteralImports(source)
    .map((specifier) => resolveModule(filePath, specifier))
    .filter(Boolean);
  return [...new Set(dependencies)];
}

async function collectModuleGraph(entryPath) {
  const queue = [entryPath];
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    assertInsideSite(current);
    await fs.access(current);
    visited.add(current);
    queue.push(...await moduleDependencies(current));
  }
  return [...visited];
}

function moduleEntry(html, htmlPath) {
  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
  const entries = scriptTags.flatMap((tag) => {
    if (!/\btype=["']module["']/i.test(tag)) return [];
    const source = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    return source ? [source] : [];
  });
  if (entries.length !== 1) {
    throw new Error(`${sitePath(htmlPath)} must contain exactly one module entry; found ${entries.length}`);
  }
  return resolveModule(htmlPath, entries[0]);
}

function preloadHref(htmlPath, modulePath) {
  const relative = path.relative(path.dirname(htmlPath), modulePath).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function replaceGeneratedBlock(html, links, htmlPath) {
  const block = [startMarker, ...links, endMarker].join("\n");
  const existing = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
  if (existing.test(html)) return html.replace(existing, block);
  if (!html.includes("  </head>")) throw new Error(`${sitePath(htmlPath)} has no expected </head>`);
  return html.replace("  </head>", `${block}\n  </head>`);
}

async function businessHtmlFiles() {
  const files = [];
  for (const directory of ["bizflow", "team"]) {
    const absolute = path.join(siteRoot, directory);
    for (const entry of await fs.readdir(absolute, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".html")) files.push(path.join(absolute, entry.name));
    }
  }
  files.sort();
  if (files.length !== 17) throw new Error(`Expected 17 business HTML files; found ${files.length}`);
  return files;
}

function routeEntryForHtml(htmlPath) {
  if (sitePath(htmlPath) === "team/index.html") return path.join(siteRoot, "team/tasks.js");
  return htmlPath.replace(/\.html$/, ".js");
}

const htmlFiles = await businessHtmlFiles();
const allModules = new Set();
for (const htmlPath of htmlFiles) {
  const html = await fs.readFile(htmlPath, "utf8");
  const entryPath = moduleEntry(html, htmlPath);
  const modules = entryPath === spaEntryPath
    ? [spaEntryPath, routeEntryForHtml(htmlPath), vendorPath]
    : await collectModuleGraph(entryPath);
  for (const modulePath of modules) await fs.access(modulePath);
  if (!modules.includes(vendorPath)) {
    throw new Error(`${sitePath(htmlPath)} preload set does not include vendor/supabase-js.esm.js`);
  }
  modules.forEach((modulePath) => allModules.add(modulePath));
  const links = modules.map((modulePath) => `    <link rel="modulepreload" href="${preloadHref(htmlPath, modulePath)}">`);
  await fs.writeFile(htmlPath, replaceGeneratedBlock(html, links, htmlPath));
  console.log(`${sitePath(htmlPath)}: ${modules.length} modules`);
}

console.log(`Generated modulepreload blocks for ${htmlFiles.length} pages (${allModules.size} unique modules).`);
