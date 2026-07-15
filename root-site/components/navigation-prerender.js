const RULES_ID = "tp-navigation-prerender";
const TEAM_ENTRY = "../team/index.html";

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
  if (typeof document === "undefined" || !window.location.pathname.includes("/bizflow/")) return false;
  if (document.getElementById(RULES_ID)) return true;
  const currentUrl = eligibleUrl(window.location.href);
  const urls = [...new Set([
    ...(menuItems ?? []).map((item) => eligibleUrl(item.href)),
    eligibleUrl(TEAM_ENTRY)
  ].filter((url) => url && url !== currentUrl))];
  if (!urls.length) return false;
  const rules = document.createElement("script");
  rules.id = RULES_ID;
  rules.type = "speculationrules";
  rules.textContent = JSON.stringify({
    prerender: [{ urls, eagerness: "moderate" }]
  });
  document.head.append(rules);
  return true;
}

export function cancelNavigationPrerender() {
  document.getElementById(RULES_ID)?.remove();
}
