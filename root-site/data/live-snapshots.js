import { getCurrentUser, RBAC_KEYS } from "./auth.js";
import {
  buildAliasesSnapshot,
  buildNorthboundSnapshot,
  buildShopifyLinksSnapshot,
  buildSimpleRowsSnapshot,
  buildWhatsappSnapshot
} from "./live-admin-snapshots.js";
import { buildInventorySnapshot } from "./live-inventory-snapshot.js";
import { buildCustomerGroups } from "./customer-groups.js";
import { customerSourceFromInvoices } from "./customer-source.js";
import {
  allRows,
  asArray,
  asNumber,
  asText,
  dateParts,
  ensureLiveSession,
  formatDate,
  formatDateTime,
  formatMonthDay,
  formatTime,
  timestamp
} from "./live-snapshot-utils.js";

export const LIVE_SNAPSHOT_MISS = Symbol("live-snapshot-miss");

const LIVE_BUILDERS = new Map();
let snapshotUserId = "";

function dedupeInvoices(rows) {
  const selected = new Map();
  for (const row of rows) {
    if (!Array.isArray(row.items) || !row.date) continue;
    const key = row.invoice_number == null ? row.id : String(row.invoice_number);
    const existing = selected.get(key);
    if (!existing || timestamp(row.created_at) < timestamp(existing.created_at)) selected.set(key, row);
  }
  return [...selected.values()].sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at));
}

function invoiceNumber(invoice) {
  return `#${invoice.invoice_number ?? asText(invoice.id).slice(0, 8)}`;
}

function invoiceChannel(invoice) {
  const notes = asText(invoice.notes);
  if (notes.includes("__FORMS_BUY__")) return "Framer";
  if (notes.includes("__BROADWAY__")) return "Broadway";
  return invoice.invoice_number != null ? "Online Store" : "Manual";
}

function normalizedInvoiceItems(invoice) {
  return asArray(invoice.items).map((item) => ({
    ...item,
    name: asText(item?.name),
    qty: asNumber(item?.qty, 1),
    price: asNumber(item?.price)
  }));
}

function isFeeItem(name, kind) {
  const patterns = {
    shipping: /運費|郵費|shipping|freight/i,
    deposit: /押金|deposit/i,
    discount: /優惠|折扣|discount/i,
    service: /手續費|service/i
  };
  return patterns[kind].test(name);
}

function productItems(invoice) {
  return normalizedInvoiceItems(invoice).filter((item) =>
    item.name && !["shipping", "deposit", "discount", "service"].some((kind) => isFeeItem(item.name, kind)));
}

function invoiceFees(invoice) {
  const items = normalizedInvoiceItems(invoice);
  return Object.fromEntries(["deposit", "service", "discount", "shipping"].map((kind) => [
    kind,
    items.filter((item) => isFeeItem(item.name, kind)).reduce((sum, item) => sum + item.price, 0)
  ]));
}

async function orderSourceData() {
  const [invoices, customers, employees, events] = await Promise.all([
    allRows("invoices", "date", false),
    allRows("customers", "name"),
    allRows("employees", "created_at"),
    allRows("shipment_events", "event_at", false)
  ]);
  const customerById = new Map(customers.map((row) => [row.id, row]));
  const employeeById = new Map(employees.map((row) => [row.id, row]));
  const eventsByInvoice = new Map();
  for (const event of events) {
    const list = eventsByInvoice.get(event.invoice_id) ?? [];
    list.push(event);
    eventsByInvoice.set(event.invoice_id, list);
  }
  return { invoices: dedupeInvoices(invoices), customerById, employeeById, eventsByInvoice };
}

