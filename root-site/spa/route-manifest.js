// P1 enables the Home + OCPP sample. Remaining routes stay on their MPA entries.
export const spaNavigation = true;
export const spaCrossSectionNavigation = false;
export const spaRouteAllowlist = Object.freeze([
  "/bizflow/home.html",
  "/bizflow/ocpp-monitor.html",
  "/bizflow/ocpp-charging.html",
  "/bizflow/ocpp-users.html",
  "/bizflow/ocpp-finance.html"
]);

const fromHere = (path) => new URL(path, import.meta.url).href;

function route(path, section, entry, styles, load = null) {
  return Object.freeze({
    path,
    section,
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
  ]),
  route("/bizflow/orders-create.html", "bizflow", "../bizflow/orders-create.js", [
    "../bizflow/customers.css", "../bizflow/orders.css"
  ]),
  route("/bizflow/orders-detail.html", "bizflow", "../bizflow/orders-detail.js", [
    "../bizflow/customers.css", "../bizflow/orders.css"
  ]),
  route("/bizflow/customers.html", "bizflow", "../bizflow/customers.js", [
    "../components/segment.css", "../components/date-filter.css", "../components/date-range-panel.css", "../components/management-list.css",
    "../bizflow/customers.css", "../bizflow/customers-warranty.css"
  ]),
  route("/bizflow/customer-detail.html", "bizflow", "../bizflow/customer-detail.js", [
    "../components/management-list.css", "../bizflow/customers.css", "../bizflow/orders.css"
  ]),
  route("/bizflow/inventory.html", "bizflow", "../bizflow/inventory.js", [
    "../components/segment.css", "../components/management-list.css",
    "../bizflow/inventory.css", "../bizflow/inventory-domain.css"
  ]),
  route("/bizflow/inventory-detail.html", "bizflow", "../bizflow/inventory-detail.js", [
    "../bizflow/customers.css", "../bizflow/inventory.css"
  ]),
  route("/bizflow/expense.html", "bizflow", "../bizflow/expense.js", [
    "../components/segment.css", "../bizflow/expense.css"
  ]),
  route("/bizflow/whatsapp.html", "bizflow", "../bizflow/whatsapp.js", [
    "../components/segment.css", "../components/date-filter.css", "../bizflow/whatsapp.css"
  ]),
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
  route("/team/index.html", "team", "../team/tasks.js", ["../team/tasks.css", "../team/tasks-domain.css"]),
  route("/team/members.html", "team", "../team/members.js", ["../team/members.css", "../team/members-domain.css"])
];

export const routeManifest = Object.freeze(Object.fromEntries(routes.map((item) => [item.path, item])));

export function routeForPath(pathname) {
  return routeManifest[String(pathname || "")] ?? null;
}
