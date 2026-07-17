# SPA rollout contract

P0 added the dormant native SPA foundation. P1 enabled Home and the four OCPP pages; P2 added customers; P3 added orders; P4 added inventory and finance; P5 added Team tasks and members; P6 adds WhatsApp and completes the 16-route rollout.

## Fixed decisions

- URLs retain `.html`.
- `spaNavigation` is the master switch; a route also needs an allowlist entry and a static `load()` function before interception is possible.
- Router or route-load failure falls back to a full document navigation. Existing HTML entry points stay supported for at least one release after full migration.
- The one-shot fallback adds `?tpSpa=0`, mounts the same page controller without the router, removes the marker after mount, and leaves subsequent links as normal MPA navigations.
- Back/Forward state lives under `history.state.tpSpa`: each page controller returns serializable filter state through `captureState()`, and the router records scroll coordinates. Each migration phase owns that page's exact restore implementation.
- Detail breadcrumbs use `navigateBack(fallbackHref)`: the router goes back only when the preceding `tpSpa` index belongs to that list route, otherwise it navigates forward to the fallback URL. Direct HTML loads keep their normal link/button fallback.
- Unsaved work is declared through `hasUnsavedChanges()` and guarded through async `canLeave()`. Migrated pages must use the existing in-page confirm dialog; the router never calls `window.confirm()`.
- P1 migrated Home and the four OCPP pages; P2 customers; P3 orders; P4 inventory and finance; P5 Team; P6 WhatsApp. All approved routes now share one document and `spaCrossSectionNavigation` is enabled. Existing HTML files remain direct-load and one-shot fallback entry points for at least one release.

## Page lifecycle

An enabled route module exports `mountPage(context)`. It performs data preparation without replacing the visible page and returns:

```js
{
  page: { menu, data, render, title },
  activate?(),
  canLeave?({ from, to, reason }),
  hasUnsavedChanges?(),
  captureState?(),
  dispose?()
}
```

`mountPage()` receives `scope` and `signal`. Page-owned listeners, timers, animation frames, observers, subscriptions, and child controllers must be registered through `scope` or explicitly released by `dispose()`. DOM-dependent listeners start in `activate()` so a failed preparation cannot disturb the current page.

The shell module remains mounted once. Current MPA pages are adapted from `window.__shellMenu`, `window.__shellData`, and `window.__shellContent` only at initial import; migrated pages await `shell.shellReady` and then call `shell.setPage(page)`.

## Frame-first navigation

Route menu, title, skeleton, and access metadata share one source in `route-menu.js`. After target CSS and its module are ready, the router commits that route's frame through `shell.setLoadingPage()` before awaiting page data. The loading commit changes only the active menu, document title, and content skeleton; the authenticated user, company, unread state, and top-bar state remain mounted. When `mountPage()` resolves, `shell.setPage()` replaces the skeleton with the controller content and clears `aria-busy`.

OCPP frames carry the same `adminOnly` metadata as their menu items. The router checks the already authenticated shell user before the frame commit, so a denied account follows the existing hard redirect to Home without briefly exposing an OCPP skeleton. Page-level OCPP guards remain as defense in depth.

History is committed with the frame. Back/Forward state and scroll are restored only after the data controller activates. A superseding navigation aborts the pending controller generation; failed data mounts keep their observable warning and one-shot `?tpSpa=0` document fallback.

Route CSS is prepared disabled and committed atomically with the frame after the page module loads. Asset failures roll it back before any frame change; data-mount failures retain the target frame until the one-shot document fallback takes over. Common tokens, components, icons, and shell CSS remain permanent.

P6 removes the MPA speculation-rule layer because the router now owns all approved navigation. Each direct-load HTML keeps only three module preloads: the SPA entry, that route's module, and the vendored Supabase client. Same-document changes use `document.startViewTransition()` when available; direct-load and one-shot fallback documents retain the progressive `@view-transition { navigation: auto; }` rule.

## Rollout acceptance baseline

Run:

```sh
node scripts/test-spa-p1.mjs
node scripts/audit-root-site-lifecycle.mjs --check
```

`lifecycle-baseline.json` is a static import-closure call-site baseline. Browser acceptance must additionally capture runtime listener/timer watermarks before and after repeated route cycles; source counts alone cannot prove cleanup.
