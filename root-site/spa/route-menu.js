import { SECTION_MENU_ITEMS } from "../components/navigation-registry.js";

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

export function routeMenuKey(pathname) {
  return routeMenuEntries[String(pathname || "")]?.menuKey ?? "";
}

export function createRouteMenu(pathname) {
  const currentRoute = routeMenuEntries[String(pathname || "")];
  if (!currentRoute) return [];
  return (SECTION_MENU_ITEMS[currentRoute.section] ?? []).map(({
    id,
    labelKey,
    icon,
    canonicalHref,
    unreadKey,
    adminOnly
  }) => ({
    key: labelKey,
    icon,
    href: canonicalHref,
    ...(unreadKey ? { unreadKey } : {}),
    ...(adminOnly === true ? { adminOnly: true } : {}),
    active: id === currentRoute.menuKey
  }));
}

export function createRouteFrame(pathname) {
  const currentRoute = routeMenuEntries[String(pathname || "")];
  if (!currentRoute) return null;
  const activeItem = (SECTION_MENU_ITEMS[currentRoute.section] ?? [])
    .find((item) => item.id === currentRoute.menuKey);
  return Object.freeze({
    menu: Object.freeze(createRouteMenu(pathname).map((item) => Object.freeze(item))),
    title: currentRoute.title,
    skeleton: currentRoute.skeleton,
    access: activeItem?.adminOnly === true ? "bf-admin" : "default"
  });
}
