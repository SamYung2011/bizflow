const BUNDLED_ROOT_ASSET_PATH = "/assets/root/";

export function rootSiteUrl(path) {
  const relative = String(path || "").replace(/^\/+/, "");
  const moduleUrl = new URL(import.meta.url);
  const root = moduleUrl.pathname.includes(BUNDLED_ROOT_ASSET_PATH)
    ? new URL("/", moduleUrl)
    : new URL("../", moduleUrl);
  return new URL(relative, root);
}
