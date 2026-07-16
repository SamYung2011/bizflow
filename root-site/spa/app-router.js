import { mountPageModule } from "./page-lifecycle.js";
import {
  routeManifest,
  spaCrossSectionNavigation,
  spaNavigation,
  spaRouteAllowlist
} from "./route-manifest.js";
import { createRouteStyleManager } from "./route-styles.js";

export const SPA_HISTORY_KEY = "tpSpa";
export const SPA_HISTORY_VERSION = 1;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000;

function abortError() {
  return new DOMException("SPA navigation aborted", "AbortError");
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function safeHistoryValue(value) {
  if (value === undefined) return null;
  try {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  } catch {
    console.warn("[spa] page state is not serializable; dropping it");
    return null;
  }
}

function historyDetails(state) {
  const value = state?.[SPA_HISTORY_KEY];
  return value?.version === SPA_HISTORY_VERSION && Number.isInteger(value.index) ? value : null;
}

function nextHistoryState(base, details) {
  return {
    ...(base && typeof base === "object" ? base : {}),
    [SPA_HISTORY_KEY]: { version: SPA_HISTORY_VERSION, ...details }
  };
}

function withTimeout(promise, timeoutMs, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`SPA navigation timed out after ${timeoutMs}ms`)), timeoutMs);
    const onAbort = () => reject(abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    });
  });
}

function eligibleAnchor(event, windowRef) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target?.closest?.("a[href]");
  if (!anchor || anchor.hasAttribute("download") || anchor.dataset.spaHardNavigation !== undefined) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  const url = new URL(anchor.href, windowRef.location.href);
  if (url.origin !== windowRef.location.origin) return null;
  return { anchor, url };
}

