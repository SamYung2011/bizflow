const items = [
  { key: "home", labelKey: "nav.home", icon: "icon-nav-home", href: "./home.html" },
  { key: "orders", labelKey: "nav.orders", icon: "icon-nav-list", href: "./orders.html", unreadKey: "orders" },
  { key: "customers", labelKey: "nav.customers", icon: "icon-nav-user", href: "./customers.html" },
  { key: "inventory", labelKey: "nav.inventory", icon: "icon-nav-inventory", href: "./inventory.html", unreadKey: "inventory" },
  { key: "finance", labelKey: "nav.finance", icon: "icon-nav-sales", href: "./expense.html" },
  { key: "whatsapp", labelKey: "nav.whatsapp", icon: "icon-nav-messenger", href: "./whatsapp.html" },
  { key: "ocpp-monitor", labelKey: "nav.ocppMonitor", icon: "icon-nav-remix", href: "./ocpp-monitor.html", adminOnly: true },
  { key: "ocpp-charging", labelKey: "nav.ocppCharging", icon: "icon-nav-cloud", href: "./ocpp-charging.html", adminOnly: true },
  { key: "ocpp-users", labelKey: "nav.ocppUsers", icon: "icon-nav-user", href: "./ocpp-users.html", adminOnly: true },
  { key: "ocpp-finance", labelKey: "nav.ocppFinance", icon: "icon-nav-sales", href: "./ocpp-finance.html", adminOnly: true }
];

export function createBizflowMenu(activeKey) {
  return items.map(({ key, labelKey, ...item }) => ({
    ...item,
    key: labelKey,
    active: key === activeKey
  }));
}
