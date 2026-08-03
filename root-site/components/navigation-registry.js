function freezeItems(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}

export const SECTION_MENU_ITEMS = Object.freeze({
  bizflow: freezeItems([
    { id: "home", labelKey: "nav.home", icon: "icon-nav-home", canonicalHref: "/bizflow/home.html" },
    { id: "orders", labelKey: "nav.orders", icon: "icon-nav-list", canonicalHref: "/bizflow/orders.html", unreadKey: "orders" },
    { id: "customers", labelKey: "nav.customers", icon: "icon-nav-user", canonicalHref: "/bizflow/customers.html" },
    { id: "inventory", labelKey: "nav.inventory", icon: "icon-nav-inventory", canonicalHref: "/bizflow/inventory.html", unreadKey: "inventory" },
    { id: "finance", labelKey: "nav.finance", icon: "icon-nav-sales", canonicalHref: "/bizflow/expense.html" },
    { id: "tasks", labelKey: "nav.tasks", icon: "icon-nav-task", canonicalHref: "/team/index.html", unreadKey: "tasks" },
    { id: "whatsapp", labelKey: "nav.whatsapp", icon: "icon-nav-messenger", canonicalHref: "/bizflow/whatsapp.html" },
    { id: "ocpp-monitor", labelKey: "nav.ocppMonitor", icon: "icon-nav-remix", canonicalHref: "/bizflow/ocpp-monitor.html", adminOnly: true },
    { id: "ocpp-charging", labelKey: "nav.ocppCharging", icon: "icon-nav-cloud", canonicalHref: "/bizflow/ocpp-charging.html", adminOnly: true },
    { id: "ocpp-users", labelKey: "nav.ocppUsers", icon: "icon-nav-user", canonicalHref: "/bizflow/ocpp-users.html", adminOnly: true },
    { id: "ocpp-finance", labelKey: "nav.ocppFinance", icon: "icon-nav-sales", canonicalHref: "/bizflow/ocpp-finance.html", adminOnly: true },
    { id: "app-feedback", labelKey: "nav.honnmonoApp", icon: "icon-nav-messenger", canonicalHref: "/bizflow/app-feedback.html", adminOnly: true }
  ]),
  team: freezeItems([
    { id: "tasks", labelKey: "nav.tasks", icon: "icon-nav-task", canonicalHref: "/team/index.html", unreadKey: "tasks" },
    { id: "team", labelKey: "nav.team", icon: "icon-nav-user", canonicalHref: "/team/members.html" }
  ])
});

export function createSectionMenu(section, { activeId = "", resolveHref = (href) => href } = {}) {
  return (SECTION_MENU_ITEMS[section] ?? []).map(({ id, labelKey, icon, canonicalHref, unreadKey, adminOnly }) => ({
    key: labelKey,
    icon,
    href: resolveHref(canonicalHref),
    ...(unreadKey ? { unreadKey } : {}),
    ...(adminOnly === true ? { adminOnly: true } : {}),
    active: id === activeId
  }));
}
