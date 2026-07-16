import { createAppRouter } from "./app-router.js";
import { mountPageModule } from "./page-lifecycle.js";
import { routeForPath } from "./route-manifest.js";
import * as shell from "../shell/shell.js";

await shell.shellReady;

let router = null;
let fallbackController = null;
const url = new URL(window.location.href);

function hardNavigate(target, { replace = false } = {}) {
  const href = target?.href ?? String(target);
  if (replace) window.location.replace(href);
  else window.location.assign(href);
}

async function mountWithoutRouter() {
  const route = routeForPath(url.pathname);
  if (!route || typeof route.load !== "function") return false;
  try {
    const module = await route.load();
    fallbackController = await mountPageModule(module, {
      url,
      route,
      historyState: null,
      navigation: Object.freeze({ hardNavigate })
    });
  } catch (error) {
    if (error?.name === "AbortError") return false;
    throw error;
  }
  shell.setPage(fallbackController.page);
  await fallbackController.activate();
  url.searchParams.delete("tpSpa");
  window.history.replaceState(window.history.state, "", url.href);
  window.addEventListener("pagehide", () => void fallbackController?.dispose(), { once: true });
  return true;
}

if (url.searchParams.get("tpSpa") === "0") {
  await mountWithoutRouter();
} else {
  router = createAppRouter({ shell });
  await router.start();
}

export { fallbackController, router };
