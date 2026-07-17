// P6 completes all 16 routes and enables same-document Bizflow/Team navigation.
export const spaNavigation = true;
export const spaCrossSectionNavigation = true;
export const spaRouteAllowlist = Object.freeze([
  "/bizflow/home.html",
  "/bizflow/ocpp-monitor.html",
  "/bizflow/ocpp-charging.html",
  "/bizflow/ocpp-users.html",
  "/bizflow/ocpp-finance.html",
  "/bizflow/customers.html",
  "/bizflow/customer-detail.html",
  "/bizflow/orders.html",
  "/bizflow/orders-create.html",
  "/bizflow/orders-detail.html",
  "/bizflow/inventory.html",
  "/bizflow/inventory-detail.html",
  "/bizflow/expense.html",
  "/bizflow/whatsapp.html",
  "/team/index.html",
  "/team/members.html"
]);

const routeMenuKeys = Object.freeze({
  "/bizflow/home.html": "home",
  "/bizflow/orders.html": "orders",
  "/bizflow/orders-create.html": "orders",
  "/bizflow/orders-detail.html": "orders",
  "/bizflow/customers.html": "customers",
  "/bizflow/customer-detail.html": "customers",
  "/bizflow/inventory.html": "inventory",
  "/bizflow/inventory-detail.html": "inventory",
  "/bizflow/expense.html": "finance",
  "/bizflow/whatsapp.html": "whatsapp",
  "/bizflow/ocpp-monitor.html": "ocpp-monitor",
  "/bizflow/ocpp-charging.html": "ocpp-charging",
  "/bizflow/ocpp-users.html": "ocpp-users",
  "/bizflow/ocpp-finance.html": "ocpp-finance",
  "/team/index.html": "tasks",
  "/team/members.html": "team"
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

const fromHere = (path) => new URL(path, import.meta.url).href;

function route(path, section, entry, styles, load = null) {
  return Object.freeze({
    path,
    section,
    menuKey: routeMenuKeys[path] ?? "",
    entry: fromHere(entry),
    styles: Object.freeze(styles.map(fromHere)),
    load
  });
}

const routes = [
  route("/bizflow/home.html", "bizflow", "../bizflow/home.js", ["../bizflow/home.css"], () => import("../bizflow/home.js")),
  route("/bizflow/orders.html", "bizflow", "../bizflow/orders.js", [
    "../components/segment.css", "../components/date-filter.css", "../components/date-range-panel.css", "../components/management-list.css",
    "../bizflow/orders.css", "../bizflow/orders-domain.css"
  ], () => import("../bizflow/orders.js")),
  route("/bizflow/orders-create.html", "bizflow", "../bizflow/orders-create.js", [
    "../bizflow/customers.css", "../bizflow/orders.css"
  ], () => import("../bizflow/orders-create.js")),
  route("/bizflow/orders-detail.html", "bizflow", "../bizflow/orders-detail.js", [
    "../bizflow/customers.css", "../bizflow/orders.css"
  ], () => import("../bizflow/orders-detail.js")),
  route("/bizflow/customers.html", "bizflow", "../bizflow/customers.js", [
    "../components/segment.css", "../components/date-filter.css", "../components/date-range-panel.css", "../components/management-list.css",
    "../bizflow/customers.css", "../bizflow/customers-warranty.css"
  ], () => import("../bizflow/customers.js")),
  route("/bizflow/customer-detail.html", "bizflow", "../bizflow/customer-detail.js", [
    "../components/management-list.css", "../bizflow/customers.css", "../bizflow/orders.css"
  ], () => import("../bizflow/customer-detail.js")),
  route("/bizflow/inventory.html", "bizflow", "../bizflow/inventory.js", [
    "../components/segment.css", "../components/management-list.css",
    "../bizflow/inventory.css", "../bizflow/inventory-domain.css"
  ], () => import("../bizflow/inventory.js")),
  route("/bizflow/inventory-detail.html", "bizflow", "../bizflow/inventory-detail.js", [
    "../bizflow/customers.css", "../bizflow/inventory.css"
  ], () => import("../bizflow/inventory-detail.js")),
  route("/bizflow/expense.html", "bizflow", "../bizflow/expense.js", [
    "../components/segment.css", "../bizflow/expense.css"
  ], () => import("../bizflow/expense.js")),
  route("/bizflow/whatsapp.html", "bizflow", "../bizflow/whatsapp.js", [
    "../components/segment.css", "../components/date-filter.css", "../bizflow/whatsapp.css"
  ], () => import("../bizflow/whatsapp.js")),
  route("/bizflow/ocpp-monitor.html", "bizflow", "../bizflow/ocpp-monitor.js", [
    "../components/segment.css", "../components/date-filter.css", "../bizflow/ocpp.css"
  ], () => import("../bizflow/ocpp-monitor.js")),
  route("/bizflow/ocpp-charging.html", "bizflow", "../bizflow/ocpp-charging.js", [
    "../components/segment.css", "../components/date-filter.css", "../bizflow/ocpp.css"
  ], () => import("../bizflow/ocpp-charging.js")),
  route("/bizflow/ocpp-users.html", "bizflow", "../bizflow/ocpp-users.js", [
    "../components/segment.css", "../bizflow/ocpp.css"
  ], () => import("../bizflow/ocpp-users.js")),
  route("/bizflow/ocpp-finance.html", "bizflow", "../bizflow/ocpp-finance.js", [
    "../components/segment.css", "../bizflow/ocpp.css"
  ], () => import("../bizflow/ocpp-finance.js")),
  route("/team/index.html", "team", "../team/tasks.js", ["../team/tasks.css", "../team/tasks-domain.css"], () => import("../team/tasks.js")),
  route("/team/members.html", "team", "../team/members.js", ["../team/members.css", "../team/members-domain.css"], () => import("../team/members.js"))
];

export const routeManifest = Object.freeze(Object.fromEntries(routes.map((item) => [item.path, item])));

export function routeForPath(pathname) {
  return routeManifest[String(pathname || "")] ?? null;
}

export function createRouteMenu(pathname) {
  const currentRoute = routeForPath(pathname);
  if (!currentRoute) return [];
  return (sectionMenus[currentRoute.section] ?? []).map(({ id, ...item }) => ({
    ...item,
    active: id === currentRoute.menuKey
  }));
}