function buildOrderRow(invoice, sources) {
  const customer = sources.customerById.get(invoice.customer_id) ?? {};
  const items = productItems(invoice);
  const firstItem = items[0] ?? { name: "—", qty: 1 };
  const carModel = `${asText(customer.car_make)} ${asText(customer.car_model)}`.trim() || null;
  const timeline = (sources.eventsByInvoice.get(invoice.id) ?? [])
    .sort((a, b) => timestamp(b.event_at) - timestamp(a.event_at))
    .slice(0, 6)
    .map((event) => ({
      label: asText(event.description).split("：")[0],
      time: formatDateTime(event.event_at)
    }));
  return {
    id: invoice.id,
    customerId: invoice.customer_id ?? null,
    status: invoice.status === "Paid" ? "completed" : "in-progress",
    customer: asText(customer.name, "—"),
    phone: asText(customer.phone),
    channel: invoiceChannel(invoice),
    product: firstItem.name,
    qty: `×${firstItem.qty}`,
    date: formatDate(invoice.date),
    amount: `HKD$ ${asNumber(invoice.total)}`,
    detail: {
      orderNo: invoiceNumber(invoice),
      time: formatTime(invoice.created_at),
      shippingStatus: asText(invoice.shipping_status, "unshipped") || "unshipped",
      shippedAt: formatDateTime(invoice.shipped_at),
      carrier: asText(invoice.carrier),
      trackingNo: asText(invoice.tracking_number),
      salesperson: asText(sources.employeeById.get(invoice.salesperson_id)?.name),
      salespersonId: invoice.salesperson_id ?? null,
      customerId: invoice.customer_id ?? null,
      paymentTotal: asNumber(invoice.total),
      email: asText(customer.email),
      carModel,
      carMake: asText(customer.car_make),
      carModelValue: asText(customer.car_model),
      shippingAddress: asText(customer.address),
      items: items.map((item, index) => ({
        id: item.id ?? `${invoice.id}:item:${index}`,
        name: item.name,
        quantity: item.qty,
        price: item.price,
        productId: item.product_id ?? null,
        warehouseId: item.warehouse_id ?? null,
        warrantyMonths: item.warranty_months ?? null,
        imeiCode: asText(item.imei_code)
      })),
      fees: invoiceFees(invoice),
      timeline
    }
  };
}

async function buildOrdersSnapshot() {
  const source = await orderSourceData();
  const orders = source.invoices.map((invoice) => buildOrderRow(invoice, source));
  const dates = orders.map((order) => order.date).filter(Boolean).sort();
  return {
    generated_at: new Date().toISOString(),
    scope: "RLS-visible production invoices",
    orders,
    dateRange: { from: dates[0] ?? "", to: dates.at(-1) ?? "" },
    sources: [...new Set(orders.map((order) => order.channel))]
  };
}

function customerOrder(invoice) {
  const item = normalizedInvoiceItems(invoice)[0] ?? {};
  return {
    no: invoiceNumber(invoice),
    status: invoice.status === "Paid" ? "paid" : "unpaid",
    shippingStatus: asText(invoice.shipping_status, "unshipped") || "unshipped",
    source: invoiceChannel(invoice),
    productName: asText(item.name, "—"),
    quantity: asNumber(item.qty, 1),
    price: asNumber(invoice.total),
    date: formatDate(invoice.date)
  };
}

async function customerSourceData() {
  const [customers, invoices, devices] = await Promise.all([
    allRows("customers", "name"),
    allRows("invoices", "date", false),
    allRows("customer_devices", "created_at", false)
  ]);
  // Mirrors bizflow_samyung/src/context/AppContext.jsx:168-352.
  const customerGroups = buildCustomerGroups(customers);
  const roots = customerGroups.groups.map((group) => ({
    ...group.primary,
    id: group.id,
    groupCids: group.allCids.slice(),
    hasEmail: group.allEmails.length > 0,
    hasPhone: group.allPhones.length > 0,
    name: asText(group.primary.name) || group.allNames[0] || "",
    phone: asText(group.primary.phone) || group.allPhones[0] || "",
    phone_mainland: group.allPhoneMainlands.join("\n") || asText(group.primary.phone_mainland),
    email: asText(group.primary.email) || group.allEmails[0] || "",
    address: asText(group.primary.address) || group.allAddresses[0] || "",
    car_make: group.allCarMakes.join("\n") || asText(group.primary.car_make),
    car_model: group.allCarModels.join("\n") || asText(group.primary.car_model),
    created_at: group.createdAt
  }));
  const invoicesByRoot = new Map();
  for (const invoice of dedupeInvoices(invoices)) {
    const rootId = customerGroups.idToGroup.get(invoice.customer_id);
    if (!rootId) continue;
    const list = invoicesByRoot.get(rootId) ?? [];
    list.push(invoice);
    invoicesByRoot.set(rootId, list);
  }
  const latestDeviceByRoot = new Map();
  for (const device of devices) {
    const rootId = customerGroups.idToGroup.get(device.customer_id);
    if (rootId && !latestDeviceByRoot.has(rootId)) latestDeviceByRoot.set(rootId, device);
  }
  return { roots, invoicesByRoot, latestDeviceByRoot };
}

