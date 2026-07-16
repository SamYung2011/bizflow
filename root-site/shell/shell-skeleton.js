(async function mountShellSkeleton() {
  const root = document.getElementById("shell-root");
  if (!root || root.childElementCount) return;

  try {
    const [{ hasLiveSnapshotCache }, { snapshotsForPathname }] = await Promise.all([
      import("../data/live-table-cache.js"),
      import("../data/live-snapshot-dependencies.js")
    ]);
    const snapshots = snapshotsForPathname(window.location.pathname);
    if (snapshots.length && await hasLiveSnapshotCache(snapshots)) return;
  } catch (error) {
    console.warn("[shell-boot] snapshot cache probe failed", error);
  }
  if (root.childElementCount) return;

  const mobileViewport = window.matchMedia?.("(max-width: 768px)") ?? null;
  const navRows = window.location.pathname.includes("/team/") ? 2 : 6;
  const block = (className = "") => `<span class="shell-boot__block${className ? ` ${className}` : ""}"></span>`;

  const render = () => {
    const mode = mobileViewport?.matches ? "mobile" : "desktop";
    root.innerHTML = `<div class="shell-app shell-app--${mode} shell-boot" aria-hidden="true">
      <header class="shell-topbar">
        <div class="shell-topbar__brand">
          <span class="shell-topbar__desktop-brand">${block("shell-boot__brand")}</span>
          <span class="shell-topbar__mobile-brand">${block("shell-boot__mobile-brand")}</span>
        </div>
        <div class="shell-topbar__search">${block("shell-boot__search")}</div>
        <div class="shell-topbar__actions">${block("shell-boot__circle")}${block("shell-boot__circle")}${block("shell-boot__circle")}</div>
        <div class="shell-topbar__mobile-actions">${block("shell-boot__circle")}${block("shell-boot__circle")}</div>
      </header>
      <aside class="shell-sidebar">
        ${block("shell-boot__select")}
        <nav class="shell-nav">${Array.from({ length: navRows }, () => block("shell-boot__nav-row")).join("")}</nav>
        ${block("shell-boot__nav-row")}
      </aside>
      <main class="shell-main">
        <div class="shell-page-inner">
          ${block("shell-boot__title")}
          <div class="shell-boot__stats">${Array.from({ length: 4 }, () => block("shell-boot__stat")).join("")}</div>
          ${block("shell-boot__panel")}
        </div>
      </main>
    </div>`;
  };

  const onViewportChange = () => render();
  root.setAttribute("aria-busy", "true");
  render();
  if (mobileViewport) {
    if (typeof mobileViewport.addEventListener === "function") mobileViewport.addEventListener("change", onViewportChange);
    else mobileViewport.addListener(onViewportChange);
  }
  window.__shellBootCleanup = () => {
    if (mobileViewport) {
      if (typeof mobileViewport.removeEventListener === "function") mobileViewport.removeEventListener("change", onViewportChange);
      else mobileViewport.removeListener(onViewportChange);
    }
    root.removeAttribute("aria-busy");
    delete window.__shellBootCleanup;
  };
})();
