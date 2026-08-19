import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSourceRoot = join(repoRoot, "root-site");
const MODULE_PRELOAD_START = "<!-- modulepreload:start -->";
const MODULE_PRELOAD_END = "<!-- modulepreload:end -->";

function parseArguments(argv) {
  const values = { outputRoot: join(repoRoot, "dist"), sourceRoot: defaultSourceRoot };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inlineValue] = argument.split("=", 2);
    if (!["--outdir", "--source-root"].includes(flag)) throw new Error(`Unknown argument: ${argument}`);
    const value = inlineValue || argv[++index];
    if (!value) throw new Error(`${flag} requires a path`);
    values[flag === "--outdir" ? "outputRoot" : "sourceRoot"] = resolve(repoRoot, value);
  }
  return values;
}

function assertSafeRoots(sourceRoot, outputRoot) {
  if (!existsSync(join(sourceRoot, "spa", "entry.js")) || !existsSync(join(sourceRoot, "login", "login.js"))) {
    throw new Error(`Invalid root-site source: ${sourceRoot}`);
  }
  if (sourceRoot === outputRoot || parse(outputRoot).root === outputRoot || outputRoot === repoRoot) {
    throw new Error(`Unsafe root-site output: ${outputRoot}`);
  }
}

function outputUrl(sourceRoot, outputRoot, outputPath) {
  const absolute = resolve(sourceRoot, outputPath);
  const local = relative(outputRoot, absolute);
  if (!local || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error(`Bundle escaped output root: ${outputPath}`);
  return `/${local.split(sep).join("/")}`;
}

function entryUrls(metafile, sourceRoot, outputRoot) {
  const expected = new Map([
    [resolve(sourceRoot, "spa", "entry.js"), "spa"],
    [resolve(sourceRoot, "login", "login.js"), "login"]
  ]);
  const urls = {};
  for (const [outputPath, details] of Object.entries(metafile.outputs)) {
    if (!details.entryPoint) continue;
    const entryPoint = resolve(sourceRoot, details.entryPoint);
    const name = expected.get(entryPoint);
    if (name) urls[name] = outputUrl(sourceRoot, outputRoot, outputPath);
  }
  for (const name of ["spa", "login"]) {
    if (!urls[name] || !new RegExp(`/assets/root/${name}-[A-Z0-9]+\\.js$`).test(urls[name])) {
      throw new Error(`Missing content-hashed ${name} bundle`);
    }
  }
  return urls;
}

function replacePreloadBlock(html, bundleUrl, htmlPath) {
  const replacement = `    ${MODULE_PRELOAD_START}\n    <link rel="modulepreload" href="${bundleUrl}">\n    ${MODULE_PRELOAD_END}`;
  const pattern = new RegExp(`\\s*${MODULE_PRELOAD_START}[\\s\\S]*?${MODULE_PRELOAD_END}`);
  if (!pattern.test(html)) throw new Error(`${htmlPath} has no controlled modulepreload block`);
  return html.replace(pattern, `\n${replacement}`);
}

function rewriteBusinessHtml(outputRoot, spaUrl) {
  const pages = [];
  for (const directory of ["bizflow", "team"]) {
    const absolute = join(outputRoot, directory);
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
      const htmlPath = join(absolute, entry.name);
      const source = readFileSync(htmlPath, "utf8");
      if (!/src=["']\.\.\/spa\/entry\.js["']/.test(source)) continue;
      let html = source.replace(/src=["']\.\.\/spa\/entry\.js["']/, `src="${spaUrl}"`);
      html = replacePreloadBlock(html, spaUrl, relative(outputRoot, htmlPath));
      if (/\.\.\/spa\/entry\.js|\.\.\/(?:bizflow|team|vendor)\/[^"']+\.js/.test(html)) {
        throw new Error(`${relative(outputRoot, htmlPath)} retained a source module reference`);
      }
      writeFileSync(htmlPath, html);
      pages.push(relative(outputRoot, htmlPath).split(sep).join("/"));
    }
  }
  pages.sort();
  if (pages.length !== 17) throw new Error(`Expected 17 SPA HTML pages; rewrote ${pages.length}`);
  return pages;
}

function rewriteLoginHtml(outputRoot, loginUrl) {
  const htmlPath = join(outputRoot, "login", "index.html");
  const source = readFileSync(htmlPath, "utf8");
  const html = source.replace(/src=["']\.\/login\.js["']/, `src="${loginUrl}"`);
  if (html === source || /src=["']\.\/login\.js["']/.test(html)) throw new Error("Login HTML did not adopt its hashed bundle");
  writeFileSync(htmlPath, html);
}

export async function buildRootSite({ sourceRoot = defaultSourceRoot, outputRoot = join(repoRoot, "dist") } = {}) {
  sourceRoot = realpathSync(resolve(sourceRoot));
  outputRoot = resolve(outputRoot);
  assertSafeRoots(sourceRoot, outputRoot);
  mkdirSync(outputRoot, { recursive: true });
  outputRoot = realpathSync(outputRoot);
  assertSafeRoots(sourceRoot, outputRoot);
  cpSync(sourceRoot, outputRoot, { recursive: true, force: true });
  const generatedAssets = join(outputRoot, "assets", "root");
  rmSync(generatedAssets, { recursive: true, force: true });
  mkdirSync(generatedAssets, { recursive: true });

  const result = await build({
    absWorkingDir: sourceRoot,
    entryPoints: {
      spa: "spa/entry.js",
      login: "login/login.js"
    },
    outdir: outputRoot,
    entryNames: "assets/root/[name]-[hash]",
    bundle: true,
    splitting: false,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    minify: true,
    treeShaking: true,
    charset: "utf8",
    legalComments: "none",
    metafile: true,
    logLevel: "silent"
  });

  const urls = entryUrls(result.metafile, sourceRoot, outputRoot);
  const pages = rewriteBusinessHtml(outputRoot, urls.spa);
  rewriteLoginHtml(outputRoot, urls.login);
  const bundles = Object.fromEntries(Object.entries(urls).map(([name, url]) => [name, {
    url,
    bytes: statSync(join(outputRoot, url.slice(1))).size
  }]));
  return { bundles, pages, moduleRequests: { initial: 1, spaNavigation: 0 } };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const options = parseArguments(process.argv.slice(2));
  const result = await buildRootSite(options);
  console.log(`[root-site] ${result.pages.length} SPA pages -> ${basename(result.bundles.spa.url)} (${result.bundles.spa.bytes} bytes)`);
  console.log(`[root-site] login -> ${basename(result.bundles.login.url)} (${result.bundles.login.bytes} bytes)`);
  console.log("[root-site] module requests: 1 initial, 0 on SPA route changes");
}
