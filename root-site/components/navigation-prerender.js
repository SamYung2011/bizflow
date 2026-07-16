const RULES_ID = "tp-navigation-prerender";
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
  if (document.getElementById(RULES_ID)) return true;
  const currentUrl = eligibleUrl(window.location.href);
  const menuUrls = [...new Set([
    ...(menuItems ?? []).map((item) => eligibleUrl(item.href)),
    section === "bizflow" ? eligibleUrl(TEAM_ENTRY) : ""
  ].filter((url) => url && url !== currentUrl))];
  const eagerUrls = [...new Set(HIGH_FREQUENCY_TARGETS[section]
    .map(eligibleUrl)
    .filter((url) => url && url !== currentUrl))].slice(0, 2);
  const eagerSet = new Set(eagerUrls);
  const moderateUrls = menuUrls.filter((url) => !eagerSet.has(url));
  const prerender = [
    ...(eagerUrls.length ? [{ urls: eagerUrls, eagerness: "eager" }] : []),
    ...(moderateUrls.length ? [{ urls: moderateUrls, eagerness: "moderate" }] : [])
  ];
  if (!prerender.length) return false;
  const rules = document.createElement("script");
  rules.id = RULES_ID;
  rules.type = "speculationrules";
  rules.textContent = JSON.stringify({ prerender });
  document.head.append(rules);
  return true;
}

export function cancelNavigationPrerender() {
  document.getElementById(RULES_ID)?.remove();
}
