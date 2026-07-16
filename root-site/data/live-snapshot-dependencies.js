export const LIVE_SNAPSHOT_INVALIDATED_EVENT = "tp:live-snapshot-invalidated";
export const LIVE_SNAPSHOT_UPDATED_EVENT = "tp:live-snapshot-updated";

const SNAPSHOT_TABLES = Object.freeze({
  "home.json": [
    "invoices", "customers", "employees", "shipment_events", "customer_devices", "products",
    "employee_tasks", "task_assignees", "employee_task_feedbacks", "departments",
    "employee_departments", "employee_companies", "roles", "task_pending",
    "company_join_pending", "warehouses", "inventory_stock"
  ],
  "tasks.json": [
    "employee_tasks", "employees", "task_assignees", "employee_task_feedbacks",
    "departments", "employee_departments"
  ],
  "team-extras.json": [
    "team_update_logs", "team_update_log_comments", "employees", "companies",
    "employee_companies", "company_join_pending"
  ],
  "team-update-logs.json": ["team_update_logs", "team_update_log_comments", "employees"],
  "members.json": [
    "employees", "employee_companies", "departments", "employee_departments", "roles",
    "employee_tasks", "task_assignees", "task_pending", "company_join_pending"
  ],
  "customers.json": ["customers", "invoices", "customer_devices"],
  "warranty.json": ["customers", "invoices", "customer_devices", "products"],
  "orders.json": ["invoices", "customers", "employees", "shipment_events"],
  "home-order-metrics.json": ["invoices", "customers", "employees", "shipment_events"],
  "inventory.json": ["products", "warehouses", "inventory_stock"],
  "northbound.json": ["northbound_records", "northbound_statuses"],
  "charger-leads.json": ["charger_leads"],
  "aliases.json": ["line_item_aliases", "products"],
  "shopify-links.json": ["shopify_variant_links", "products"],
  "suppliers.json": ["suppliers"],
  "expense.json": ["expense_reimbursements"],
  "whatsapp.json": [
    "wa_settings", "wa_whitelist", "wa_clients", "wa_heartbeat", "wa_messages", "wa_replies",
    "wa_unresolved", "wa_daily_reports", "wa_logs"
  ],
  "pending-deduction.json": ["invoices", "customers", "inventory_movements"]
});

const TABLE_SNAPSHOTS = new Map();
Object.entries(SNAPSHOT_TABLES).forEach(([snapshot, tables]) => {
  tables.forEach((table) => {
    const snapshots = TABLE_SNAPSHOTS.get(table) ?? new Set();
    snapshots.add(snapshot);
    TABLE_SNAPSHOTS.set(table, snapshots);
  });
});

export function snapshotsForTables(tables) {
  const snapshots = new Set();
  [...tables].forEach((table) => {
    TABLE_SNAPSHOTS.get(String(table || ""))?.forEach((snapshot) => snapshots.add(snapshot));
  });
  return snapshots;
}
