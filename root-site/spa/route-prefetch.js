import { routeForPath } from './route-manifest.js';

export function prefetchRoute(route, options = {}) {
  if (typeof route?.prefetch !== 'function') return Promise.resolve();
  return Promise.resolve().then(() => route.prefetch(options)).catch(() => {});
}

// Menu intent is only a hint; actual navigate always checks the query/version
// again. One intent per URL per shell lifetime prevents pointer/focus chatter.
export function installMenuPrefetch({ documentRef = document, windowRef = window, delay = 120 } = {}) {
  const seen = new Set();
  const pending = new Map();
  function intent(event) {
    const anchor = event.target?.closest?.('.shell-nav a[href]');
    if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
    let url;
    try { url = new URL(anchor.href, windowRef.location.href); } catch { return; }
    if (url.origin !== windowRef.location.origin) return;
    const route = routeForPath(url.pathname);
    if (!route?.prefetch || seen.has(url.href) || pending.has(url.href)) return;
    const timer = windowRef.setTimeout(() => {
      pending.delete(url.href);
      seen.add(url.href);
      void prefetchRoute(route, { url });
    }, delay);
    pending.set(url.href, timer);
  }
  documentRef.addEventListener('pointerenter', intent, true);
  documentRef.addEventListener('focusin', intent);
  return () => {
    documentRef.removeEventListener('pointerenter', intent, true);
    documentRef.removeEventListener('focusin', intent);
    for (const timer of pending.values()) windowRef.clearTimeout(timer);
    pending.clear();
  };
}
