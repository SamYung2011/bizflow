const RULES_ID = "tp-navigation-prerender";
const PREFETCH_RULES_ID = "tp-navigation-prefetch";
const TEAM_ENTRY = "../team/index.html";
const HIGH_FREQUENCY_TARGETS = Object.freeze({
  bizflow: ["./orders.html", "./customers.html"],
  team: ["./index.html", "./members.html"]
});

function eligibleUrl(href) {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.endsWith(".html")) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

export function installNavigationPrerender(menuItems) {
  if (typeof document === "undefined") return false;
  const section = window.location.pathname.includes("/bizflow/")
    ? "bizflow"
    : window.location.pathname.includes("/team/")
      ? "team"
      : "";
  if (!section) return false;
  if (document.getElementById(RULES_ID) || document.getElementById(PREFETCH_RULES_ID)) return true;
  const currentUrl = eligibleUrl(window.location.href);
  const menuUrls = [...new Set([
    ...(menuItems ?? []).map((item) => eligibleUrl(item.href)),
    section === "bizflow" ? eligibleUrl(TEAM_ENTRY) : ""
  ].filter((url) => url && url !== currentUrl))];
  const eagerUrls = [...new Set(HIGH_FREQUENCY_TARGETS[section]
    .map(eligibleUrl)
    .filter((url) => url && url !== currentUrl))].slice(0, 2);
  const prefetch = eagerUrls.length ? [{ urls: eagerUrls, eagerness: "eager" }] : [];
  // Chrome shares two FIFO prerender slots across eager/moderate rules. Keeping
  // eager full prerenders beside hover rules caused repeated cancellation and
  // wasted subresource loads. Prefetch the common pair, then promote any actual
  // hover target (including that pair) to a moderate prerender.
  const prerender = menuUrls.length ? [{ urls: menuUrls, eagerness: "moderate" }] : [];
  if (!prefetch.length && !prerender.length) return false;
  if (prefetch.length) {
    const rules = document.createElement("script");
    rules.id = PREFETCH_RULES_ID;
    rules.type = "speculationrules";
    rules.textContent = JSON.stringify({ prefetch });
    document.head.append(rules);
  }
  if (prerender.length) {
    const rules = document.createElement("script");
    rules.id = RULES_ID;
    rules.type = "speculationrules";
    rules.textContent = JSON.stringify({ prerender });
    document.head.append(rules);
  }
  return true;
}

export function cancelNavigationPrerender() {
  document.getElementById(RULES_ID)?.remove();
}
