import { SECTION_MENU_ITEMS } from "./navigation-registry.js";
import { createSectionMenu } from "./navigation-registry.js";

function bizflowRelativeHref(canonicalHref) {
  return canonicalHref.startsWith("/bizflow/")
    ? `.${canonicalHref.slice("/bizflow".length)}`
    : `..${canonicalHref}`;
}

export function createBizflowMenu(activeKey) {
  if (!SECTION_MENU_ITEMS.bizflow) return [];
  return createSectionMenu("bizflow", { activeId: activeKey, resolveHref: bizflowRelativeHref });
}
