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
const DEFAULT_MOUNT_WARNING_MS = 60_000;

function abortError() {
  return new DOMException("SPA navigation aborted", "AbortError");
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function observeViewTransition(promise, phase) {
  void Promise.resolve(promise).catch((error) => {
    if (["AbortError", "InvalidStateError"].includes(error?.name)) return;
    console.warn(`[spa] view transition ${phase} failed`, error);
  });
}

async function commitViewUpdate(documentRef, update) {
  if (typeof documentRef.startViewTransition !== "function") {
    update();
    return;
  }
  const transition = documentRef.startViewTransition(update);
  observeViewTransition(transition.ready, "ready");
  observeViewTransition(transition.finished, "finished");
  await transition.updateCallbackDone;
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

async function waitForPageMount(promise, warningMs, route, signal) {
  const timeoutMs = Number(warningMs);
  const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => {
      if (!signal?.aborted) console.warn(`[spa] ${route.path} data mount still pending after ${timeoutMs}ms`);
    }, timeoutMs)
    : 0;
  try {
    return await promise;
  } finally {
    if (timer) clearTimeout(timer);
  }
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

function eligibleBackTarget(event, windowRef) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target?.closest?.("[data-spa-back]");
  const fallbackHref = target?.getAttribute("data-spa-back") || target?.getAttribute("href");
  if (!fallbackHref) return null;
  const url = new URL(fallbackHref, windowRef.location.href);
  if (url.origin !== windowRef.location.origin) return null;
  return { target, url };
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
  navigationTimeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS,
  mountWarningMs = DEFAULT_MOUNT_WARNING_MS
} = {}) {
  if (!shell || typeof shell.setPage !== "function" || typeof shell.setLoadingPage !== "function") {
    throw new TypeError("createAppRouter() requires shell.setLoadingPage() and shell.setPage().");
  }

  const allowedPaths = new Set(allowlist);
  const active = enabled === true && allowedPaths.size > 0;
  let currentController = null;
  let currentRoute = null;
  let currentUrl = new URL(windowRef.location.href);
  let currentIndex = historyDetails(windowRef.history.state)?.index ?? 0;
  let pendingAbortController = null;
  let routeGeneration = 0;
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
    const previous = historyDetails(windowRef.history.state)?.previous ?? null;
    const details = {
      index: currentIndex,
      path: currentUrl.pathname,
      previous,
      pageState: safeHistoryValue(pageState),
      scroll: { x: windowRef.scrollX || 0, y: windowRef.scrollY || 0 }
    };
    windowRef.history.replaceState(nextHistoryState(windowRef.history.state, details), "", currentUrl.href);
  }

  function savePageState(pageState) {
    replaceCurrentHistory(arguments.length ? pageState : currentController?.captureState?.());
  }

  function hardNavigate(url, { replace = false } = {}) {
    const href = url.href ?? String(url);
    if (replace && typeof windowRef.location.replace === "function") windowRef.location.replace(href);
    else windowRef.location.assign(href);
  }

  async function canLeave(toUrl, reason) {
    if (!currentController) return true;
    return currentController.canLeave({ from: currentUrl, to: toUrl, reason });
  }

  async function navigateBack(rawFallbackHref) {
    if (disposed) return false;
    const fallbackUrl = new URL(rawFallbackHref, windowRef.location.href);
    const details = historyDetails(windowRef.history.state);
    const previous = details?.previous;
    const canRestorePrevious = active
      && details?.index === currentIndex
      && Number.isInteger(previous?.index)
      && previous.index === currentIndex - 1
      && previous.path === fallbackUrl.pathname
      && typeof windowRef.history.back === "function";
    if (!canRestorePrevious) return navigate(fallbackUrl);
    replaceCurrentHistory();
    windowRef.history.back();
    return true;
  }

  function accessRedirectForRoute(route, url) {
    if (route.frame?.access !== "bf-admin") return null;
    const user = shell.getCurrentShellUser?.() ?? null;
    const authenticated = typeof user?.hasPermission === "function";
    if (!authenticated || user.isBfAdmin === true) return null;
    return new URL("/bizflow/home.html", url);
  }

  async function commitFrame({ route, url, styles, index, signal }) {
    await currentController?.dispose?.();
    currentController = null;
    if (signal?.aborted) throw abortError();
    const update = () => {
      styles.commit();
      shell.setLoadingPage(route.frame);
    };
    await commitViewUpdate(documentRef, update);
    if (signal?.aborted) throw abortError();
    currentRoute = route;
    currentUrl = url;
    currentIndex = index;
  }

  async function commitController({ controller, historyState, signal }) {
    if (signal?.aborted) throw abortError();
    shell.setPage(controller.page);
    currentController = controller;
    await controller.activate();
    if (signal?.aborted) throw abortError();
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
      if (!fromPopstate) {
        if (currentController && !await canLeave(url, "hard-navigation")) return false;
        hardNavigate(url);
      }
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
    const accessRedirect = accessRedirectForRoute(route, url);
    if (accessRedirect) {
      routeGeneration += 1;
      pendingAbortController = null;
      hardNavigate(accessRedirect, { replace: true });
      return false;
    }
    const generation = ++routeGeneration;
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

      let targetIndex = historyDetails(historyState)?.index;
      if (!fromPopstate) {
        const previous = replace
          ? historyDetails(windowRef.history.state)?.previous ?? null
          : currentRoute ? { index: currentIndex, path: currentUrl.pathname } : null;
        replaceCurrentHistory();
        targetIndex = replace ? currentIndex : currentIndex + 1;
        const details = { index: targetIndex, path: route.path, previous, pageState: null, scroll: { x: 0, y: 0 } };
        const nextState = nextHistoryState(replace ? windowRef.history.state : null, details);
        if (replace) windowRef.history.replaceState(nextState, "", url.href);
        else windowRef.history.pushState(nextState, "", url.href);
        historyState = nextState;
      }
      await commitFrame({
        route,
        url,
        styles,
        index: targetIndex ?? currentIndex,
        signal: abortController.signal
      });
      controller = await waitForPageMount(mountPageModule(module, {
        url,
        route,
        signal: abortController.signal,
        historyState: historyDetails(historyState)?.pageState ?? null,
        isCurrent: () => !disposed && generation === routeGeneration && !abortController.signal.aborted,
        navigation: Object.freeze({ navigate, navigateBack, savePageState, hardNavigate })
      }), mountWarningMs, route, abortController.signal);
      if (abortController.signal.aborted) throw abortError();
      await commitController({ controller, historyState, signal: abortController.signal });
      styles.ensureActive?.();
      if (pendingAbortController === abortController) pendingAbortController = null;
      return true;
    } catch (error) {
      abortController.abort();
      styles?.rollback?.();
      await controller?.dispose?.();
      if (currentController === controller) currentController = null;
      if (pendingAbortController === abortController) pendingAbortController = null;
      if (!isAbortError(error)) {
        console.warn("[spa] navigation failed; falling back to document navigation", error);
        const fallbackUrl = new URL(url);
        fallbackUrl.searchParams.set("tpSpa", "0");
        hardNavigate(fallbackUrl);
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
      const details = { index: currentIndex, path: route.path, previous: null, pageState: null, scroll: { x: 0, y: 0 } };
      windowRef.history.replaceState(nextHistoryState(windowRef.history.state, details), "", currentUrl.href);
    }
    return navigate(currentUrl, { replace: true, historyState: windowRef.history.state });
  }

  async function onDocumentClick(event) {
    const backTarget = eligibleBackTarget(event, windowRef);
    if (backTarget) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
      await navigateBack(backTarget.url);
      return;
    }
    const target = eligibleAnchor(event, windowRef);
    if (!target || (!routeForUrl(target.url) && !currentController)) return;
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
    routeGeneration += 1;
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
    navigateBack,
    savePageState,
    dispose
  });
}
