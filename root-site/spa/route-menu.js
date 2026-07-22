const skeleton = (kind, stats = 0) => Object.freeze({ kind, stats });

const routeMenuEntries = Object.freeze({
  "/bizflow/home.html": { section: "bizflow", menuKey: "home", title: "任務平台 Home Desktop", skeleton: skeleton("dashboard", 4) },
  "/bizflow/orders.html": { section: "bizflow", menuKey: "orders", title: "Honnmono · Orders", skeleton: skeleton("table") },
  "/bizflow/orders-create.html": { section: "bizflow", menuKey: "orders", title: "Honnmono · Create order", skeleton: skeleton("form") },
  "/bizflow/orders-detail.html": { section: "bizflow", menuKey: "orders", title: "Honnmono · Order", skeleton: skeleton("detail", 2) },
  "/bizflow/customers.html": { section: "bizflow", menuKey: "customers", title: "Honnmono · Customers", skeleton: skeleton("table") },
  "/bizflow/customer-detail.html": { section: "bizflow", menuKey: "customers", title: "Honnmono · Customer", skeleton: skeleton("detail", 2) },
  "/bizflow/inventory.html": { section: "bizflow", menuKey: "inventory", title: "Honnmono · Inventory", skeleton: skeleton("table") },
  "/bizflow/inventory-detail.html": { section: "bizflow", menuKey: "inventory", title: "Honnmono · Inventory", skeleton: skeleton("detail", 2) },
  "/bizflow/expense.html": { section: "bizflow", menuKey: "finance", title: "Honnmono · Finance", skeleton: skeleton("table") },
  "/bizflow/whatsapp.html": { section: "bizflow", menuKey: "whatsapp", title: "Honnmono · WhatsApp", skeleton: skeleton("console", 3) },
  "/bizflow/ocpp-monitor.html": { section: "bizflow", menuKey: "ocpp-monitor", title: "OCPP 監控", skeleton: skeleton("dashboard", 4) },
  "/bizflow/ocpp-charging.html": { section: "bizflow", menuKey: "ocpp-charging", title: "OCPP 充電站", skeleton: skeleton("dashboard", 4) },
  "/bizflow/ocpp-users.html": { section: "bizflow", menuKey: "ocpp-users", title: "OCPP 用戶", skeleton: skeleton("table") },
  "/bizflow/ocpp-finance.html": { section: "bizflow", menuKey: "ocpp-finance", title: "OCPP 財務", skeleton: skeleton("dashboard", 4) },
  "/team/index.html": { section: "team", menuKey: "tasks", title: "Honnmono · Tasks", skeleton: skeleton("board", 3) },
  "/team/members.html": { section: "team", menuKey: "team", title: "Honnmono · Team", skeleton: skeleton("dashboard", 4) }
});

const sectionMenus = Object.freeze({
  bizflow: Object.freeze([
    { id: "home", key: "nav.home", icon: "icon-nav-home", href: "/bizflow/home.html" },
    { id: "orders", key: "nav.orders", icon: "icon-nav-list", href: "/bizflow/orders.html", unreadKey: "orders" },
    { id: "customers", key: "nav.customers", icon: "icon-nav-user", href: "/bizflow/customers.html" },
    { id: "inventory", key: "nav.inventory", icon: "icon-nav-inventory", href: "/bizflow/inventory.html", unreadKey: "inventory" },
    { id: "finance", key: "nav.finance", icon: "icon-nav-sales", href: "/bizflow/expense.html" },
    { id: "tasks", key: "nav.tasks", icon: "icon-nav-task", href: "/team/index.html", unreadKey: "tasks" },
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

export function createRouteFrame(pathname) {
  const currentRoute = routeMenuEntries[String(pathname || "")];
  if (!currentRoute) return null;
  const activeItem = (sectionMenus[currentRoute.section] ?? [])
    .find((item) => item.id === currentRoute.menuKey);
  return Object.freeze({
    menu: Object.freeze(createRouteMenu(pathname).map((item) => Object.freeze(item))),
    title: currentRoute.title,
    skeleton: currentRoute.skeleton,
    access: activeItem?.adminOnly === true ? "bf-admin" : "default"
  });
}