export function createAppRouter({
  shell,
  manifest = routeManifest,
  allowlist = spaRouteAllowlist,
  enabled = spaNavigation,
  crossSection = spaCrossSectionNavigation,
  windowRef = window,
  documentRef = document,
  styleManager = createRouteStyleManager(documentRef),
  navigationTimeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS
} = {}) {
  if (!shell || typeof shell.setPage !== "function") {
    throw new TypeError("createAppRouter() requires shell.setPage().");
  }

  const allowedPaths = new Set(allowlist);
  const active = enabled === true && allowedPaths.size > 0;
  let currentController = null;
  let currentRoute = null;
  let currentUrl = new URL(windowRef.location.href);
  let currentIndex = historyDetails(windowRef.history.state)?.index ?? 0;
  let pendingAbortController = null;
  let disposed = false;
  let suppressPopstate = false;
  let scrollFrame = 0;

  function routeForUrl(url) {
    const route = manifest[url.pathname] ?? null;
    if (!route || !allowedPaths.has(route.path) || typeof route.load !== "function") return null;
    if (!crossSection && currentRoute && route.section !== currentRoute.section) return null;
    return route;
  }

  function replaceCurrentHistory(pageState = currentController?.captureState?.()) {
    if (!currentRoute) return;
    const details = {
      index: currentIndex,
      path: currentUrl.pathname,
      pageState: safeHistoryValue(pageState),
      scroll: { x: windowRef.scrollX || 0, y: windowRef.scrollY || 0 }
    };
    windowRef.history.replaceState(nextHistoryState(windowRef.history.state, details), "", currentUrl.href);
  }

  function savePageState(pageState) {
    replaceCurrentHistory(arguments.length ? pageState : currentController?.captureState?.());
  }

  function hardNavigate(url) {
    windowRef.location.assign(url.href ?? String(url));
  }

  async function canLeave(toUrl, reason) {
    if (!currentController) return true;
    return currentController.canLeave({ from: currentUrl, to: toUrl, reason });
  }

  async function commitController({ controller, route, url, styles, historyState, index, signal }) {
    await currentController?.dispose?.();
    if (signal?.aborted) throw abortError();
    const update = () => {
      styles.commit();
      shell.setPage(controller.page);
    };
    if (typeof documentRef.startViewTransition === "function") {
      const transition = documentRef.startViewTransition(update);
      await transition.updateCallbackDone;
    } else {
      update();
    }
    if (signal?.aborted) throw abortError();
    currentController = controller;
    currentRoute = route;
    currentUrl = url;
    currentIndex = index;
    await controller.activate();
    const scroll = historyDetails(historyState)?.scroll;
    const x = Number.isFinite(scroll?.x) ? scroll.x : 0;
    const y = Number.isFinite(scroll?.y) ? scroll.y : 0;
    const requestFrame = windowRef.requestAnimationFrame ?? ((callback) => windowRef.setTimeout(callback, 0));
    requestFrame(() => windowRef.scrollTo(x, y));
  }

  async function navigate(rawUrl, { replace = false, fromPopstate = false, historyState = null } = {}) {
    if (disposed) return false;
    const url = new URL(rawUrl, windowRef.location.href);
    const route = routeForUrl(url);
    if (!active || !route) {
      if (!fromPopstate) hardNavigate(url);
      return false;
    }
    if (!fromPopstate && currentRoute && url.href === currentUrl.href) return true;
    if (!await canLeave(url, fromPopstate ? "popstate" : "link")) {
      if (fromPopstate) {
        const targetIndex = historyDetails(historyState)?.index;
        const delta = Number.isInteger(targetIndex) ? currentIndex - targetIndex : 0;
        if (delta) {
          suppressPopstate = true;
          windowRef.history.go(delta);
        } else {
          hardNavigate(currentUrl);
        }
      }
      return false;
    }

    pendingAbortController?.abort();
    const abortController = new AbortController();
    pendingAbortController = abortController;
    let styles = null;
    let controller = null;
    try {
      const [preparedStyles, module] = await withTimeout(Promise.all([
        styleManager.prepare(route.styles, { signal: abortController.signal }),
        route.load()
      ]), navigationTimeoutMs, abortController.signal);
      styles = preparedStyles;
      controller = await withTimeout(mountPageModule(module, {
        url,
        route,
        historyState: historyDetails(historyState)?.pageState ?? null,
        navigation: Object.freeze({ navigate, savePageState, hardNavigate })
      }), navigationTimeoutMs, abortController.signal);
      if (abortController.signal.aborted) throw abortError();

      let targetIndex = historyDetails(historyState)?.index;
      if (!fromPopstate) {
        replaceCurrentHistory();
        targetIndex = replace ? currentIndex : currentIndex + 1;
        const details = { index: targetIndex, path: route.path, pageState: null, scroll: { x: 0, y: 0 } };
        const nextState = nextHistoryState(replace ? windowRef.history.state : null, details);
        if (replace) windowRef.history.replaceState(nextState, "", url.href);
        else windowRef.history.pushState(nextState, "", url.href);
        historyState = nextState;
      }
      await commitController({
        controller,
        route,
        url,
        styles,
        historyState,
        index: targetIndex ?? currentIndex,
        signal: abortController.signal
      });
      if (pendingAbortController === abortController) pendingAbortController = null;
      return true;
    } catch (error) {
      abortController.abort();
      styles?.rollback?.();
      await controller?.dispose?.();
      if (pendingAbortController === abortController) pendingAbortController = null;
      if (!isAbortError(error)) {
        console.warn("[spa] navigation failed; falling back to document navigation", error);
        hardNavigate(url);
      }
      return false;
    }
  }

  async function start() {
    if (!active) return false;
    const route = routeForUrl(currentUrl);
    if (!route) return false;
    styleManager.adopt(route.styles);
    const existing = historyDetails(windowRef.history.state);
    currentIndex = existing?.index ?? 0;
    if (!existing) {
      const details = { index: currentIndex, path: route.path, pageState: null, scroll: { x: 0, y: 0 } };
      windowRef.history.replaceState(nextHistoryState(windowRef.history.state, details), "", currentUrl.href);
    }
    return navigate(currentUrl, { replace: true, historyState: windowRef.history.state });
  }

  async function onDocumentClick(event) {
    const target = eligibleAnchor(event, windowRef);
    if (!target || !routeForUrl(target.url)) return;
    event.preventDefault();
    await navigate(target.url);
  }

  async function onPopstate(event) {
    if (suppressPopstate) {
      suppressPopstate = false;
      return;
    }
    const url = new URL(windowRef.location.href);
    if (!routeForUrl(url)) return;
    await navigate(url, { fromPopstate: true, historyState: event.state });
  }

  function onScroll() {
    if (scrollFrame) return;
    scrollFrame = windowRef.requestAnimationFrame(() => {
      scrollFrame = 0;
      replaceCurrentHistory();
    });
  }

  function onBeforeUnload(event) {
    if (!currentController?.hasUnsavedChanges?.()) return;
    event.preventDefault();
    event.returnValue = "";
  }

  if (active) {
    documentRef.addEventListener("click", onDocumentClick);
    windowRef.addEventListener("popstate", onPopstate);
    windowRef.addEventListener("scroll", onScroll, { passive: true });
    windowRef.addEventListener("beforeunload", onBeforeUnload);
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    pendingAbortController?.abort();
    if (scrollFrame) windowRef.cancelAnimationFrame(scrollFrame);
    if (active) {
      documentRef.removeEventListener("click", onDocumentClick);
      windowRef.removeEventListener("popstate", onPopstate);
      windowRef.removeEventListener("scroll", onScroll, { passive: true });
      windowRef.removeEventListener("beforeunload", onBeforeUnload);
    }
    await currentController?.dispose?.();
    styleManager.dispose();
  }

  return Object.freeze({
    enabled: active,
    start,
    navigate,
    savePageState,
    dispose
  });
}
