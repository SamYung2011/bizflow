const routeMenuEntries = Object.freeze({
  "/bizflow/home.html": { section: "bizflow", menuKey: "home" },
  "/bizflow/orders.html": { section: "bizflow", menuKey: "orders" },
  "/bizflow/orders-create.html": { section: "bizflow", menuKey: "orders" },
  "/bizflow/orders-detail.html": { section: "bizflow", menuKey: "orders" },
  "/bizflow/customers.html": { section: "bizflow", menuKey: "customers" },
  "/bizflow/customer-detail.html": { section: "bizflow", menuKey: "customers" },
  "/bizflow/inventory.html": { section: "bizflow", menuKey: "inventory" },
  "/bizflow/inventory-detail.html": { section: "bizflow", menuKey: "inventory" },
  "/bizflow/expense.html": { section: "bizflow", menuKey: "finance" },
  "/bizflow/whatsapp.html": { section: "bizflow", menuKey: "whatsapp" },
  "/bizflow/ocpp-monitor.html": { section: "bizflow", menuKey: "ocpp-monitor" },
  "/bizflow/ocpp-charging.html": { section: "bizflow", menuKey: "ocpp-charging" },
  "/bizflow/ocpp-users.html": { section: "bizflow", menuKey: "ocpp-users" },
  "/bizflow/ocpp-finance.html": { section: "bizflow", menuKey: "ocpp-finance" },
  "/team/index.html": { section: "team", menuKey: "tasks" },
  "/team/members.html": { section: "team", menuKey: "team" }
});

const sectionMenus = Object.freeze({
  bizflow: Object.freeze([
    { id: "home", key: "nav.home", icon: "icon-nav-home", href: "/bizflow/home.html" },
    { id: "orders", key: "nav.orders", icon: "icon-nav-list", href: "/bizflow/orders.html", unreadKey: "orders" },
    { id: "customers", key: "nav.customers", icon: "icon-nav-user", href: "/bizflow/customers.html" },
    { id: "inventory", key: "nav.inventory", icon: "icon-nav-inventory", href: "/bizflow/inventory.html", unreadKey: "inventory" },
    { id: "finance", key: "nav.finance", icon: "icon-nav-sales", href: "/bizflow/expense.html" },
    { id: "whatsapp", key: "nav.whatsapp", icon: "icon-nav-messenger", href: "/bizflow/whatsapp.html" },
    { id: "ocpp-monitor", key: "nav.ocppMonitor", icon: "icon-nav-remix", href: "/bizflow/ocpp-monitor.html", adminOnly: true },
    { id: "ocpp-charging", key: "nav.ocppCharging", icon: "icon-nav-cloud", href: "/bizflow/ocpp-charging.html", adminOnly: true },
    { id: "ocpp-users", key: "nav.ocppUsers", icon: "icon-nav-user", href: "/bizflow/ocpp-users.html", adminOnly: true },
    { id: "ocpp-finance", key: "nav.ocppFinance", icon: "icon-nav-sales", href: "/bizflow/ocpp-finance.html", adminOnly: true }
  ]),
  team: Object.freeze([
    { id: "tasks", key: "nav.tasks", icon: "icon-nav-task", href: "/team/index.html", unreadKey: "tasks" },
    { id: "team", key: "nav.team", icon: "icon-nav-user", href: "/team/members.html" }
  ])
});

export function routeMenuKey(pathname) {
  return routeMenuEntries[String(pathname || "")]?.menuKey ?? "";
}

export function createRouteMenu(pathname) {
  const currentRoute = routeMenuEntries[String(pathname || "")];
  if (!currentRoute) return [];
  return (sectionMenus[currentRoute.section] ?? []).map(({ id, ...item }) => ({
    ...item,
    active: id === currentRoute.menuKey
  }));
}
