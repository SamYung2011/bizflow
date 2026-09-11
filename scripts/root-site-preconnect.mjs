import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const START = "<!-- api-preconnect:start -->";
const END = "<!-- api-preconnect:end -->";

export async function readApiOrigin(sourceRoot, warn = console.warn) {
  const configPath = ["config.local.js", "config.example.js"]
    .map((name) => join(sourceRoot, name)).find(existsSync);
  try {
    if (!configPath) throw new Error("Missing config");
    const configUrl = pathToFileURL(configPath);
    configUrl.searchParams.set("mtime", String(statSync(configPath).mtimeMs));
    const { SUPABASE_URL } = await import(configUrl.href);
    const url = new URL(SUPABASE_URL);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || url.hostname === "your-project.supabase.co") throw new Error("Unconfigured API origin");
    return url.origin;
  } catch {
    // Do not print config contents (or import errors that might include credentials).
    warn("[root-site] SUPABASE_URL unavailable or invalid; API preconnect omitted");
    return null;
  }
}

export function injectApiPreconnect(html, origin) {
  const withoutHint = html.replace(new RegExp(`\\s*${START}[\\s\\S]*?${END}`), "");
  if (!origin) return withoutHint;
  if (!/<head\b[^>]*>/i.test(withoutHint)) throw new Error("HTML has no head for API preconnect");
  return withoutHint.replace(/<head\b[^>]*>/i, (head) => `${head}\n    ${START}\n    <link rel="preconnect" href="${origin}" crossorigin="anonymous">\n    ${END}`);
}
