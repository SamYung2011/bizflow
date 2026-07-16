# SPA rollout contract

P0 added the dormant native SPA foundation. P1 enabled Home and the four OCPP pages; P2 added customers; P3 added orders; P4 added inventory and finance; P5 adds Team tasks and members. Routes not yet migrated keep their existing MPA navigation and per-page boot behavior.

## Fixed decisions

- URLs retain `.html`.
- `spaNavigation` is the master switch; a route also needs an allowlist entry and a static `load()` function before interception is possible.
- Router or route-load failure falls back to a full document navigation. Existing HTML entry points stay supported for at least one release after full migration.
- The one-shot fallback adds `?tpSpa=0`, mounts the same page controller without the router, removes the marker after mount, and leaves subsequent links as normal MPA navigations.
- Back/Forward state lives under `history.state.tpSpa`: each page controller returns serializable filter state through `captureState()`, and the router records scroll coordinates. Each migration phase owns that page's exact restore implementation.
- Unsaved work is declared through `hasUnsavedChanges()` and guarded through async `canLeave()`. Migrated pages must use the existing in-page confirm dialog; the router never calls `window.confirm()`.
- P1 migrates Home and the four OCPP pages first; P2 adds customers; P3 adds orders; P4 adds inventory and finance; P5 adds Team tasks and members. Bizflow and Team stay separate SPA sections until P6 migrates WhatsApp and closes the rollout; only then may `spaCrossSectionNavigation` be enabled.

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

Route CSS is prepared disabled, committed atomically after the page module mounts, and rolled back on load failure. Common tokens, components, icons, and shell CSS remain permanent.

## Rollout acceptance baseline

Run:

```sh
node scripts/test-spa-p1.mjs
node scripts/audit-root-site-lifecycle.mjs --check
```

`lifecycle-baseline.json` is a static import-closure call-site baseline. Browser acceptance must additionally capture runtime listener/timer watermarks before and after repeated route cycles; source counts alone cannot prove cleanup.