async function buildCustomersSnapshot() {
  const source = await customerSourceData();
  const customers = source.roots.map((customer) => {
    const invoices = (source.invoicesByRoot.get(customer.id) ?? []).sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at));
    const oldest = invoices.at(-1);
    const newest = invoices[0];
    const totalAmount = invoices.reduce((sum, invoice) => sum + asNumber(invoice.total), 0);
    const orders = invoices.map(customerOrder);
    return {
      id: customer.id,
      groupCids: customer.groupCids.slice(),
      name: asText(customer.name, "—"),
      phone: asText(customer.phone),
      source: customerSourceFromInvoices(invoices),
      joinedAt: formatDate(customer.created_at, { compact: true }),
      imei: asText(source.latestDeviceByRoot.get(customer.id)?.imei),
      hasEmail: customer.hasEmail,
      hasPhone: customer.hasPhone,
      hasImei: Boolean(asText(source.latestDeviceByRoot.get(customer.id)?.imei)),
      orderCount: invoices.length,
      detail: {
        totalAmount,
        firstOrderDate: formatDate(oldest?.date),
        email: asText(customer.email),
        carModel: `${asText(customer.car_make)} ${asText(customer.car_model)}`.trim() || null,
        shippingAddress: asText(customer.address),
        order: newest ? customerOrder(newest) : null,
        orders
      },
      _lastAt: timestamp(newest?.created_at),
      _createdAt: timestamp(customer.created_at)
    };
  }).sort((a, b) => b._lastAt - a._lastAt || b._createdAt - a._createdAt)
    .map(({ _lastAt, _createdAt, ...customer }) => customer);
  return { generated_at: new Date().toISOString(), scope: "RLS-visible production customers", customers };
}

