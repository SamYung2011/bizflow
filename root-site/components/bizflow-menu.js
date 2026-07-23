import { SECTION_MENU_ITEMS } from "./navigation-registry.js";

function bizflowRelativeHref(canonicalHref) {
  return canonicalHref.startsWith("/bizflow/")
    ? `.${canonicalHref.slice("/bizflow".length)}`
    : `..${canonicalHref}`;
}

export function createBizflowMenu(activeKey) {
  return SECTION_MENU_ITEMS.bizflow.map(({
    id,
    labelKey,
    icon,
    canonicalHref,
    unreadKey,
    adminOnly
  }) => ({
    icon,
    href: bizflowRelativeHref(canonicalHref),
    ...(unreadKey ? { unreadKey } : {}),
    ...(adminOnly === true ? { adminOnly: true } : {}),
    key: labelKey,
    active: id === activeKey
  }));
}
