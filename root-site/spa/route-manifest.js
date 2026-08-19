// P6 completed the original 16 routes; Honnmono APP feedback extends the live SPA to 17.
import { createRouteFrame, routeMenuKey } from "./route-menu.js";
import { rootSiteUrl } from "../components/root-site-url.js";

export { createRouteFrame, createRouteMenu } from "./route-menu.js";

export const spaNavigation = true;
export const spaCrossSectionNavigation = true;
export const spaRouteAllowlist = Object.freeze([
  "/bizflow/home.html",
  "/bizflow/ocpp-monitor.html",
  "/bizflow/ocpp-charging.html",
  "/bizflow/ocpp-users.html",
  "/bizflow/ocpp-finance.html",
  "/bizflow/app-feedback.html",
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

const fromHere = (path) => rootSiteUrl(String(path || "").replace(/^\.\.\//, "")).href;

function route(path, section, entry, styles, load = null) {
  return Object.freeze({
    path,
    section,
    menuKey: routeMenuKey(path),
    frame: createRouteFrame(path),
    entry: fromHere(entry),
    styles: Object.freeze(styles.map(fromHere)),
    load
  });
}

const routes = [
  route("/bizflow/home.html", "bizflow", "../bizflow/home.js", ["../bizflow/home.css"], () => import("../bizflow/home.js")),
  route("/bizflow/orders.html", "bizflow", "../bizflow/orders.js", [
    "../components/segment.css", "../components/date-range-panel.css", "../components/management-list.css",
    "../bizflow/orders.css", "../bizflow/orders-domain.css"
  ], () => import("../bizflow/orders.js")),
  route("/bizflow/orders-create.html", "bizflow", "../bizflow/orders-create.js", [
    "../components/segment.css",
    "../bizflow/customers.css", "../bizflow/orders.css"
  ], () => import("../bizflow/orders-create.js")),
  route("/bizflow/orders-detail.html", "bizflow", "../bizflow/orders-detail.js", [
    "../components/segment.css",
    "../bizflow/customers.css", "../bizflow/orders.css"
  ], () => import("../bizflow/orders-detail.js")),
  route("/bizflow/customers.html", "bizflow", "../bizflow/customers.js", [
    "../components/segment.css", "../components/date-range-panel.css", "../components/management-list.css",
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
    "../components/segment.css", "../components/date-range-panel.css", "../bizflow/expense.css"
  ], () => import("../bizflow/expense.js")),
  route("/bizflow/whatsapp.html", "bizflow", "../bizflow/whatsapp.js", [
    "../components/segment.css", "../components/date-range-panel.css", "../bizflow/whatsapp.css"
  ], () => import("../bizflow/whatsapp.js")),
  route("/bizflow/ocpp-monitor.html", "bizflow", "../bizflow/ocpp-monitor.js", [
    "../components/segment.css", "../components/date-range-panel.css", "../bizflow/ocpp.css"
  ], () => import("../bizflow/ocpp-monitor.js")),
  route("/bizflow/ocpp-charging.html", "bizflow", "../bizflow/ocpp-charging.js", [
    "../components/segment.css", "../components/date-range-panel.css", "../bizflow/ocpp.css"
  ], () => import("../bizflow/ocpp-charging.js")),
  route("/bizflow/ocpp-users.html", "bizflow", "../bizflow/ocpp-users.js", [
    "../components/segment.css", "../bizflow/ocpp.css"
  ], () => import("../bizflow/ocpp-users.js")),
  route("/bizflow/ocpp-finance.html", "bizflow", "../bizflow/ocpp-finance.js", [
    "../components/segment.css", "../bizflow/ocpp.css"
  ], () => import("../bizflow/ocpp-finance.js")),
  route("/bizflow/app-feedback.html", "bizflow", "../bizflow/app-feedback.js", [
    "../components/date-range-panel.css",
    "../bizflow/app-feedback.css"
  ], () => import("../bizflow/app-feedback.js")),
  route("/team/index.html", "team", "../team/tasks.js", ["../components/date-range-panel.css", "../team/tasks.css", "../team/tasks-domain.css"], () => import("../team/tasks.js")),
  route("/team/members.html", "team", "../team/members.js", ["../team/members.css", "../team/members-domain.css"], () => import("../team/members.js"))
];

export const routeManifest = Object.freeze(Object.fromEntries(routes.map((item) => [item.path, item])));

export function routeForPath(pathname) {
  return routeManifest[String(pathname || "")] ?? null;
}