function addMonths(dateValue, months) {
  const parts = dateParts(dateValue);
  if (!parts || !Number.isFinite(months)) return "";
  const year = Number(parts.year);
  const monthIndex = Number(parts.month) - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(Number(parts.day), lastDay);
  return `${targetYear}/${String(targetMonth + 1).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function isWarrantyItem(name) {
  return name && !/運費|郵費|shipping|freight|防水盒|防水袋|押金|手續費/i.test(name);
}

async function buildWarrantySnapshot() {
  const [customerSource, products] = await Promise.all([customerSourceData(), allRows("products", "name")]);
  const customerById = new Map(customerSource.roots.map((customer) => [customer.id, customer]));
  const productWarranty = new Map();
  for (const product of products) {
    if (product.warranty_months != null) productWarranty.set(asText(product.name), asNumber(product.warranty_months));
  }
  const items = [];
  const todayParts = dateParts(new Date());
  const today = new Date(Date.UTC(Number(todayParts.year), Number(todayParts.month) - 1, Number(todayParts.day)));
  const lower = new Date(today); lower.setUTCDate(lower.getUTCDate() - 30);
  const upper = new Date(today); upper.setUTCDate(upper.getUTCDate() + 365);
  for (const [rootId, invoices] of customerSource.invoicesByRoot) {
    // Mirrors bizflow_samyung/src/context/AppContext.jsx:429-447: warranties require a live customer.
    const customer = customerById.get(rootId);
    if (!customer) continue;
    for (const invoice of invoices) {
      for (const item of normalizedInvoiceItems(invoice)) {
        if (!isWarrantyItem(item.name)) continue;
        const normalizedName = item.name.replace(/ - Default Title$/i, "");
        const months = asNumber(item.warranty_months, productWarranty.get(item.name) ?? productWarranty.get(normalizedName) ?? 0);
        if (months <= 0) continue;
        const expiry = addMonths(invoice.date, months);
        const expiryTime = Date.parse(expiry.replaceAll("/", "-") + "T00:00:00Z");
        if (expiryTime < lower.getTime() || expiryTime > upper.getTime()) continue;
        items.push({
          no: invoiceNumber(invoice),
          product: item.name,
          customer: asText(customer.name, "—"),
          customerId: rootId,
          phone: asText(customer.phone),
          purchaseDate: formatDate(invoice.date),
          expiry,
          warrantyMonths: months
        });
      }
    }
  }
  items.sort((a, b) => a.expiry.localeCompare(b.expiry));
  return { generated_at: new Date().toISOString(), scope: "RLS-visible production warranties", items };
}

async function buildTasksSnapshot() {
  const currentUser = await getCurrentUser();
  const companyId = currentUser?.activeCompanyId;
  const [allTasks, employees, assignees, feedbacks, departments] = await Promise.all([
    allRows("employee_tasks", "created_at", false),
    allRows("employees", "created_at"),
    allRows("task_assignees", "created_at", true, null),
    allRows("employee_task_feedbacks", "created_at"),
    allRows("departments", "name")
  ]);
  const tasks = companyId ? allTasks.filter((task) => task.company_id === companyId) : allTasks;
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  const assigneesByTask = new Map();
  for (const assignee of assignees) {
    const list = assigneesByTask.get(assignee.task_id) ?? [];
    list.push(assignee);
    assigneesByTask.set(assignee.task_id, list);
  }
  const feedbackByTask = new Map();
  for (const feedback of feedbacks) {
    const list = feedbackByTask.get(feedback.task_id) ?? [];
    list.push(feedback);
    feedbackByTask.set(feedback.task_id, list);
  }
  const normalized = tasks.map((task) => {
    const taskAssignees = assigneesByTask.get(task.id) ?? [];
    const taskFeedback = feedbackByTask.get(task.id) ?? [];
    const creatorId = task.creator_employee_id || task.employee_id || "";
    return {
      id: String(task.id),
      title: asText(task.title),
      note: asText(task.note),
      status: ["open", "done", "abandoned"].includes(task.status) ? task.status : "open",
      priority: ["high", "mid", "low", "none"].includes(task.priority) ? task.priority : "none",
      due: formatDate(task.due_date),
      startDate: formatDate(task.start_date) || null,
      createdAt: formatDateTime(task.created_at),
      completedAt: formatDateTime(task.completed_at) || null,
      creator: asText(employeeById.get(creatorId)?.name, "—"),
      creatorId: asText(creatorId),
      parentId: task.parent_task_id ?? null,
      needsApproval: task.needs_approval === true,
      approvedAt: formatDateTime(task.approved_at) || null,
      approvedBy: asText(employeeById.get(task.approved_by)?.name) || null,
      visibility: task.department_id
        ? { scope: "department", department: asText(departmentById.get(task.department_id)?.name) || null }
        : { scope: "team", department: null },
      attachmentCount: asArray(task.attachments).length,
      assignees: taskAssignees.map((assignee) => ({
        employeeId: asText(assignee.employee_id),
        name: asText(employeeById.get(assignee.employee_id)?.name, "—"),
        completedAt: formatDateTime(assignee.completed_at) || null,
        abandonedAt: formatDateTime(assignee.abandoned_at) || null
      })),
      feedback: taskFeedback.map((feedback) => ({
        id: String(feedback.id),
        author: asText(feedback.author_name, "—"),
        authorUserId: feedback.author_user_id ?? null,
        time: formatDateTime(feedback.created_at),
        body: asText(feedback.body),
        parentId: feedback.parent_feedback_id ?? null,
        attachmentCount: asArray(feedback.attachments).length
      }))
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = normalized.filter((task) => task.status === "open");
  const priorityKey = (priority) => priority === "mid" ? "medium" : priority === "none" ? "low" : priority;
  const kanban = { high: [], medium: [], low: [] };
  for (const task of open) {
    const key = priorityKey(task.priority);
    if (kanban[key].length >= 5) continue;
    kanban[key].push({
      title: task.title,
      due: task.due || formatDate(task.createdAt),
      assignee: task.assignees.map((assignee) => assignee.name).join("、") || "—",
      count: task.feedback.length
    });
  }
  return {
    generated_at: new Date().toISOString(),
    scope: currentUser?.activeCompany?.name || "RLS-visible company",
    taskStats: {
      total: normalized.length,
      completed: normalized.filter((task) => task.status === "done").length,
      open: open.length,
      abandoned: normalized.filter((task) => task.status === "abandoned").length
    },
    kanbanCounts: {
      high: open.filter((task) => task.priority === "high").length,
      medium: open.filter((task) => task.priority === "mid").length,
      low: open.filter((task) => task.priority === "low" || task.priority === "none").length
    },
    kanban,
    tasks: normalized,
    priorityRule: "none→low"
  };
}

async function memberSourceData() {
  const currentUser = await getCurrentUser();
  const companyId = currentUser?.activeCompanyId;
  const [employees, bindings, departments, employeeDepartments, roles, tasks, assignees, pending, joinPending] = await Promise.all([
    allRows("employees", "created_at"),
    allRows("employee_companies", "joined_at"),
    allRows("departments", "name"),
    allRows("employee_departments", "created_at", true, null),
    allRows("roles", "name"),
    allRows("employee_tasks", "created_at", false),
    allRows("task_assignees", "created_at", true, null),
    allRows("task_pending", "requested_at", false),
    allRows("company_join_pending", "requested_at", false)
  ]);
  const companyBindings = companyId ? bindings.filter((binding) => binding.company_id === companyId) : bindings;
  const memberIds = new Set(companyBindings.map((binding) => binding.employee_id));
  const members = employees.filter((employee) => memberIds.has(employee.id) && employee.kind === "employee");
  return {
    currentUser,
    companyId,
    employees,
    members,
    bindings: companyBindings,
    departments: companyId ? departments.filter((department) => department.company_id === companyId) : departments,
    employeeDepartments,
    roles: companyId ? roles.filter((role) => role.company_id === companyId) : roles,
    tasks: companyId ? tasks.filter((task) => task.company_id === companyId) : tasks,
    assignees,
    pending,
    joinPending
  };
}

async function buildMembersSnapshot() {
  const source = await memberSourceData();
  const employeeById = new Map(source.employees.map((employee) => [employee.id, employee]));
  const roleById = new Map(source.roles.map((role) => [role.id, role]));
  const bindingByEmployee = new Map(source.bindings.map((binding) => [binding.employee_id, binding]));
  const departmentsByEmployee = new Map();
  for (const row of source.employeeDepartments) {
    const department = source.departments.find((item) => item.id === row.department_id);
    if (!department) continue;
    const list = departmentsByEmployee.get(row.employee_id) ?? [];
    list.push(department.name);
    departmentsByEmployee.set(row.employee_id, list);
  }
  const taskById = new Map(source.tasks.map((task) => [task.id, task]));
  const assignedTasks = new Map();
  for (const assignee of source.assignees) {
    if (assignee.abandoned_at || !taskById.has(assignee.task_id)) continue;
    const list = assignedTasks.get(assignee.employee_id) ?? [];
    list.push(taskById.get(assignee.task_id));
    assignedTasks.set(assignee.employee_id, list);
  }
  const members = source.members.map((employee) => {
    const binding = bindingByEmployee.get(employee.id);
    const tasks = assignedTasks.get(employee.id) ?? [];
    const mapTask = (task) => ({ id: task.id, title: asText(task.title), due: formatDate(task.due_date) });
    return {
      id: employee.id,
      name: asText(employee.name),
      email: asText(employee.email),
      phone: asText(employee.phone),
      position: asText(employee.role),
      roleName: asText(roleById.get(binding?.role_id)?.name),
      isCompanyAdmin: binding?.is_company_admin === true,
      isAdmin: employee.is_admin === true,
      isSuperAdmin: employee.is_super_admin === true,
      status: employee.active === false ? "departed" : "active",
      deactivatedAt: formatDate(employee.deactivated_at) || null,
      joinedAt: formatDate(employee.created_at),
      departments: (departmentsByEmployee.get(employee.id) ?? []).sort(),
      bizflowMainAccess: employee.bizflow_main_access === true,
      canViewRevenue: employee.can_view_revenue === true,
      canShip: employee.can_ship === true,
      openTasks: tasks.filter((task) => task.status === "open").length,
      tasks: {
        tasking: tasks.filter((task) => task.status === "open").sort((a, b) => asText(a.due_date).localeCompare(asText(b.due_date))).map(mapTask),
        tasked: tasks.filter((task) => task.status === "done").sort((a, b) => timestamp(b.completed_at) - timestamp(a.completed_at)).map(mapTask)
      }
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const reviewRow = (row) => ({
    id: row.id,
    name: asText(row.name),
    email: asText(row.email),
    companyName: asText(row.company_name),
    note: asText(row.note),
    appliedAt: formatDate(row.requested_at),
    reviewedAt: formatDate(row.reviewed_at),
    approved: row.approved,
    rejectReason: asText(row.reject_reason)
  });
  return {
    generated_at: new Date().toISOString(),
    scope: source.currentUser?.activeCompany?.name || "RLS-visible company",
    membersStats: {
      all: members.length,
      active: members.filter((member) => member.status === "active").length,
      pendingReview: source.pending.filter((row) => row.reviewed_at == null).length,
      left: members.filter((member) => member.status === "departed").length
    },
    members,
    departments: source.departments.map((department) => ({
      id: department.id,
      name: asText(department.name),
      manager: null,
      memberIds: source.employeeDepartments.filter((row) => row.department_id === department.id && employeeById.has(row.employee_id)).map((row) => row.employee_id)
    })),
    roles: source.roles.map((role) => ({
      id: role.id,
      name: asText(role.name),
      permissions: Object.fromEntries(RBAC_KEYS.map((key) => [key, role.permissions?.[key] === true]))
    })),
    reviews: {
      pending: source.pending.filter((row) => row.reviewed_at == null).map(reviewRow),
      history: source.pending.filter((row) => row.reviewed_at != null).map(reviewRow),
      joinPending: source.joinPending.filter((row) => row.company_id === source.companyId && row.reviewed_at == null).map((row) => ({
        id: row.id,
        employee: asText(employeeById.get(row.employee_id)?.name),
        appliedAt: formatDate(row.requested_at),
        note: asText(row.note)
      }))
    }
  };
}

async function buildTeamExtrasSnapshot() {
  const [logs, comments, employees, companies, bindings, joins] = await Promise.all([
    allRows("team_update_logs", "created_at", false),
    allRows("team_update_log_comments", "created_at"),
    allRows("employees", "created_at"),
    allRows("companies", "created_at"),
    allRows("employee_companies", "joined_at"),
    allRows("company_join_pending", "requested_at", false)
  ]);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const employeeByUserId = new Map(employees.map((employee) => [employee.user_id, employee]));
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const commentsByLog = new Map();
  for (const comment of comments) {
    const list = commentsByLog.get(comment.update_log_id) ?? [];
    list.push(comment);
    commentsByLog.set(comment.update_log_id, list);
  }
  return {
    generated_at: new Date().toISOString(),
    scope: "RLS-visible team extras",
    teamUpdateLogs: logs.map((log) => ({
      id: log.id,
      author: asText(employeeByUserId.get(log.author_user_id)?.name, "—"),
      summary: asText(log.summary),
      detail: asText(log.detail),
      createdAt: formatDateTime(log.created_at),
      edited: timestamp(log.updated_at) > timestamp(log.created_at) + 60_000,
      comments: (commentsByLog.get(log.id) ?? []).map((comment) => ({
        id: comment.id,
        authorUserId: asText(comment.author_user_id) || null,
        author: asText(comment.author_name, "—"),
        body: asText(comment.body),
        parentId: comment.parent_comment_id ?? null,
        time: formatDateTime(comment.created_at)
      }))
    })),
    companies: companies.map((company) => ({
      id: company.id,
      name: asText(company.name),
      featureAiBatch: company.feature_ai_batch === true,
      employeeCount: bindings.filter((binding) => binding.company_id === company.id).length,
      createdAt: formatDate(company.created_at)
    })),
    joinHistory: joins.map((join) => ({
      id: join.id,
      employee: asText(employeeById.get(join.employee_id)?.name),
      company: asText(companyById.get(join.company_id)?.name),
      appliedAt: formatDate(join.requested_at),
      reviewedAt: formatDate(join.reviewed_at),
      approved: join.approved,
      note: asText(join.note),
      rejectReason: asText(join.reject_reason)
    })),
    commission: []
  };
}

async function buildPendingDeductionSnapshot() {
  const [invoices, customers, movements] = await Promise.all([
    allRows("invoices", "created_at", false),
    allRows("customers", "name"),
    allRows("inventory_movements", "created_at", false)
  ]);
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const deducted = new Set();
  movements.forEach((movement) => {
    if (movement.invoice_id != null) deducted.add(String(movement.invoice_id));
  });
  const pending = dedupeInvoices(invoices).filter((invoice) =>
    invoice.status === "Paid" && !asText(invoice.notes).includes("__BROADWAY__") &&
    invoice.legacy_skip_deduct !== true && !deducted.has(String(invoice.id)) &&
    !deducted.has(String(invoice.invoice_number)));
  return {
    generated_at: new Date().toISOString(),
    scope: "RLS-visible paid invoices without stock deduction",
    invoices: pending.map((invoice) => {
      const customer = customerById.get(invoice.customer_id) ?? {};
      return {
        orderNo: invoiceNumber(invoice),
        customer: asText(customer.name, "—"),
        phone: asText(customer.phone),
        date: formatDate(invoice.date),
        source: invoiceChannel(invoice),
        amount: asNumber(invoice.total),
        items: normalizedInvoiceItems(invoice).slice(0, 2).map((item) => ({ name: item.name, qty: item.qty }))
      };
    })
  };
}

async function buildHomeOrderMetricsSnapshot() {
  const source = await orderSourceData();
  return {
    source: "orders.json",
    generated_at: new Date().toISOString(),
    rows: source.invoices.map((invoice) => {
      const latestEvent = (source.eventsByInvoice.get(invoice.id) ?? []).sort((a, b) => timestamp(b.event_at) - timestamp(a.event_at))[0];
      return [
        formatDate(invoice.date),
        invoice.status === "Paid" ? "completed" : "in-progress",
        asNumber(invoice.total),
        asText(invoice.shipping_status, "unshipped") || "unshipped",
        latestEvent ? formatDateTime(latestEvent.event_at) : "",
        latestEvent ? asText(latestEvent.description).split("：")[0] : "",
        formatDateTime(invoice.shipped_at)
      ];
    })
  };
}

async function buildHomeSnapshot() {
  const [ordersSnapshot, customersSnapshot, tasksSnapshot, membersSnapshot, inventorySnapshot, warrantySnapshot, currentUser] = await Promise.all([
    buildOrdersSnapshot(),
    buildCustomersSnapshot(),
    buildTasksSnapshot(),
    buildMembersSnapshot(),
    buildInventorySnapshot(),
    buildWarrantySnapshot(),
    getCurrentUser()
  ]);
  const nowParts = dateParts(new Date(), true);
  const monthPrefix = `${nowParts.year}/${nowParts.month}/`;
  const chartCounts = new Map();
  ordersSnapshot.orders.filter((order) => order.date.startsWith(monthPrefix)).forEach((order) => {
    order.detail.items.forEach((item) => chartCounts.set(item.name, (chartCounts.get(item.name) ?? 0) + item.quantity));
  });
  const chart = [...chartCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 11)
    .map(([label, value]) => ({ label, value }));
  // 煊煊 2026-07-13:首页「我的任务」只取当前登录成员被指派的进行中主任务。
  const openTasks = tasksSnapshot.tasks.filter((task) =>
    task.status === "open" && task.parentId === null &&
    task.assignees.some((assignee) => assignee.employeeId === currentUser?.employeeId));
  const mainProducts = inventorySnapshot.products.filter((product) => product.parentId === null);
  return {
    __live: true,
    generated_at: new Date().toISOString(),
    unread: { tasks: 0, orders: 0, inventory: 0, messages: 0 },
    stats: [
      { key: "orders", tone: "", value: ordersSnapshot.orders.length },
      // Mirrors bizflow_samyung/src/views/Dashboard.jsx:98-101: IMEI-only customers do not enter the KPI.
      { key: "customers", tone: "blue", value: customersSnapshot.customers.filter((customer) => customer.hasEmail || customer.hasPhone).length },
      { key: "members", tone: "green", value: membersSnapshot.membersStats.all },
      { key: "warranty", tone: "yellow", value: warrantySnapshot.items.length, alert: warrantySnapshot.items.length > 0 }
    ],
    tasks: openTasks.slice(0, 4).map((task) => ({
      title: task.title,
      due: task.due,
      count: task.feedback.length,
      assignee: task.assignees.map((assignee) => assignee.name).join("、") || "—"
    })),
    feed: tasksSnapshot.tasks.slice(0, 3).map((task) => ({
      name: task.creator,
      action: "posted",
      title: task.title,
      date: formatMonthDay(task.createdAt),
      time: formatTime(task.createdAt),
      avatar: "initial"
    })),
    chart,
    orders: ordersSnapshot.orders.slice(0, 4).map((order) => ({
      no: order.detail.orderNo,
      product: order.product,
      customer: order.customer,
      phone: order.phone,
      date: order.date,
      time: order.detail.time
    })),
    stock: mainProducts.sort((a, b) => b.stock - a.stock).slice(0, 4).map((product) => ({
      count: String(product.stock),
      image: product.imageUrl,
      itemsId: `Items ID:${product.internalCode || product.code || product.shopifySku || product.id}`,
      product: product.name
    })),
    members: membersSnapshot.members.map((member) => ({
      name: member.name,
      dept: "member",
      role: member.roleName,
      openTasks: member.openTasks,
      joinedAt: member.joinedAt,
      bizflowMainAccess: member.bizflowMainAccess
    })),
    membersStats: { ...membersSnapshot.membersStats },
    currentUser: {
      name: currentUser?.name || "",
      email: currentUser?.email || "",
      dept: currentUser?.role || "",
      bizflowMainAccess: currentUser?.bizflowMainAccess === true
    },
    warrantyItems: warrantySnapshot.items.slice(0, 4).map((item) => ({
      no: item.no,
      product: item.product,
      customer: item.customer,
      phone: item.phone,
      date: item.expiry
    }))
  };
}

const builders = {
  "home.json": buildHomeSnapshot,
  "tasks.json": buildTasksSnapshot,
  "team-extras.json": buildTeamExtrasSnapshot,
  "members.json": buildMembersSnapshot,
  "customers.json": buildCustomersSnapshot,
  "warranty.json": buildWarrantySnapshot,
  "orders.json": buildOrdersSnapshot,
  "home-order-metrics.json": buildHomeOrderMetricsSnapshot,
  "inventory.json": buildInventorySnapshot,
  "northbound.json": buildNorthboundSnapshot,
  "charger-leads.json": () => buildSimpleRowsSnapshot("charger_leads", "leads"),
  "aliases.json": buildAliasesSnapshot,
  "shopify-links.json": buildShopifyLinksSnapshot,
  "suppliers.json": () => buildSimpleRowsSnapshot("suppliers", "suppliers"),
  "expense.json": () => buildSimpleRowsSnapshot("expense_reimbursements", "reimbursements"),
  "whatsapp.json": buildWhatsappSnapshot,
  "pending-deduction.json": buildPendingDeductionSnapshot
};

export async function getLiveSnapshot(snapshot) {
  const session = await ensureLiveSession();
  if (!session) return LIVE_SNAPSHOT_MISS;
  if (snapshotUserId !== session.user.id) {
    snapshotUserId = session.user.id;
    LIVE_BUILDERS.clear();
  }
  // OCPP stays on its separately approved read-only snapshot line (docs/41); P0 never invents a Supabase source for it.
  const builder = builders[snapshot];
  if (!builder) return LIVE_SNAPSHOT_MISS;
  if (!LIVE_BUILDERS.has(snapshot)) {
    const promise = builder().then((value) => ({ ...value, __live: true })).catch((error) => {
      if (LIVE_BUILDERS.get(snapshot) === promise) LIVE_BUILDERS.delete(snapshot);
      throw error;
    });
    LIVE_BUILDERS.set(snapshot, promise);
  }
  return LIVE_BUILDERS.get(snapshot);
}

export function invalidateLiveSnapshot(...snapshots) {
  snapshots.flat().forEach((snapshot) => LIVE_BUILDERS.delete(String(snapshot || "")));
}
