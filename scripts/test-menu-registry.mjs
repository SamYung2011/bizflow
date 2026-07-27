import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createBizflowMenu } from "../root-site/components/bizflow-menu.js";
import { SECTION_MENU_ITEMS } from "../root-site/components/navigation-registry.js";
import { createRouteMenu } from "../root-site/spa/route-menu.js";
import { routeManifest } from "../root-site/spa/route-manifest.js";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const expectedRegistry = {
  bizflow: [
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
    { id: "app-feedback", labelKey: "nav.appFeedback", icon: "icon-nav-messenger", canonicalHref: "/bizflow/app-feedback.html", adminOnly: true }
  ],
  team: [
    { id: "tasks", labelKey: "nav.tasks", icon: "icon-nav-task", canonicalHref: "/team/index.html", unreadKey: "tasks" },
    { id: "team", labelKey: "nav.team", icon: "icon-nav-user", canonicalHref: "/team/members.html" }
  ]
};

assert.deepEqual(SECTION_MENU_ITEMS, expectedRegistry,
  "the registry must lock every menu field, not only item ids");
assert.equal(Object.isFrozen(SECTION_MENU_ITEMS), true);

for (const [section, items] of Object.entries(SECTION_MENU_ITEMS)) {
  assert.equal(Object.isFrozen(items), true, `${section} menu list must be immutable`);
  assert.ok(items.every(Object.isFrozen), `${section} menu entries must be immutable`);
  assert.equal(new Set(items.map((item) => item.id)).size, items.length,
    `${section} menu ids must be unique`);
  assert.equal(new Set(items.map((item) => item.canonicalHref)).size, items.length,
    `${section} canonical hrefs must be unique`);
}

for (const route of Object.values(routeManifest)) {
  assert.ok(
    SECTION_MENU_ITEMS[route.section]?.some((item) => item.id === route.menuKey),
    `${route.path} menuKey must exist in its ${route.section} registry`
  );
  assert.deepEqual(
    route.frame.menu,
    expectedRouteMenu(route.section, route.menuKey),
    `${route.path} frame must adapt the registry for its declared section`
  );
}

const ocppItems = SECTION_MENU_ITEMS.bizflow.filter((item) => item.id.startsWith("ocpp-"));
assert.deepEqual(
  ocppItems.map(({ id, adminOnly }) => ({ id, adminOnly })),
  [
    { id: "ocpp-monitor", adminOnly: true },
    { id: "ocpp-charging", adminOnly: true },
    { id: "ocpp-users", adminOnly: true },
    { id: "ocpp-finance", adminOnly: true }
  ],
  "all four OCPP destinations must retain the administrator gate"
);
assert.equal(
  SECTION_MENU_ITEMS.bizflow.find((item) => item.id === "app-feedback")?.adminOnly,
  true,
  "Honnmono APP feedback must retain the administrator gate"
);
assert.equal(SECTION_MENU_ITEMS.bizflow.find((item) => item.id === "orders")?.unreadKey, "orders");
assert.equal(SECTION_MENU_ITEMS.bizflow.find((item) => item.id === "inventory")?.unreadKey, "inventory");
assert.equal(SECTION_MENU_ITEMS.bizflow.find((item) => item.id === "tasks")?.unreadKey, "tasks");
assert.equal(SECTION_MENU_ITEMS.team.find((item) => item.id === "tasks")?.unreadKey, "tasks");

function expectedRouteMenu(section, activeId) {
  return expectedRegistry[section].map((item) => ({
    key: item.labelKey,
    icon: item.icon,
    href: item.canonicalHref,
    ...(item.unreadKey ? { unreadKey: item.unreadKey } : {}),
    ...(item.adminOnly === true ? { adminOnly: true } : {}),
    active: item.id === activeId
  }));
}

function expectedBizflowMenu(activeId) {
  return expectedRegistry.bizflow.map((item) => ({
    icon: item.icon,
    href: item.canonicalHref.startsWith("/bizflow/")
      ? `.${item.canonicalHref.slice("/bizflow".length)}`
      : `..${item.canonicalHref}`,
    ...(item.unreadKey ? { unreadKey: item.unreadKey } : {}),
    ...(item.adminOnly === true ? { adminOnly: true } : {}),
    key: item.labelKey,
    active: item.id === activeId
  }));
}

assert.deepEqual(
  createRouteMenu("/bizflow/orders-detail.html"),
  expectedRouteMenu("bizflow", "orders"),
  "the SPA adapter must emit canonical hrefs and the owning active item"
);
assert.deepEqual(
  createRouteMenu("/team/members.html"),
  expectedRouteMenu("team", "team"),
  "the Team SPA adapter must retain its two canonical routes"
);
assert.deepEqual(
  createBizflowMenu("orders"),
  expectedBizflowMenu("orders"),
  "the Bizflow page adapter must retain relative hrefs, metadata and active semantics"
);

const [bizflowSource, routeSource, maintenanceDoc] = await Promise.all([
  read("root-site/components/bizflow-menu.js"),
  read("root-site/spa/route-menu.js"),
  read("docs/navigation-shell-maintenance.md")
]);
assert.match(bizflowSource, /import \{ SECTION_MENU_ITEMS \} from "\.\/navigation-registry\.js"/);
assert.match(routeSource, /import \{ SECTION_MENU_ITEMS \} from "\.\.\/components\/navigation-registry\.js"/);
assert.doesNotMatch(bizflowSource, /const\s+items\s*=/,
  "the Bizflow adapter must not retain a local menu list");
assert.doesNotMatch(routeSource, /const\s+sectionMenus\s*=/,
  "the SPA adapter must not retain a local section menu list");
assert.doesNotMatch(bizflowSource, /"nav\.home"/,
  "the Bizflow adapter must not duplicate registry labels under another local variable");
assert.doesNotMatch(routeSource, /"nav\.home"/,
  "the SPA adapter must not duplicate registry labels under another local variable");
assert.match(maintenanceDoc, /root-site\/components\/navigation-registry\.js[\s\S]*唯一手写源/,
  "maintenance docs must name the navigation registry as the only handwritten menu source");
assert.match(maintenanceDoc, /root-site\/components\/menus\.js[\s\S]*唯一手写源/,
  "maintenance docs must name menus.js as the only handwritten user-panel source");
assert.match(maintenanceDoc, /npm run build:shell[\s\S]*npm run check:shell/,
  "maintenance docs must record the generated-bundle workflow");

console.log("MENU-unify-1 registry contracts: PASS (full fields, uniqueness, route coverage, gates, unread, adapters)");
