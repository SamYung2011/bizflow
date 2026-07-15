// 数据接口层(煊煊 2026-07-08 拍板:屏只认接口,不写死样板)
// 双模式:有 Supabase session 时由 live-snapshots 按 RLS 可见范围构造同契约真数据;
// 无 session 时保持 snapshots + field mock 演示路径。真库读取失败不得静默混回快照。
// 权限靠生产 RLS + RBAC 双层;provider 只用 anon session,前端门控不构成安全边界。

import { getCurrentUser as getAuthCurrentUser, getSession } from "./auth.js";
import { getLiveSnapshot, LIVE_SNAPSHOT_MISS } from "./live-snapshots.js";
import {
  getLiveOcppChargingData,
  getLiveOcppFinanceData,
  getLiveOcppMonitorData,
  getLiveOcppMonitorLogsData,
  getLiveOcppUsersData,
  LIVE_OCPP_MISS
} from "./live-ocpp.js";
import { getReadState, rememberUnreadWatermarks } from "./read-state.js";
import { buildCustomerGroups } from "./customer-groups.js";
import { customerSourceFromInvoices } from "./customer-source.js";

function warnProviderFallback(snapshot, fallback) {
  console.warn(`[provider] ${snapshot} invalid → fallback ${fallback}`);
}

async function fetchSnapshot(url, snapshot, fallback) {
  const liveSnapshot = await getLiveSnapshot(snapshot);
  if (liveSnapshot !== LIVE_SNAPSHOT_MISS) return liveSnapshot;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      warnProviderFallback(snapshot, fallback);
      return null;
    }
    return await response.json();
  } catch {
    warnProviderFallback(snapshot, fallback);
    return null;
  }
}

const mock = {
  // 未读语义(煊煊:红点=有未读才亮;顶栏消息钮=快跳 team 未读入口)
  unread: { tasks: 4, orders: 2, inventory: 1, messages: 3 },
  stats: [
    { key: "orders", tone: "", value: 143 },
    { key: "customers", tone: "blue", value: 98 },
    { key: "members", tone: "green", value: 12 },
    { key: "warranty", tone: "yellow", value: 35, alert: true }
  ],
  tasks: [
    { title: "UI/UX制作-任务详情页", due: "2026/06/24", count: 21, assignee: "Vincent" },
    { title: "订单逻辑", due: "2026/06/24", count: 21, assignee: "Vincent" },
    { title: "网站修改", due: "2026/06/24", count: 21, assignee: "Vincent" },
    { title: "网站修改", due: "2026/06/24", count: 21, assignee: "Vincent" }
  ],
  feed: [
    { name: "Vincent", action: "posted", title: "UIUX（任务标题）", date: "06/12", time: "15:02", avatar: "initial" },
    { name: "Vincent", action: "commented", title: "UIUX（任务标题）", date: "06/12", time: "15:02", avatar: "image" },
    { name: "Vincent", action: "posted", title: "UIUX（任务标题）", date: "06/12", time: "15:02", avatar: "initial" }
  ],
  // chart 契约两种形状并存:旧=11 个整数;新(煊煊 2026-07-08 定)=当月产品销量 TOP 11 [{label,value}]
  chart: [60, 80, 50, 120, 95, 141, 110, 161, 131, 100, 75],
  orders: [0, 1, 2, 3].map(() => ({
    no: "#2134", product: "DC Adaptor Pro", customer: "Vicky", phone: "+853 5600 8904", date: "2026/06/12", time: "15:02"
  })),
  stock: [
    { product: "DC Adaptor Pro", itemsId: "Items ID:2134134124", count: "100" },
    { product: "DC Adaptor Pro", itemsId: "Items ID:2134134124", count: "100" },
    { product: "DC Adaptor Pro", itemsId: "Items ID:2134134124", count: "10" },
    { product: "DC Adaptor Pro", itemsId: "Items ID:2134134124", count: "10" }
  ],
  members: Array.from({ length: 12 }, () => ({ name: "Vincent", dept: "design", role: "member", joinedAt: "2026/6/1", bizflowMainAccess: true })),
  // 成员屏统计(all 含离职;pendingReview=company_join_pending 待审数;库里无头像字段,页面一律首字母头像)
  membersStats: { all: 12, active: 12, pendingReview: 0, left: 0 },
  // 静态演示的当前登录者;bizflowMainAccess=bizflow 主站白名单位,驱动 team→bizflow 返回入口(正式接入后由登录态供给)
  currentUser: { name: "Vincent", email: "vincent@example.com", dept: "design", bizflowMainAccess: true },
  // 最近到期保修(煊煊 2026-07-08 加需):到期日升序,最先到期在前;stock 项可选 image 字段(无图省略,页面回退灰块)
  warrantyItems: [0, 1, 2, 3].map(() => ({
    no: "#2134", product: "DC Adaptor Pro", customer: "Vicky", phone: "+853 5600 8904", date: "2026/07/20"
  }))
};

// team/任务管理屏数据契约(mock 形状 = 契约;真数据走 snapshots/tasks.json + home.json,逐字段回退)。
// 库里任务优先级枚举是 high/mid/low/none;展示层 mid→medium,none→low(煊煊 2026-07-11 已拍)。
const teamTaskMock = {
  summary: { total: 90, completed: 20, inProgress: 12 },
  filters: {
    status: "inProgress",
    priority: "all",
    view: "board"
  },
  members: [
    { name: "Honnmono", dept: "all", taskCount: 21, active: true, badge: 0 },
    { name: "Vincent", dept: "id", taskCount: 3, badge: 0 },
    { name: "Hellen", dept: "tech", taskCount: 3, badge: 0 },
    { name: "Jack", dept: "operations", taskCount: 3, badge: 0 },
    { name: "Hoey", dept: "customerManager", taskCount: 3, badge: 0 },
    { name: "朝", dept: "customerManager", taskCount: 3, badge: 0 },
    { name: "Vicky", dept: "graphic", taskCount: 3, badge: 0 },
    { name: "Vicky", dept: "graphic", taskCount: 3, badge: 0 }
  ],
  // 小屿/澄川编造的任务详情与反馈演示数据,非真实任务内容或真实沟通记录。
  detail: {
    contentKey: "tasks.demo.content",
    visibility: "team",
    feedback: [
      { id: "feedback-demo-1", author: "Vincent", timestamp: "26/05/23 15:20", messageKey: "tasks.demo.feedback.short", own: false },
      { id: "feedback-demo-2", author: "Vincent", timestamp: "26/05/23 15:20", messageKey: "tasks.demo.feedback.short", own: true },
      { id: "feedback-demo-3", author: "Vincent", timestamp: "26/05/23 15:20", messageKey: "tasks.demo.feedback.long", own: true },
      { id: "feedback-demo-4", author: "Vincent", timestamp: "26/05/23 15:20", messageKey: "tasks.demo.feedback.short", own: false }
    ]
  },
  // 小屿/澄川编造的新增任务表单演示默认值,非真实任务资料。
  form: {
    defaults: {
      title: "UI/UX制作",
      contentKey: "tasks.demo.content",
      priority: "high",
      visibility: "team",
      departmentId: "",
      owner: "",
      requiresReview: "no",
      members: "",
      due: "2026-07-21"
    }
  },
  // mock 看板卡是离线样例(快照挂了才显示),不再用克隆真任务的方式伪造
  board: [
    { key: "high", count: 3, taskCountBadge: "3" },
    { key: "medium", count: 3, taskCountBadge: "3" },
    { key: "low", count: 3, taskCountBadge: "3" }
  ].map((column) => ({
    ...column,
    tasks: mock.tasks.slice(0, 3).map((task, i) => ({
      title: task.title, due: task.due, owner: "Vincent",
      countBadge: i === 2 ? "" : String(task.count), done: false
    }))
  }))
};

// 快照路径按本模块文件定位(等价于从 bizflow/home.html 看的 ../data/snapshots/home.json,
// 用 import.meta.url 是为了任何页面引用本模块时路径都不跑偏)
const SNAPSHOT_URL = new URL("./snapshots/home.json", import.meta.url);

let snapshotPromise = null;
function loadSnapshot() {
  if (!snapshotPromise) {
    snapshotPromise = fetchSnapshot(SNAPSHOT_URL, "home.json", "field-level home mock");
  }
  return snapshotPromise;
}

// 从宽校验:类型对得上就用真数据;某字段缺失/形状不对只回退该字段的 mock
const validators = {
  unread: (v) => !!v && typeof v === "object" && !Array.isArray(v),
  stats: (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x && x.key != null && x.value != null),
  tasks: (v) => Array.isArray(v) && v.every((x) => x && x.title != null),
  feed: (v) => Array.isArray(v) && v.every((x) => x && x.name != null && x.action != null),
  chart: (v) => Array.isArray(v) && v.length > 0 &&
    (v.every((n) => typeof n === "number") ||
     v.every((x) => x && typeof x.label === "string" && typeof x.value === "number")),
  orders: (v) => Array.isArray(v) && v.every((x) => x && x.no != null),
  stock: (v) => Array.isArray(v) && v.every((x) => x && x.product != null),
  members: (v) => Array.isArray(v) && v.every((x) => x && x.name != null),
  membersStats: (v) => !!v && ["all", "active", "pendingReview", "left"].every((k) => typeof v[k] === "number"),
  currentUser: (v) => !!v && typeof v.name === "string" && typeof v.bizflowMainAccess === "boolean",
  warrantyItems: (v) => Array.isArray(v) && v.every((x) => x && x.no != null && x.date != null)
};

function mergeSnapshot(snap) {
  if (!snap) return mock;
  if (snap.__live === true) return snap;
  const out = {};
  for (const key of Object.keys(mock)) {
    const valid = validators[key] && validators[key](snap[key]);
    if (!valid) warnProviderFallback(`home.json:${key}`, `mock.${key}`);
    out[key] = valid ? snap[key] : mock[key];
  }
  return out;
}

export async function getHomeData() {
  return mergeSnapshot(await loadSnapshot());
}

export async function getUnread() {
  const { unread } = await buildUnreadState();
  return unread;
}

export async function getUnreadWatermarks() {
  const { watermarks } = await buildUnreadState();
  return watermarks;
}

function parseHongKongDate(value, withTime = false) {
  const pattern = withTime
    ? /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/
    : /^(\d{4})\/(\d{2})\/(\d{2})$/;
  const match = String(value || "").match(pattern);
  if (!match) return Number.NaN;
  const [, year, month, day, hour = "00", minute = "00"] = match;
  const numbers = [year, month, day, hour, minute].map(Number);
  const [yearNumber, monthNumber, dayNumber, hourNumber, minuteNumber] = numbers;
  const daysInMonth = new Date(Date.UTC(yearNumber, monthNumber, 0)).getUTCDate();
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > daysInMonth ||
      hourNumber > 23 || minuteNumber > 59) return Number.NaN;
  return Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`);
}

function parseFeedDate(entry, snapshotYear) {
  const date = String(entry?.date || "").match(/^(\d{2})\/(\d{2})$/);
  const time = String(entry?.time || "").match(/^(\d{2}):(\d{2})$/);
  if (!date || !time || !Number.isInteger(snapshotYear) || snapshotYear < 2000) return Number.NaN;
  const month = Number(date[1]);
  const day = Number(date[2]);
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const daysInMonth = new Date(Date.UTC(snapshotYear, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59) return Number.NaN;
  // feed 只有 MM/DD；按快照 generated_at 年份补全。跨年快照若混入上一年条目会有局限。
  return Date.parse(`${snapshotYear}-${date[1]}-${date[2]}T${time[1]}:${time[2]}:00+08:00`);
}

function toIso(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : "";
}

function latestTimestamp(items, readWatermark, getTimestamp) {
  const timestamps = items.map(getTimestamp).filter(Number.isFinite);
  if (timestamps.length !== items.length) return { count: 0, watermark: "" };
  const latest = timestamps.length ? Math.max(...timestamps) : Number.NaN;
  const readTime = Date.parse(readWatermark || "");
  return {
    count: readWatermark && Number.isFinite(readTime)
      ? timestamps.filter((timestamp) => timestamp > readTime).length
      : timestamps.length,
    watermark: toIso(latest)
  };
}

let unreadStateMemoKey = "";
let unreadStatePromise = null;

function buildUnreadState() {
  const read = getReadState();
  const memoKey = JSON.stringify(read);
  if (unreadStatePromise && unreadStateMemoKey === memoKey) return unreadStatePromise;
  unreadStateMemoKey = memoKey;
  const promise = computeUnreadState(read).catch((error) => {
    if (unreadStatePromise === promise) {
      unreadStatePromise = null;
      unreadStateMemoKey = "";
    }
    throw error;
  });
  unreadStatePromise = promise;
  return unreadStatePromise;
}

async function computeUnreadState(read) {
  const [tasksSnapshot, orderMetricRows, homeSnapshot, inventorySnapshot] = await Promise.all([
    loadTasksSnapshot(),
    getHomeOrderMetricRows(),
    loadSnapshot(),
    loadInventorySnapshot()
  ]);

  const taskRows = Array.isArray(tasksSnapshot?.tasks) ? tasksSnapshot.tasks : null;
  const taskDatesValid = taskRows && taskRows.every((task) => Number.isFinite(parseHongKongDate(task?.createdAt, true)));
  if (tasksSnapshot && !taskDatesValid) warnProviderFallback("tasks.json:tasks.createdAt", "zero task unread");
  const tasks = taskDatesValid
    ? latestTimestamp(taskRows, read.tasks, (task) => parseHongKongDate(task.createdAt, true))
    : { count: 0, watermark: "" };

  // home-order-metrics 是 orders.json 的 6586/6586 无损日期投影；用它维持“Home 禁加载 4.7MB orders.json”既有契约。
  const orderRows = Array.isArray(orderMetricRows) ? orderMetricRows : null;
  const orders = orderRows && orderRows.every((order) => Number.isFinite(parseHongKongDate(order.date)))
    ? latestTimestamp(orderRows, read.orders, (order) => parseHongKongDate(order.date))
    : { count: 0, watermark: "" };

  const generatedYear = Number(String(homeSnapshot?.generated_at || "").slice(0, 4));
  const feedRows = validators.feed(homeSnapshot?.feed) ? homeSnapshot.feed : null;
  const feedDatesValid = feedRows && feedRows.every((entry) => Number.isFinite(parseFeedDate(entry, generatedYear)));
  if (homeSnapshot && !feedDatesValid) warnProviderFallback("home.json:feed dates", "zero message unread");
  const messages = feedDatesValid
    ? latestTimestamp(feedRows, read.messages, (entry) => parseFeedDate(entry, generatedYear))
    : { count: 0, watermark: "" };

  let inventoryCount = 0;
  let inventoryFingerprint = "";
  if (isInventorySnapshot(inventorySnapshot)) {
    const stockCarriers = inventorySnapshot.products.filter((product) =>
      product.parentId !== null || (product.detail?.variants?.length ?? 0) === 0);
    // 与 components/order-metrics.js 的 lowStockCount 同源；stock=0 有意纳入 docs/37「低库存∪缺货」集合。
    // Mirrors bizflow_samyung/src/context/AppContext.jsx:420-425: discontinued rows never enter low stock.
    const lowOrOutOfStock = stockCarriers.filter((product) =>
      (product.status || "active") !== "discontinued" && Number(product.stock) < 50);
    inventoryFingerprint = lowOrOutOfStock.map((product) => product.id).sort().join("|");
    inventoryCount = read.inventory === inventoryFingerprint ? 0 : lowOrOutOfStock.length;
  } else if (inventorySnapshot) {
    warnProviderFallback("inventory.json", "zero inventory unread");
  }

  const watermarks = {
    tasks: tasks.watermark,
    orders: orders.watermark,
    messages: messages.watermark,
    inventory: inventoryFingerprint
  };
  rememberUnreadWatermarks(watermarks);
  return {
    unread: {
      tasks: tasks.count,
      orders: orders.count,
      messages: messages.count,
      inventory: inventoryCount
    },
    watermarks
  };
}

export async function getCurrentUser() {
  if (await getSession()) return getAuthCurrentUser();
  // 静态演示 = 快照里的 currentUser(默认 Helen);正式接入后换登录态。
  // team→bizflow 返回入口/路由按 currentUser.bizflowMainAccess 显隐。
  const [home, membersSnapshot, extrasSnapshot] = await Promise.all([
    getHomeData(),
    loadMembersSnapshot(),
    loadTeamExtrasSnapshot()
  ]);
  const base = home.currentUser;
  if (!isR9MembersSnapshot(membersSnapshot)) {
    if (membersSnapshot) warnProviderFallback("members.json", "base current user without companies");
    return { ...base, availableCompanies: [] };
  }
  const normalizedName = String(base.name || "").trim().toLocaleLowerCase();
  const member = membersSnapshot.members.find((entry) => entry.name.trim().toLocaleLowerCase() === normalizedName);
  const extras = cloneTeamExtras(extrasSnapshot);
  const joinedCompanies = new Set(
    extras.joinHistory
      .filter((entry) => entry.approved && entry.employee.trim().toLocaleLowerCase() === normalizedName)
      .map((entry) => entry.company.trim().toLocaleLowerCase())
  );
  // 当前 shell 公司是 Honnmono；跨公司已通过记录再补入 joined 集合。
  joinedCompanies.add("honnmono");
  return {
    ...base,
    name: member?.name ?? base.name,
    email: member?.email ?? base.email,
    position: member?.position ?? "",
    phone: member?.phone ?? "",
    note: "",
    role: member?.roleName ?? "",
    availableCompanies: extras.companies
      .filter((company) => !joinedCompanies.has(company.name.trim().toLocaleLowerCase()))
      .map(({ id, name }) => ({ id, name }))
  };
}

// 任务侧快照(snapshots/tasks.json:taskStats/kanban/kanbanCounts,口径=Honnmono 板块,详见 README)
const TASKS_SNAPSHOT_URL = new URL("./snapshots/tasks.json", import.meta.url);
const TEAM_EXTRAS_SNAPSHOT_URL = new URL("./snapshots/team-extras.json", import.meta.url);

let tasksSnapshotPromise = null;
let teamExtrasSnapshotPromise = null;
function loadTasksSnapshot() {
  if (!tasksSnapshotPromise) {
    tasksSnapshotPromise = fetchSnapshot(TASKS_SNAPSHOT_URL, "tasks.json", "task mock/kanban contract");
  }
  return tasksSnapshotPromise;
}

function loadTeamExtrasSnapshot() {
  if (!teamExtrasSnapshotPromise) {
    teamExtrasSnapshotPromise = fetchSnapshot(TEAM_EXTRAS_SNAPSHOT_URL, "team-extras.json", "empty team extras");
  }
  return teamExtrasSnapshotPromise;
}

const isNum = (n) => typeof n === "number";
const isKanbanCard = (x) => x && x.title != null && x.due != null && x.assignee != null;

function hongKongDateInput() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isFullTask(task) {
  return !!task && typeof task.id === "string" && typeof task.title === "string" &&
    ["open", "done", "abandoned"].includes(task.status) && ["high", "mid", "low", "none"].includes(task.priority) &&
    Array.isArray(task.assignees) && task.assignees.every((member) => member && typeof member.name === "string") &&
    Array.isArray(task.feedback) && task.feedback.every((entry) =>
      entry && typeof entry.id === "string" && typeof entry.author === "string" && typeof entry.time === "string" && typeof entry.body === "string");
}

function normalizeFullTask(task, currentUserName, today) {
  const priority = task.priority === "mid" ? "medium" : task.priority === "none" ? "low" : task.priority;
  const assignees = task.assignees.map((member) => ({
    employeeId: typeof member.employeeId === "string" ? member.employeeId : "",
    name: member.name,
    completedAt: typeof member.completedAt === "string" ? member.completedAt : null,
    abandonedAt: typeof member.abandonedAt === "string" ? member.abandonedAt : null
  }));
  const members = assignees.map((member) => member.name).filter(Boolean);
  const overdue = task.status === "open" && typeof task.due === "string" && task.due !== "" && task.due.replaceAll("/", "-") < today;
  const status = task.status === "done" ? "completed" : task.status === "abandoned" ? "abandoned" : overdue ? "overdue" : "inProgress";
  return {
    id: task.id,
    title: task.title,
    content: typeof task.note === "string" ? task.note : "",
    owner: members.join("、") || "—",
    members,
    priority,
    dbPriority: task.priority,
    status,
    done: task.status === "done",
    due: task.due || "",
    startDate: task.startDate || "",
    createdAt: task.createdAt || "",
    completedAt: task.completedAt || "",
    creator: task.creator || "—",
    creatorId: task.creatorId || "",
    parentId: task.parentId || null,
    departmentId: typeof task.departmentId === "string" ? task.departmentId : "",
    visibility: task.visibility?.scope === "department" ? "department" : "team",
    visibilityDepartment: task.visibility?.department || "",
    requiresReview: task.needsApproval === true,
    approvedAt: task.approvedAt || "",
    approvedBy: task.approvedBy || "",
    attachments: Array.isArray(task.attachments) ? task.attachments.map((attachment) => ({ ...attachment })) : [],
    attachmentCount: isNum(task.attachmentCount) ? task.attachmentCount : 0,
    assignees,
    subtasks: [],
    countBadge: task.feedback.length ? String(task.feedback.length) : "",
    feedback: task.feedback.map((entry) => ({
      id: entry.id,
      author: entry.author,
      timestamp: entry.time,
      message: entry.body,
      parentId: entry.parentId || null,
      mentionedUserIds: Array.isArray(entry.mentionedUserIds) ? entry.mentionedUserIds.slice() : [],
      attachments: Array.isArray(entry.attachments) ? entry.attachments.map((attachment) => ({ ...attachment })) : [],
      attachmentCount: isNum(entry.attachmentCount) ? entry.attachmentCount : 0,
      own: entry.author === currentUserName
    }))
  };
}

function normalizeTeamTaskDetail(task, priority, index) {
  const owner = task.owner ?? task.assignee ?? "";
  const fallbackMembers = String(owner).split(/[,，、]/).map((name) => name.trim()).filter(Boolean);
  return {
    ...task,
    id: task.id ?? `${priority}-task-${index + 1}`,
    owner,
    priority,
    status: task.done === true ? "completed" : "inProgress",
    contentKey: task.contentKey ?? teamTaskMock.detail.contentKey,
    visibility: task.visibility ?? teamTaskMock.detail.visibility,
    members: Array.isArray(task.members) ? task.members.slice() : fallbackMembers,
    feedback: Array.isArray(task.feedback)
      ? task.feedback.map((entry) => ({ ...entry }))
      : teamTaskMock.detail.feedback.map((entry) => ({ ...entry }))
  };
}

export async function getTeamTaskData() {
  const [home, homeSnap, snap, membersSnap, teamExtras] = await Promise.all([
    getHomeData(),
    loadSnapshot(),
    loadTasksSnapshot(),
    loadMembersSnapshot(),
    loadTeamExtrasSnapshot()
  ]);

  // 任务三数:真实 status 计数(total/completed/open),坏了整块回退 mock
  const ts = snap?.taskStats;
  const statsOk = ts && isNum(ts.total) && isNum(ts.completed) && isNum(ts.open);
  if (snap && !statsOk) warnProviderFallback("tasks.json:taskStats", "task summary mock");
  const summary = statsOk
    ? { total: ts.total, completed: ts.completed, inProgress: ts.open }
    : { ...teamTaskMock.summary };

  // 成员栏:home 快照真成员 + openTasks(真·个人未完成数;快照没带该字段就显 0,宁缺毋假);
  // badge=未读数,库里无按人未读概念 => 一律 0(红点宁灭不假亮)。首项 Honnmono 为全员汇总。
  // 只有 home 快照真的载入且成员字段合法才走真数据;否则整栏回退 teamTaskMock 离线样例
  const r9Members = isR9MembersSnapshot(membersSnap);
  const realMembers = !!homeSnap && validators.members(homeSnap.members) && homeSnap.members.length > 0;
  if (membersSnap && !r9Members && !realMembers) warnProviderFallback("members.json", "task member mock");
  const members = r9Members
    ? [
        { name: "Honnmono", dept: "all", taskCount: statsOk ? ts.open : 0, active: true, badge: 0 },
        ...membersSnap.members.map((member) => ({
          id: member.id,
          name: member.name,
          dept: "member",
          deptLabel: member.departments.join("、") || "—",
          taskCount: isNum(member.openTasks) ? member.openTasks : 0,
          badge: 0,
          active: false
        }))
      ]
    : realMembers
    ? [
        { name: "Honnmono", dept: "all", taskCount: statsOk ? ts.open : 0, active: true, badge: 0 },
        ...home.members.map((m) => ({
          name: m.name,
          dept: m.dept ?? "design",
          taskCount: isNum(m.openTasks) ? m.openTasks : 0,
          badge: 0,
          active: false
        }))
      ]
    : teamTaskMock.members.map((m) => ({ ...m }));
  const departments = r9Members
    ? membersSnap.departments.map((department) => ({
        id: department.id,
        name: department.name,
        memberIds: department.memberIds.slice()
      }))
    : [];

  // R9 全量 tasks[]:已完成/已放弃/逾期都在同一筛选模型内;none 归低优先级列。
  const fullTasksOk = Array.isArray(snap?.tasks) && (snap.__live === true || snap.tasks.length > 0) && snap.tasks.every(isFullTask);
  const kb = snap?.kanban;
  const kbOk = kb && ["high", "medium", "low"].every((k) => Array.isArray(kb[k]) && kb[k].every(isKanbanCard));
  if (snap && !fullTasksOk && !kbOk) warnProviderFallback("tasks.json:tasks/kanban", "task board mock");
  const today = hongKongDateInput();
  const normalizedTasks = fullTasksOk
    ? snap.tasks.map((task) => normalizeFullTask(task, home.currentUser?.name ?? "", today))
    : [];
  const normalizedById = new Map(normalizedTasks.map((task) => [task.id, task]));
  normalizedTasks.forEach((task) => {
    if (task.parentId && normalizedById.has(task.parentId)) normalizedById.get(task.parentId).subtasks.push(task);
  });
  const rawBoard = fullTasksOk
    ? ["high", "medium", "low"].map((key) => {
        const tasks = normalizedTasks.filter((task) => task.parentId === null && task.priority === key);
        const count = tasks.filter((task) => task.status === "inProgress" || task.status === "overdue").length;
        return { key, count, taskCountBadge: String(count), tasks };
      })
    : kbOk
    ? ["high", "medium", "low"].map((key) => {
        const count = kb[key].length;
        return {
          key,
          count,
          taskCountBadge: String(count),
          tasks: kb[key].map((t) => ({
            title: t.title,
            due: t.due,
            owner: t.assignee,
            countBadge: t.count ? String(t.count) : "",
            done: false // 列内只放 open 任务
          }))
        };
      })
    : teamTaskMock.board.map((column) => ({ ...column, tasks: column.tasks.map((t) => ({ ...t })) }));
  const board = fullTasksOk ? rawBoard : rawBoard.map((column) => ({
      ...column,
      tasks: column.tasks.map((task, index) => normalizeTeamTaskDetail(task, column.key, index))
    }));

  const form = fullTasksOk
    ? {
        defaults: {
          title: "",
          content: "",
          priority: "high",
          visibility: "team",
          departmentId: "",
          owner: "",
          requiresReview: "no",
          members: "",
          due: today
        }
      }
    : { defaults: { ...teamTaskMock.form.defaults } };

  return {
    unread: home.unread ?? mock.unread,
    summary,
    filters: { ...teamTaskMock.filters },
    form,
    members,
    departments,
    board,
    tasks: fullTasksOk ? normalizedTasks : board.flatMap((column) => column.tasks),
    featureAiBatch: Array.isArray(teamExtras?.companies) && teamExtras.companies.some((company) =>
      company && company.name === "Honnmono" && company.featureAiBatch === true)
  };
}

// team/团队成员屏数据契约。统计走快照 membersStats(all/active/pendingReview/left,口径见 README);
// 快照缺该字段才回退按成员数组自算 + 0(宁灭不假亮)。库里无头像字段,页面一律首字母头像。
const teamMembersMock = {
  reviewPending: 0,
  departed: 0,
  // 小屿/澄川编造的新增成员表单演示数据,非真实员工资料。
  form: {
    defaults: { name: "Vicky", position: "", email: "234234@gmail.com", joinedAt: "2026/06/06", dept: "design", role: "member" },
    departments: ["design", "tech", "sales", "finance", "service", "purchase"],
    roles: ["member", "admin"]
  },
  // 小屿/澄川编造的成员详情与任务演示数据,非真实员工资料或真实任务。
  detail: {
    emailDomain: "example.com",
    positionByDept: { design: "designer", tech: "developer", sales: "sales", finance: "accountant", service: "support", purchase: "buyer" },
    commission: "none",
    tasking: [
      { id: "detail-task-open-1", titleKey: "members.task.demo1", due: "2026/07/15" },
      { id: "detail-task-open-2", titleKey: "members.task.demo2", due: "2026/07/18" }
    ],
    tasked: [
      { id: "detail-task-done-1", titleKey: "members.task.demo3", due: "2026/07/06" }
    ]
  },
  // 小屿/澄川编造的账号审核演示申请,非真实申请人或真实邮箱。
  reviews: [
    { id: "review-1", name: "Vincent", email: "vincent.review@example.com", appliedAt: "2026/06/24", position: "designer", dept: "design", role: "member" },
    { id: "review-2", name: "Vicky", email: "vicky.review@example.com", appliedAt: "2026/06/24", position: "designer", dept: "design", role: "member" },
    { id: "review-3", name: "Hoey", email: "hoey.review@example.com", appliedAt: "2026/06/25", position: "support", dept: "service", role: "member" },
    { id: "review-4", name: "Jack", email: "jack.review@example.com", appliedAt: "2026/06/25", position: "developer", dept: "tech", role: "member" },
    { id: "review-5", name: "Marco", email: "marco.review@example.com", appliedAt: "2026/06/26", position: "sales", dept: "sales", role: "member" },
    { id: "review-6", name: "Ivy", email: "ivy.review@example.com", appliedAt: "2026/06/26", position: "accountant", dept: "finance", role: "member" }
  ],
  // 小屿/澄川编造的部门管理演示数据,非真实组织架构。
  departments: [
    { id: "marketing", nameKey: "members.department.marketing", icon: "icon-dept-marketing", manager: "Jack", memberIndexes: [0, 1, 2] },
    { id: "development", nameKey: "members.department.development", icon: "icon-dept-development", manager: "Jack", memberIndexes: [1, 2, 3] },
    { id: "design", nameKey: "members.department.design", icon: "icon-dept-design", manager: "Jack", memberIndexes: [0, 3, 4] },
    { id: "sales", nameKey: "members.department.sales", icon: "icon-dept-sales", manager: "Jack", memberIndexes: [2, 4, 5] },
    { id: "purchase", nameKey: "members.department.purchase", icon: "icon-dept-purchase", manager: "Jack", memberIndexes: [0, 5, 6] },
    { id: "finance", nameKey: "members.department.finance", icon: "icon-dept-finance", manager: "Jack", memberIndexes: [1, 6, 7] },
    { id: "hr", nameKey: "members.department.hr", icon: "icon-dept-sales", manager: "Jack", memberIndexes: [3, 7, 8] }
  ],
  // 小屿/澄川编造的权限矩阵演示数据,非真实账号授权配置。
  permissions: {
    rows: [
      { id: "task-view", labelKey: "members.permission.taskView" },
      { id: "task-create", labelKey: "members.permission.taskCreate" },
      { id: "task-assign", labelKey: "members.permission.taskAssign" },
      { id: "task-delete", labelKey: "members.permission.taskDelete" },
      { id: "member-review", labelKey: "members.permission.memberReview" },
      { id: "member-manage", labelKey: "members.permission.memberManage" },
      { id: "team-switch", labelKey: "members.permission.teamSwitch" },
      { id: "permission-manage", labelKey: "members.permission.permissionManage" }
    ],
    roles: [
      {
        id: "admin",
        nameKey: "members.permission.roleAdmin",
        editable: false,
        grants: { "task-view": true, "task-create": true, "task-assign": true, "task-delete": true, "member-review": true, "member-manage": true, "team-switch": true, "permission-manage": true }
      },
      {
        id: "manager",
        nameKey: "members.permission.roleManager",
        editable: true,
        grants: { "task-view": true, "task-create": true, "task-assign": true, "task-delete": true, "member-review": true, "member-manage": true, "team-switch": false, "permission-manage": false }
      },
      {
        id: "member",
        nameKey: "members.permission.roleMember",
        editable: true,
        grants: { "task-view": true, "task-create": true, "task-assign": true, "task-delete": false, "member-review": true, "member-manage": false, "team-switch": false, "permission-manage": false }
      }
    ]
  }
};

function normalizeFallbackTeamMember(member, index) {
  const dept = member.dept ?? "design";
  const safeName = String(member.name || `member-${index + 1}`).trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, ".").replaceAll(/^\.|\.$/g, "") || `member.${index + 1}`;
  return {
    id: typeof member.id === "string" ? member.id : `member-${index + 1}`,
    name: member.name,
    dept,
    role: member.role ?? "member",
    position: typeof member.position === "string" ? member.position : (teamMembersMock.detail.positionByDept[dept] ?? "member"),
    email: typeof member.email === "string" ? member.email : `${safeName}@${teamMembersMock.detail.emailDomain}`,
    commission: typeof member.commission === "string" ? member.commission : teamMembersMock.detail.commission,
    tasks: {
      tasking: teamMembersMock.detail.tasking.map((task) => ({ ...task })),
      tasked: teamMembersMock.detail.tasked.map((task) => ({ ...task }))
    },
    openTasks: isNum(member.openTasks) ? member.openTasks : 0,
    joinedAt: typeof member.joinedAt === "string" ? member.joinedAt : "",
    // bizflow 主站白名单位(team→bizflow 返回入口按此显隐;缺失按 false,宁关不假开)
    bizflowMainAccess: member.bizflowMainAccess === true,
    status: member.status ?? "active"
  };
}

function buildFallbackTeamMembersData(home) {
  const members = ((Array.isArray(home?.members) && home.members.length > 0) ? home.members : mock.members)
    .map(normalizeFallbackTeamMember);
  const active = members.filter((member) => member.status !== "departed");

  const ms = home?.membersStats;
  const msOk = ms && ["all", "active", "pendingReview", "left"].every((k) => isNum(ms[k]));
  const summary = msOk
    ? { total: ms.all, active: ms.active, reviewPending: ms.pendingReview, departed: ms.left }
    : {
        total: members.length,
        active: active.length,
        reviewPending: teamMembersMock.reviewPending,
        departed: teamMembersMock.departed
      };

  return {
    unread: home?.unread ?? mock.unread,
    currentUserName: home?.currentUser?.name ?? "",
    summary,
    tabs: [
      { key: "members", active: true, update: false },
      { key: "permissions", active: false, update: false },
      { key: "departments", active: false, update: false },
      { key: "reviews", active: false, update: summary.reviewPending > 0 },
      { key: "commission", active: false, update: false },
      { key: "updates", active: false, update: false },
      { key: "companies", active: false, update: false }
    ],
    members,
    form: {
      defaults: { ...teamMembersMock.form.defaults },
      departments: teamMembersMock.form.departments.slice(),
      roles: teamMembersMock.form.roles.slice()
    },
    reviews: teamMembersMock.reviews.map((review) => ({ ...review })),
    reviewHistory: [],
    joinPending: [],
    joinHistory: [],
    commission: [],
    commissionSales: [],
    updateLogs: [],
    companies: [],
    departments: teamMembersMock.departments.map(({ memberIndexes, ...department }) => ({
      ...department,
      memberIds: memberIndexes.map((index) => members[index]?.id).filter(Boolean)
    })),
    permissions: {
      rows: teamMembersMock.permissions.rows.map((row) => ({ ...row })),
      roles: teamMembersMock.permissions.roles.map((role) => ({ ...role, grants: { ...role.grants } }))
    }
  };
}

const MEMBERS_SNAPSHOT_URL = new URL("./snapshots/members.json", import.meta.url);
const R9_PERMISSION_KEYS = [
  "can_create_task",
  "can_manage_roles",
  "can_assign_others",
  "can_validate_task",
  "can_view_commission",
  "can_manage_employees",
  "can_edit_others_tasks",
  "can_delete_others_tasks",
  "can_approve_registration"
];
const R9_PERMISSION_LABEL_KEYS = {
  can_create_task: "members.permission.createTask",
  can_manage_roles: "members.permission.manageRoles",
  can_assign_others: "members.permission.assignOthers",
  can_validate_task: "members.permission.validateTask",
  can_view_commission: "members.permission.viewCommission",
  can_manage_employees: "members.permission.manageEmployees",
  can_edit_others_tasks: "members.permission.editOthersTasks",
  can_delete_others_tasks: "members.permission.deleteOthersTasks",
  can_approve_registration: "members.permission.approveRegistration"
};

let membersSnapshotPromise = null;
function loadMembersSnapshot() {
  if (!membersSnapshotPromise) {
    membersSnapshotPromise = fetchSnapshot(MEMBERS_SNAPSHOT_URL, "members.json", "home/mock members");
  }
  return membersSnapshotPromise;
}

function isR9Member(member) {
  return !!member && typeof member.id === "string" && typeof member.name === "string" &&
    typeof member.email === "string" && typeof member.phone === "string" && typeof member.position === "string" &&
    typeof member.roleName === "string" && ["active", "departed"].includes(member.status) &&
    Array.isArray(member.departments) && member.departments.every((name) => typeof name === "string") &&
    !!member.tasks && Array.isArray(member.tasks.tasking) && Array.isArray(member.tasks.tasked);
}

function isR9MembersSnapshot(snapshot) {
  return !!snapshot && Array.isArray(snapshot.members) && (snapshot.__live === true || snapshot.members.length > 0) && snapshot.members.every(isR9Member) &&
    Array.isArray(snapshot.departments) && snapshot.departments.every((department) =>
      department && typeof department.id === "string" && typeof department.name === "string" && Array.isArray(department.memberIds)) &&
    Array.isArray(snapshot.roles) && snapshot.roles.every((role) =>
      role && typeof role.id === "string" && typeof role.name === "string" && !!role.permissions &&
      R9_PERMISSION_KEYS.every((key) => typeof role.permissions[key] === "boolean")) &&
    !!snapshot.reviews && Array.isArray(snapshot.reviews.pending) && Array.isArray(snapshot.reviews.history);
}

function cloneMemberTasks(tasks) {
  return {
    tasking: tasks.tasking.map((task) => ({ ...task })),
    tasked: tasks.tasked.map((task) => ({ ...task }))
  };
}

function cloneTeamExtras(snapshot) {
  const companiesValid = Array.isArray(snapshot?.companies) && snapshot.companies.every((company) =>
    company && typeof company.id === "string" && typeof company.name === "string" &&
    typeof company.featureAiBatch === "boolean" && isNum(company.employeeCount) && typeof company.createdAt === "string");
  const companies = companiesValid
    ? snapshot.companies.map((company) => ({ ...company }))
    : [];
  const updateLogsValid = Array.isArray(snapshot?.teamUpdateLogs) && snapshot.teamUpdateLogs.every((entry) =>
    entry && typeof entry.id === "string" && typeof entry.author === "string" &&
    typeof entry.summary === "string" && typeof entry.detail === "string" &&
    typeof entry.createdAt === "string" && typeof entry.edited === "boolean" && Array.isArray(entry.comments));
  const updateLogs = updateLogsValid
    ? snapshot.teamUpdateLogs.map((entry) => ({
        ...entry,
        comments: entry.comments.map((comment) => ({ ...comment }))
      }))
    : [];
  const joinHistoryValid = Array.isArray(snapshot?.joinHistory) && snapshot.joinHistory.every((entry) =>
    entry && typeof entry.id === "string" && typeof entry.employee === "string" &&
    typeof entry.company === "string" && typeof entry.appliedAt === "string" &&
    typeof entry.reviewedAt === "string" && typeof entry.approved === "boolean");
  const joinHistory = joinHistoryValid
    ? snapshot.joinHistory.map((entry) => ({ ...entry }))
    : [];
  const commissionValid = Array.isArray(snapshot?.commission);
  const commission = commissionValid
    ? snapshot.commission.map((entry) => ({ ...entry }))
    : [];
  if (snapshot) {
    if (!companiesValid) warnProviderFallback("team-extras.json:companies", "empty companies");
    if (!updateLogsValid) warnProviderFallback("team-extras.json:teamUpdateLogs", "empty update logs");
    if (!joinHistoryValid) warnProviderFallback("team-extras.json:joinHistory", "empty join history");
    if (!commissionValid) warnProviderFallback("team-extras.json:commission", "empty commission");
  }
  return { companies, updateLogs, joinHistory, commission };
}

function buildR9MembersData(snapshot, home, teamExtras) {
  const departmentByName = new Map(snapshot.departments.map((department) => [department.name, department]));
  const roleByName = new Map(snapshot.roles.map((role) => [role.name, role]));
  const members = snapshot.members.map((member) => {
    const department = departmentByName.get(member.departments[0]) ?? snapshot.departments[0];
    const role = roleByName.get(member.roleName) ?? snapshot.roles[0];
    return {
      ...member,
      dept: department?.id ?? "",
      departmentName: member.departments.join("、") || "—",
      role: role?.id ?? "",
      commission: "—",
      tasks: cloneMemberTasks(member.tasks)
    };
  });
  const active = members.filter((member) => member.status === "active").length;
  const pending = snapshot.reviews.pending.map((review) => ({ ...review }));
  if (!Array.isArray(snapshot.reviews.joinPending)) warnProviderFallback("members.json:reviews.joinPending", "empty join requests");
  const departments = snapshot.departments.map((department) => ({
    ...department,
    manager: department.manager || "—",
    icon: "icon-dept-marketing",
    memberIds: department.memberIds.slice()
  }));
  const roles = [
    {
      id: "admin",
      nameKey: "members.permission.roleAdmin",
      editable: false,
      grants: Object.fromEntries(R9_PERMISSION_KEYS.map((key) => [key, true]))
    },
    ...snapshot.roles.map((role) => ({
      id: role.id,
      name: role.name,
      editable: true,
      grants: { ...role.permissions }
    }))
  ];

  return {
    unread: home?.unread ?? mock.unread,
    currentUserName: home?.currentUser?.name ?? "",
    summary: {
      total: members.length,
      active,
      reviewPending: pending.length,
      departed: members.length - active
    },
    tabs: [
      { key: "members", active: true, update: false },
      { key: "permissions", active: false, update: false },
      { key: "departments", active: false, update: false },
      { key: "reviews", active: false, update: pending.length > 0 },
      { key: "commission", active: false, update: false },
      { key: "updates", active: false, update: false },
      { key: "companies", active: false, update: false }
    ],
    members,
    form: {
      defaults: {
        name: "",
        position: "",
        email: "",
        joinedAt: hongKongDateInput(),
        dept: departments[0]?.id ?? "",
        role: snapshot.roles[0]?.id ?? ""
      },
      departments: departments.map(({ id, name }) => ({ id, name })),
      roles: snapshot.roles.map(({ id, name }) => ({ id, name }))
    },
    reviews: pending,
    reviewHistory: snapshot.reviews.history.map((review) => ({ ...review })),
    joinPending: Array.isArray(snapshot.reviews.joinPending) ? snapshot.reviews.joinPending.map((review) => ({ ...review })) : [],
    joinHistory: teamExtras.joinHistory,
    commission: teamExtras.commission,
    commissionSales: members
      .filter((member) => member.roleName === "銷售")
      .map(({ id, name }) => ({ id, name })),
    updateLogs: teamExtras.updateLogs,
    companies: teamExtras.companies,
    departments,
    permissions: {
      rows: R9_PERMISSION_KEYS.map((id) => ({ id, labelKey: R9_PERMISSION_LABEL_KEYS[id] })),
      roles
    }
  };
}

export async function getTeamMembersData() {
  const [snapshot, home, extrasSnapshot] = await Promise.all([loadMembersSnapshot(), getHomeData(), loadTeamExtrasSnapshot()]);
  const teamExtras = cloneTeamExtras(extrasSnapshot);
  if (isR9MembersSnapshot(snapshot)) return buildR9MembersData(snapshot, home, teamExtras);
  if (snapshot) warnProviderFallback("members.json", "home/mock members");
  return buildFallbackTeamMembersData(home);
}

// ---------- bizflow 客户管理屏(Figma 619:60662)数据契约 ----------
// customers.json 已提供列表与 per-customer detail 只读快照。
// mock 仅是fetch/契约整体失效时的明示离线回退,不用来补真数空值。
const customersMock = {
  customers: [
    { id: "c001", name: "陳大文", phone: "+852 9123 4567", source: "shopify", joinedAt: "2026/02/03", imei: "8613700000001", orderCount: 5 },
    { id: "c002", name: "Vicky Chan", phone: "+853 5600 8904", source: "instagram", joinedAt: "2026/02/11", imei: "8613700000002", orderCount: 3 },
    { id: "c003", name: "Marco Tang", phone: "+852 6123 0098", source: "referral", joinedAt: "2026/02/18", imei: "8613700000003", orderCount: 1 },
    { id: "c004", name: "Ka Yan Wong", phone: "+852 9988 1122", source: "website", joinedAt: "2026/02/25", imei: "8613700000004", orderCount: 8 },
    { id: "c005", name: "Peter Lee", phone: "+852 6677 3344", source: "walkin", joinedAt: "2026/03/02", imei: "8613700000005", orderCount: 2 },
    { id: "c006", name: "Ivy Ho", phone: "+853 6789 0011", source: "shopify", joinedAt: "2026/03/09", imei: "8613700000006", orderCount: 4 },
    { id: "c007", name: "Ben Cheung", phone: "+852 9321 6540", source: "instagram", joinedAt: "2026/03/16", imei: "8613700000007", orderCount: 0 },
    { id: "c008", name: "Grace Lam", phone: "+852 6012 3456", source: "referral", joinedAt: "2026/03/23", imei: "8613700000008", orderCount: 6 },
    { id: "c009", name: "Leo Fung", phone: "+852 9456 7891", source: "website", joinedAt: "2026/03/30", imei: "8613700000009", orderCount: 2 },
    { id: "c010", name: "Queenie Ng", phone: "+852 6234 5678", source: "walkin", joinedAt: "2026/04/06", imei: "8613700000010", orderCount: 1 },
    { id: "c011", name: "Tommy Yip", phone: "+853 5312 9087", source: "shopify", joinedAt: "2026/04/13", imei: "8613700000011", orderCount: 7 },
    { id: "c012", name: "Fiona Chow", phone: "+852 9765 4321", source: "instagram", joinedAt: "2026/04/20", imei: "8613700000012", orderCount: 3 },
    { id: "c013", name: "Ricky Ma", phone: "+852 6890 1234", source: "referral", joinedAt: "2026/04/27", imei: "8613700000013", orderCount: 1 },
    { id: "c014", name: "曾嘉欣", phone: "+852 9012 3987", source: "website", joinedAt: "2026/05/04", imei: "8613700000014", orderCount: 4 },
    { id: "c015", name: "Samuel Kwok", phone: "+852 6543 2109", source: "walkin", joinedAt: "2026/05/11", imei: "8613700000015", orderCount: 0 },
    { id: "c016", name: "Nicole Yeung", phone: "+853 5987 6543", source: "shopify", joinedAt: "2026/05/18", imei: "8613700000016", orderCount: 9 },
    { id: "c017", name: "Alan Poon", phone: "+852 9234 5610", source: "instagram", joinedAt: "2026/05/25", imei: "8613700000017", orderCount: 2 },
    { id: "c018", name: "Winnie Lau", phone: "+852 6456 7823", source: "referral", joinedAt: "2026/06/01", imei: "8613700000018", orderCount: 5 },
    { id: "c019", name: "Jason Ip", phone: "+852 9678 9012", source: "website", joinedAt: "2026/06/08", imei: "8613700000019", orderCount: 1 },
    { id: "c020", name: "Cherry Sze", phone: "+852 6789 0345", source: "walkin", joinedAt: "2026/06/15", imei: "8613700000020", orderCount: 3 }
  ]
};

function isValidCustomer(x) {
  return !!x && typeof x.id === "string" && typeof x.name === "string" && typeof x.phone === "string";
}

function customerSnapshotGroups(customers) {
  const byId = new Map(customers.map((customer) => [customer.id, customer]));
  const source = customers.map((customer) => ({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    phone_mainland: "",
    email: customer.detail?.email || "",
    address: customer.detail?.shippingAddress || "",
    car_make: "",
    car_model: customer.detail?.carModel || "",
    created_at: customer.joinedAt,
    parent_id: null,
    merge_exclude: []
  }));
  return buildCustomerGroups(source).groups.map((group) => {
    const rows = group.allCids.map((id) => byId.get(id)).filter(Boolean);
    const primary = byId.get(group.id) ?? rows[0];
    const orders = rows.flatMap((customer) => customer.detail?.orders ?? [])
      .map((order) => ({ ...order }))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const joinedAt = rows.map((customer) => customer.joinedAt).filter(Boolean)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? primary.joinedAt;
    return {
      ...primary,
      id: group.id,
      groupCids: group.allCids.slice(),
      hasEmail: group.allEmails.length > 0,
      hasPhone: group.allPhones.length > 0,
      hasImei: rows.some((customer) => Boolean(String(customer.imei || "").trim())),
      name: primary.name || group.allNames[0] || "",
      phone: primary.phone || group.allPhones[0] || "",
      source: customerSourceFromInvoices(orders, { normalized: true }),
      joinedAt,
      imei: rows.find((customer) => customer.imei)?.imei || "",
      orderCount: orders.length,
      detail: {
        ...primary.detail,
        totalAmount: rows.reduce((sum, customer) => sum + (Number(customer.detail?.totalAmount) || 0), 0),
        firstOrderDate: orders.at(-1)?.date || primary.detail?.firstOrderDate || "",
        email: primary.detail?.email || group.allEmails[0] || "",
        carModel: primary.detail?.carModel || group.allCarModels[0] || null,
        shippingAddress: primary.detail?.shippingAddress || group.allAddresses[0] || "",
        order: orders[0] ?? null,
        orders
      }
    };
  });
}

const CUSTOMERS_SNAPSHOT_URL = new URL("./snapshots/customers.json", import.meta.url);

let customersSnapshotPromise = null;
let groupedCustomersPromise = null;
function loadCustomersSnapshot() {
  if (!customersSnapshotPromise) {
    customersSnapshotPromise = fetchSnapshot(CUSTOMERS_SNAPSHOT_URL, "customers.json", "20-row customer mock");
  }
  return customersSnapshotPromise;
}

function loadGroupedCustomers() {
  if (!groupedCustomersPromise) {
    groupedCustomersPromise = loadCustomersSnapshot().then((snap) => {
      const customersOk = Array.isArray(snap?.customers) && (snap.__live === true || snap.customers.length > 0) && snap.customers.every(isValidCustomer);
      if (snap && !customersOk) warnProviderFallback("customers.json:customers", "20-row customer mock");
      const customers = customersOk ? snap.customers : customersMock.customers.map((customer) => ({ ...customer }));
      return customerSnapshotGroups(customers);
    });
  }
  return groupedCustomersPromise;
}

export async function getCustomersPageData() {
  const grouped = await loadGroupedCustomers();
  // Mirrors bizflow_samyung/src/views/Customers.jsx:571-574: list keeps IMEI-only customers.
  // Mirrors Customers.jsx:516,597: default customer sort is created DESC.
  const customers = grouped.filter((customer) => customer.hasEmail || customer.hasPhone || customer.hasImei)
    .sort((left, right) => Date.parse(String(right.joinedAt || "").replaceAll("/", "-")) -
      Date.parse(String(left.joinedAt || "").replaceAll("/", "-")));
  // Mirrors bizflow_samyung/src/views/Dashboard.jsx:98-101: KPI requires email or phone.
  const dashboardCustomerCount = grouped.filter((customer) => customer.hasEmail || customer.hasPhone).length;
  return { customers, dashboardCustomerCount };
}

const WARRANTY_SNAPSHOT_URL = new URL("./snapshots/warranty.json", import.meta.url);

let warrantySnapshotPromise = null;
function loadWarrantySnapshot() {
  if (!warrantySnapshotPromise) {
    warrantySnapshotPromise = fetchSnapshot(WARRANTY_SNAPSHOT_URL, "warranty.json", "empty warranty list");
  }
  return warrantySnapshotPromise;
}

function isValidWarrantyItem(item) {
  return !!item &&
    ["no", "product", "customer", "phone", "purchaseDate", "expiry"].every((key) => typeof item[key] === "string") &&
    (item.customerId === null || typeof item.customerId === "string") &&
    typeof item.warrantyMonths === "number";
}

export async function getWarrantyData() {
  const snapshot = await loadWarrantySnapshot();
  const itemsValid = Array.isArray(snapshot?.items) && snapshot.items.every(isValidWarrantyItem);
  if (snapshot && !itemsValid) warnProviderFallback("warranty.json:items", "empty warranty list");
  if (!itemsValid) return { items: [] };
  const customers = await loadGroupedCustomers();
  const customerIdMap = new Map();
  customers.forEach((customer) => {
    const ids = Array.isArray(customer.groupCids) ? customer.groupCids : [customer.id];
    ids.forEach((id) => customerIdMap.set(String(id), customer.id));
  });
  const today = Date.parse(`${hongKongDateInput()}T00:00:00Z`);
  // Mirrors bizflow_samyung/src/context/AppContext.jsx:429-447: known customer and [-30, +365] days only.
  const items = snapshot.items.flatMap((item) => {
    const customerId = customerIdMap.get(String(item.customerId || ""));
    const expiry = Date.parse(`${item.expiry.replaceAll("/", "-")}T00:00:00Z`);
    const daysLeft = Math.ceil((expiry - today) / 86400000);
    return customerId && Number.isFinite(daysLeft) && daysLeft >= -30 && daysLeft <= 365
      ? [{ ...item, customerId }]
      : [];
  });
  return { items };
}

// bizflow 客户详情屏(Figma 676:96729)数据契约。
// R8a 起优先使用 snapshots/customers.json 的整块 detail;快照缺失时才回退下方离线样稿。
const customerDetailSample = {
  totalAmount: 2434,
  firstOrderDate: "2026/06/09",
  email: "3182648@mail.com",
  editEmail: "234234@gmail.com",
  carModel: "tesla model 3",
  shippingAddress: "一鳴路, 粉嶺, 新界 香港特別行政區",
  order: {
    no: "#1241343",
    status: "paid",
    shippingStatus: "unshipped",
    source: "Framer",
    storeAddress: "香港門店地址",
    pickupTime: "2026/06/32 18:30",
    productName: "商品名稱",
    quantity: 1,
    price: 2134,
    date: "2026/06/32"
  },
  orders: [{
    no: "#1241343",
    status: "paid",
    shippingStatus: "unshipped",
    source: "Framer",
    productName: "商品名稱",
    quantity: 1,
    price: 2134,
    date: "2026/06/32"
  }]
};

const isNullableString = (value) => value === null || typeof value === "string";

function isValidCustomerOrder(order) {
  return order === null || (!!order && typeof order === "object" && !Array.isArray(order) &&
    ["no", "status", "shippingStatus", "source", "productName", "date"].every((key) => typeof order[key] === "string") &&
    typeof order.quantity === "number" && typeof order.price === "number");
}

function isValidCustomerDetail(detail) {
  return !!detail && typeof detail.totalAmount === "number" &&
    ["firstOrderDate", "email", "carModel", "shippingAddress"].every((key) => isNullableString(detail[key])) &&
    isValidCustomerOrder(detail.order) &&
    Array.isArray(detail.orders) && detail.orders.every((order) => order !== null && isValidCustomerOrder(order));
}

function cloneCustomerDetail(detail) {
  return {
    ...detail,
    order: detail.order ? { ...detail.order } : null,
    orders: detail.orders.map((order) => ({ ...order }))
  };
}

export async function getCustomerDetailData(id) {
  const page = await getCustomersPageData();
  const customer = page.customers.find((row) => row.id === id);
  if (!customer) return null;
  const detailValid = isValidCustomerDetail(customer?.detail);
  if (!detailValid) warnProviderFallback(`customers.json:detail(${id})`, "customer detail sample");
  const detail = detailValid ? customer.detail : customerDetailSample;
  return {
    customer,
    detail: cloneCustomerDetail(detail)
  };
}

// bizflow 站訂單管理屏数据契约(Figma 450:11902 卡片列表)。
// mock 值 = Figma 样稿值(customer/phone/product/qty/date/amount 逐字段照 Order 组件 509:19630 稿子写死),
//   刻意保持"能被一眼认出是样稿"的形态(date=2026/06/32 非法日期、amount=HKD$ 23113 占位、多行同值只状态/来源不同),
//   避免被误当真数;它们只在 orders.json 与 home.ordersPage 都不可用时作离线兜底。
// mock 形状 = 正式契约,不许改形状;R10 真数据走独立 orders.json,失败才整块回退 home.ordersPage/mock。
const ORDER_SAMPLE = { customer: "Vincent", phone: "+86 1887266688", product: "DCPro+AC+包装盒", qty: "×2", date: "2026/06/32", amount: "HKD$ 23113" };
// 状态枚举 completed / in-progress / cancelled = Order 组件三态(√ 蓝 / 进行中 绿 / cancelled 灰,cancelled 打印禁用)。
const ORDER_STATUS_CYCLE = ["completed", "completed", "in-progress", "completed", "cancelled", "completed", "completed", "completed"];
const ORDER_CHANNEL_CYCLE = ["Framer", "Framer", "Online Store", "Framer", "Framer", "Online Store", "Framer", "Framer"];
const ordersPageMock = {
  dateRange: { from: "2026/04/21", to: "2026/05/21" }, // Figma 工具行日期范围样稿值(静态展示,无原型日历)
  sources: ["Framer", "Online Store"], // 訂單來源 筛选可选渠道(全部 + 这些);Figma 屏只出现 Framer,补 Online Store 供筛选联动演示
  // 40 行 = 足以触发列表溢出分页;每页容量由订单页按当前容器可见高度计算,不进数据契约。
  orders: Array.from({ length: 40 }, (_, i) => ({
    status: ORDER_STATUS_CYCLE[i % ORDER_STATUS_CYCLE.length],
    channel: ORDER_CHANNEL_CYCLE[i % ORDER_CHANNEL_CYCLE.length],
    ...ORDER_SAMPLE
  }))
};

const isOrderRow = (row) => !!row &&
  ["customer", "phone", "status", "channel", "product", "qty", "date", "amount"]
    .every((key) => typeof row[key] === "string");
const withOrderIds = (orders) => orders.map((order, index) => ({ id: order.id ?? `order-${index + 1}`, ...order }));

const ORDERS_SNAPSHOT_URL = new URL("./snapshots/orders.json", import.meta.url);
const HOME_ORDER_METRICS_URL = new URL("./snapshots/home-order-metrics.json", import.meta.url);

let ordersSnapshotPromise = null;
let homeOrderMetricsPromise = null;
function loadOrdersSnapshot() {
  if (!ordersSnapshotPromise) {
    ordersSnapshotPromise = fetchSnapshot(ORDERS_SNAPSHOT_URL, "orders.json", "home.ordersPage/orders mock");
  }
  return ordersSnapshotPromise;
}

function loadHomeOrderMetricsSnapshot() {
  if (!homeOrderMetricsPromise) {
    homeOrderMetricsPromise = fetchSnapshot(HOME_ORDER_METRICS_URL, "home-order-metrics.json", "null home metrics");
  }
  return homeOrderMetricsPromise;
}

export async function getHomeOrderMetricRows() {
  const snapshot = await loadHomeOrderMetricsSnapshot();
  if (!snapshot) return null;
  if (snapshot.source !== "orders.json" || !Array.isArray(snapshot.rows)) {
    warnProviderFallback("home-order-metrics.json", "null home metrics");
    return null;
  }
  const valid = snapshot.rows.every((row) => Array.isArray(row) && (row.length === 6 || row.length === 7) &&
    typeof row[0] === "string" && typeof row[1] === "string" && typeof row[2] === "number" &&
    typeof row[3] === "string" && typeof row[4] === "string" && typeof row[5] === "string" &&
    (row.length === 6 || typeof row[6] === "string"));
  if (!valid) {
    warnProviderFallback("home-order-metrics.json:rows", "null home metrics");
    return null;
  }
  return snapshot.rows.map(([date, status, paymentTotal, shippingStatus, timelineTime, timelineLabel, shippedAt = ""]) => ({
    date,
    status,
    detail: {
      paymentTotal,
      shippingStatus,
      shippedAt,
      timeline: timelineTime && timelineLabel ? [{ time: timelineTime, label: timelineLabel }] : []
    }
  }));
}

function isOrdersPageSnapshot(source) {
  return !!source && typeof source === "object" && !Array.isArray(source) &&
    Array.isArray(source.orders) && (source.__live === true || source.orders.length > 0) && source.orders.every((row) =>
      isOrderRow(row) && isValidOrderDetail(row.detail)) &&
    !!source.dateRange && typeof source.dateRange.from === "string" && typeof source.dateRange.to === "string" &&
    Array.isArray(source.sources) && (source.__live === true || source.sources.length > 0) && source.sources.every((value) => typeof value === "string");
}

export async function getOrdersPageData() {
  const ordersSnapshot = await loadOrdersSnapshot();
  if (isOrdersPageSnapshot(ordersSnapshot)) {
    return {
      orders: withOrderIds(ordersSnapshot.orders),
      dateRange: { ...ordersSnapshot.dateRange },
      sources: ordersSnapshot.sources.slice()
    };
  }

  if (ordersSnapshot) warnProviderFallback("orders.json", "home.ordersPage");

  const homeOrdersPage = (await loadSnapshot())?.ordersPage;
  const homeOrdersValid = isOrdersPageSnapshot(homeOrdersPage);
  if (!homeOrdersValid) warnProviderFallback("home.json:ordersPage", "orders mock");
  const source = homeOrdersValid ? homeOrdersPage : ordersPageMock;
  return {
    orders: withOrderIds(source.orders),
    dateRange: { ...source.dateRange },
    sources: source.sources.slice()
  };
}

const orderDetailSample = {
  orderNo: "#1234",
  time: "17:32",
  shippingStatus: "unshipped",
  pickup: {
    method: "pickup",
    address: "香港門市地址",
    appointment: "2026/06/32 18:30"
  },
  items: [
    { id: "sample-line-1", nameKey: "orders.sample.productName", quantity: 1, price: 2134 }
  ],
  fees: {
    shipping: 0,
    deposit: 24,
    discount: 0,
    service: 0
  },
  paymentTotal: 2154,
  salesperson: "",
  email: "234234@gmail.com",
  carModel: "tesla model 3",
  shippingAddress: "一鳴路, 粉嶺, 新界 香港特別行政區",
  trackingNo: "SF143241431411",
  timeline: []
};

function isValidOrderDetail(detail) {
  const textKeys = ["orderNo", "time", "shippingStatus"];
  const nullableTextKeys = ["carrier", "trackingNo", "salesperson", "email", "shippingAddress"];
  const feeKeys = ["shipping", "deposit", "discount", "service"];
  return !!detail && textKeys.every((key) => typeof detail[key] === "string") &&
    nullableTextKeys.every((key) => isNullableString(detail[key])) &&
    isNullableString(detail.carModel) && typeof detail.paymentTotal === "number" &&
    Array.isArray(detail.items) && detail.items.every((item) =>
      !!item && typeof item.name === "string" && typeof item.quantity === "number" && typeof item.price === "number") &&
    !!detail.fees && typeof detail.fees === "object" && !Array.isArray(detail.fees) &&
    feeKeys.every((key) => typeof detail.fees[key] === "number") &&
    Array.isArray(detail.timeline) && detail.timeline.every((item) =>
      !!item && typeof item.label === "string" && typeof item.time === "string");
}

function cloneOrderDetail(detail) {
  const cloned = {
    ...detail,
    items: detail.items.map((item) => ({ ...item })),
    fees: { ...detail.fees },
    timeline: Array.isArray(detail.timeline) ? detail.timeline.map((item) => ({ ...item })) : []
  };
  if (detail.pickup) cloned.pickup = { ...detail.pickup };
  return cloned;
}

export async function getOrderDetailData(id) {
  const ordersPage = await getOrdersPageData();
  const order = ordersPage.orders.find((row) => row.id === id);
  if (!order) return null;
  const detailValid = isValidOrderDetail(order?.detail);
  if (!detailValid) warnProviderFallback(`orders.json:detail(${id})`, "order detail sample");
  const detail = detailValid ? order.detail : orderDetailSample;
  return {
    order,
    detail: cloneOrderDetail(detail)
  };
}

export async function getOrderCreateData() {
  const [inventory, customers] = await Promise.all([getInventoryPageData(), getCustomersPageData()]);
  const productGroups = inventory.products.map((product) => ({
    id: product.id,
    name: product.name,
    options: (product.detail?.variants.length ? product.detail.variants : [product]).map((option) => ({
      id: option.id,
      label: option.name,
      price: option.price
    }))
  }));
  return {
    customers: customers.customers.slice(),
    productGroups
  };
}

// ---------- bizflow 商品庫存屏(Figma 676:99455 / 676:99575)数据契约 ----------
// R9 优先读 inventory.json;mock 仅在整份快照无效时作离线回退。
const inventoryPageMock = {
  pageSize: 6,
  categories: ["adapter", "portable", "cable", "charger"],
  products: [
    { id: "inv-ac-adaptor-mini", name: "AC Adaptor Mini", price: 678, stock: 2, status: "enabled", category: "adapter" },
    { id: "inv-dc-adaptor-pro-gbt-ccs2", name: "DC Adaptor Pro GBT-CCS2", price: 6588, stock: 98, status: "enabled", category: "adapter" },
    { id: "inv-ccs1-ccs2-dc-adapter", name: "CCS1-CCS2 DC Adapter", price: 6588, stock: 12, status: "draft", category: "adapter" },
    { id: "inv-type2-portable-charger", name: "Type2 Portable Charger", price: 3788, stock: 6, status: "enabled", category: "portable" },
    { id: "inv-gbt-portable-charger", name: "GBT Portable Charger", price: 3988, stock: 0, status: "draft", category: "portable" },
    { id: "inv-type2-charging-cable", name: "Type2 Charging Cable", price: 688, stock: 20, status: "enabled", category: "cable" },
    { id: "inv-cee-charging-cable", name: "CEE Charging Cable", price: 788, stock: 9, status: "enabled", category: "cable" },
    { id: "inv-type2-wall-charger", name: "Type2 Wall Charger", price: 4288, stock: 4, status: "enabled", category: "charger" },
    { id: "inv-gbt-wall-charger", name: "GBT Wall Charger", price: 4688, stock: 1, status: "draft", category: "charger" },
    { id: "inv-ccs1-nacs-dc-adapter", name: "CCS1-NACS DC Adapter", price: 6588, stock: 5, status: "enabled", category: "adapter" },
    { id: "inv-gbt-type2-ac-adapter", name: "GBT-Type2 AC Adapter", price: 2388, stock: 8, status: "draft", category: "adapter" },
    { id: "inv-portable-ev-charger-pro", name: "Portable EV Charger Pro", price: 4988, stock: 3, status: "enabled", category: "portable" }
  ]
};

const inventoryDetailMock = {
  product: {
    id: "inv-dc-adaptor-pro-gbt-ccs2",
    breadcrumbName: "DC Adaptor Pro GBT-CCS2",
    name: "DC  aAdaptor Pro GBT-CCS2",
    productId: "DC34629349629",
    stock: 98,
    status: "enabled"
  },
  subitems: [
    { id: "sub-01", nameKey: "inventory.subitem.sampleName", quantity: 1, price: 2134, editPrice: 2588, warrantyYears: 1, warehouses: [{ key: "hk", quantity: 23 }, { key: "zhuhai", quantity: 23 }] },
    { id: "sub-02", nameKey: "inventory.subitem.sampleName", quantity: 1, price: 2134, editPrice: 2588, warrantyYears: 1, warehouses: [{ key: "hk", quantity: 23 }, { key: "zhuhai", quantity: 23 }] }
  ],
  series: [{ id: "series-all", nameKey: "inventory.series.all" }]
};

const isInventoryProduct = (x) => x && typeof x.id === "string" && typeof x.name === "string" && typeof x.status === "string";

const INVENTORY_SNAPSHOT_URL = new URL("./snapshots/inventory.json", import.meta.url);
let inventorySnapshotPromise = null;

function loadInventorySnapshot() {
  if (!inventorySnapshotPromise) {
    inventorySnapshotPromise = fetchSnapshot(INVENTORY_SNAPSHOT_URL, "inventory.json", "inventory mock/empty metrics");
  }
  return inventorySnapshotPromise;
}

function isInventoryDetail(detail) {
  return !!detail && typeof detail === "object" && !Array.isArray(detail) &&
    Array.isArray(detail.variants) && detail.variants.every(isInventoryProduct) &&
    Array.isArray(detail.warehouses) && detail.warehouses.every((row) =>
      row && (row.key === "hk" || row.key === "zh") && typeof row.quantity === "number") &&
    Array.isArray(detail.collections) && detail.collections.every((name) => typeof name === "string");
}

function isInventorySnapshot(snapshot) {
  return !!snapshot && Array.isArray(snapshot.buckets) && snapshot.buckets.every((name) => typeof name === "string") &&
    Array.isArray(snapshot.categoriesRaw) && snapshot.categoriesRaw.every((name) => typeof name === "string") &&
    Array.isArray(snapshot.products) && (snapshot.__live === true || snapshot.products.length > 0) && snapshot.products.every((product) =>
      isInventoryProduct(product) && (product.parentId === null || typeof product.parentId === "string") &&
      typeof product.category === "string" && typeof product.bucket === "string" &&
      typeof product.price === "number" && typeof product.stock === "number" &&
      typeof product.imageUrl === "string" && isInventoryDetail(product.detail));
}

function cloneInventoryProduct(product) {
  return {
    ...product,
    detail: {
      ...product.detail,
      collections: product.detail.collections.slice(),
      tags: Array.isArray(product.detail.tags) ? product.detail.tags.slice() : [],
      images: Array.isArray(product.detail.images) ? product.detail.images.slice() : [],
      warehouses: product.detail.warehouses.map((row) => ({ ...row })),
      variants: product.detail.variants.map((variant) => ({ ...variant }))
    }
  };
}

export async function getInventoryPageData() {
  const snapshot = await loadInventorySnapshot();
  if (isInventorySnapshot(snapshot)) {
    const pageSizeValid = Number.isInteger(snapshot.pageSize) && snapshot.pageSize > 0;
    if (!pageSizeValid) warnProviderFallback("inventory.json:pageSize", "inventory mock pageSize");
    return {
      pageSize: pageSizeValid ? snapshot.pageSize : inventoryPageMock.pageSize,
      // 列表用已拍板的 5 桶;生产原始类目保留在 product.category 供详情展示。
      categories: snapshot.buckets.slice(),
      products: snapshot.products.filter((product) => product.parentId === null).map(cloneInventoryProduct),
      mappingProducts: snapshot.products.map((product) => ({
        id: product.id,
        name: product.name,
        parentId: product.parentId,
        category: product.category
      }))
    };
  }
  if (snapshot) warnProviderFallback("inventory.json", "inventory page mock");
  return {
    pageSize: inventoryPageMock.pageSize,
    categories: inventoryPageMock.categories.slice(),
    products: inventoryPageMock.products.map((product) => ({
      ...product,
      bucket: product.bucket ?? product.category
    })),
    mappingProducts: inventoryPageMock.products.map((product) => ({
      id: product.id,
      name: product.name,
      parentId: null,
      category: product.category
    }))
  };
}

export async function getInventoryMetricProducts() {
  const snapshot = await loadInventorySnapshot();
  if (isInventorySnapshot(snapshot)) return snapshot.products.map(cloneInventoryProduct);
  if (snapshot) warnProviderFallback("inventory.json", "null inventory metrics");
  return null;
}

export async function getInventoryDetailData(id) {
  const page = await getInventoryPageData();
  const snapshot = await loadInventorySnapshot();
  const snapshotProductsById = isInventorySnapshot(snapshot)
    ? new Map(snapshot.products.map((product) => [product.id, product]))
    : new Map();
  const listProduct = page.products.find((product) => product.id === id && isInventoryProduct(product));
  if (listProduct?.detail && isInventoryDetail(listProduct.detail)) {
    const warehouses = listProduct.detail.warehouses.map((row) => ({
      key: row.key,
      quantity: row.quantity,
      updatedAt: row.updatedAt ?? ""
    }));
    return {
      requestedId: id || listProduct.id,
      product: {
        id: listProduct.id,
        breadcrumbName: listProduct.name,
        name: listProduct.name,
        productId: listProduct.detail.productId || listProduct.internalCode || listProduct.id,
        category: listProduct.category,
        stock: listProduct.stock,
        status: listProduct.status,
        imageUrl: listProduct.imageUrl,
        warrantyMonths: listProduct.detail.warrantyMonths
      },
      subitems: listProduct.detail.variants.map((variant) => {
        const variantDetail = snapshotProductsById.get(variant.id)?.detail;
        const variantWarehouses = isInventoryDetail(variantDetail) ? variantDetail.warehouses : [];
        const warehouseByKey = new Map(variantWarehouses.map((row) => [row.key, row]));
        return {
          id: variant.id,
          name: variant.name,
          quantity: variant.stock,
          price: variant.price,
          editPrice: variant.price,
          warrantyYears: Number.isFinite(variantDetail?.warrantyMonths) ? variantDetail.warrantyMonths / 12 : "—",
          warehouses: ["hk", "zh"].map((key) => ({
            key,
            quantity: warehouseByKey.get(key)?.quantity ?? 0,
            updatedAt: warehouseByKey.get(key)?.updatedAt ?? ""
          }))
        };
      }),
      warehouses,
      series: listProduct.detail.collections.map((name, index) => ({ id: `collection-${index + 1}`, name }))
    };
  }
  warnProviderFallback(`inventory.json:detail(${id || "default"})`, "inventory detail mock");
  const base = inventoryDetailMock.product;
  return {
    requestedId: id || base.id,
    product: {
      ...base,
      id: listProduct?.id ?? base.id,
      breadcrumbName: listProduct?.name ?? base.breadcrumbName,
      name: listProduct?.name ?? base.name,
      category: listProduct?.category ?? base.category ?? "—",
      stock: Number.isFinite(listProduct?.stock) ? listProduct.stock : base.stock,
      status: listProduct?.status ?? base.status
    },
    subitems: inventoryDetailMock.subitems.map((subitem) => ({
      ...subitem,
      warehouses: subitem.warehouses.map((row) => ({ ...row }))
    })),
    warehouses: [],
    series: inventoryDetailMock.series.map((item) => ({ ...item }))
  };
}

async function loadGlobalSearchSection(snapshot, loader, pick) {
  try {
    const rows = pick(await loader());
    if (Array.isArray(rows)) return rows;
  } catch {
    // The other search sections remain usable when one live builder fails.
  }
  warnProviderFallback(`global-search:${snapshot}`, "empty search section");
  return null;
}

export async function getGlobalSearchData() {
  const [customers, products, invoices] = await Promise.all([
    loadGlobalSearchSection("customers.json", loadCustomersSnapshot, (snapshot) => snapshot?.customers),
    loadGlobalSearchSection("inventory.json", loadInventorySnapshot, (snapshot) => snapshot?.products),
    loadGlobalSearchSection("orders.json", loadOrdersSnapshot, (snapshot) => snapshot?.orders)
  ]);
  return { customers, products, invoices };
}

// R11 订单域子页快照;无效时只返回空数据,禁止用演示值填充生产缺口。
const NORTHBOUND_SNAPSHOT_URL = new URL("./snapshots/northbound.json", import.meta.url);
const CHARGER_LEADS_SNAPSHOT_URL = new URL("./snapshots/charger-leads.json", import.meta.url);
const ALIASES_SNAPSHOT_URL = new URL("./snapshots/aliases.json", import.meta.url);
const SHOPIFY_LINKS_SNAPSHOT_URL = new URL("./snapshots/shopify-links.json", import.meta.url);
const SUPPLIERS_SNAPSHOT_URL = new URL("./snapshots/suppliers.json", import.meta.url);
const PENDING_DEDUCTION_SNAPSHOT_URL = new URL("./snapshots/pending-deduction.json", import.meta.url);
const EXPENSE_SNAPSHOT_URL = new URL("./snapshots/expense.json", import.meta.url);
const WHATSAPP_SNAPSHOT_URL = new URL("./snapshots/whatsapp.json", import.meta.url);
const OCPP_SNAPSHOT_URL = new URL("./snapshots/ocpp.json", import.meta.url);

const r11SnapshotPromises = new Map();

function loadR11Snapshot(url, cacheKey) {
  if (!r11SnapshotPromises.has(cacheKey)) {
    const snapshot = url.pathname.split("/").pop() || cacheKey;
    r11SnapshotPromises.set(cacheKey, fetchSnapshot(url, snapshot, "empty dataset"));
  }
  return r11SnapshotPromises.get(cacheKey);
}

function isNorthboundStatus(status) {
  return !!status && typeof status.id === "string" && typeof status.label === "string" &&
    typeof status.color === "string" && typeof status.sortOrder === "number";
}

function isNorthboundRecord(record) {
  return !!record && typeof record.id === "string" && typeof record.name === "string" &&
    (record.statusId === null || typeof record.statusId === "string");
}

export async function getNorthboundData() {
  const snapshot = await loadR11Snapshot(NORTHBOUND_SNAPSHOT_URL, "northbound");
  const valid = Array.isArray(snapshot?.statuses) && snapshot.statuses.every(isNorthboundStatus) &&
    Array.isArray(snapshot?.records) && snapshot.records.every(isNorthboundRecord);
  if (!valid) {
    if (snapshot) warnProviderFallback("northbound.json", "empty statuses/records");
    return { statuses: [], records: [] };
  }
  return {
    statuses: snapshot.statuses.map((status) => ({ ...status })),
    records: snapshot.records.map((record) => ({ ...record }))
  };
}

export async function getChargerLeadsData() {
  const snapshot = await loadR11Snapshot(CHARGER_LEADS_SNAPSHOT_URL, "chargerLeads");
  const valid = Array.isArray(snapshot?.leads);
  if (snapshot && !valid) warnProviderFallback("charger-leads.json:leads", "empty leads");
  return { leads: valid ? snapshot.leads.map((lead) => ({ ...lead })) : [] };
}

function isInventoryAlias(alias) {
  return !!alias && typeof alias.id === "string" && typeof alias.aliasName === "string" &&
    typeof alias.skip === "boolean" && typeof alias.verified === "boolean" && typeof alias.note === "string" &&
    Array.isArray(alias.products) && alias.products.every((product) =>
      product && typeof product.product_id === "string" && typeof product.qty === "number") &&
    Array.isArray(alias.productNames);
}

function cloneInventoryAlias(alias) {
  return {
    ...alias,
    products: alias.products.map((product) => ({ ...product })),
    productNames: alias.productNames.slice()
  };
}

export async function getInventoryAliasesData() {
  const snapshot = await loadR11Snapshot(ALIASES_SNAPSHOT_URL, "aliases");
  const valid = Array.isArray(snapshot?.aliases) && snapshot.aliases.every(isInventoryAlias);
  if (snapshot && !valid) warnProviderFallback("aliases.json:aliases", "empty aliases");
  return {
    aliases: valid
      ? snapshot.aliases.map(cloneInventoryAlias)
      : []
  };
}

function isShopifyLink(link) {
  return !!link && ["id", "shopifyVariantId", "shopifyProductId", "shopifySku", "bizflowProductId"]
    .every((key) => typeof link[key] === "string") &&
    (link.bizflowProductName === null || typeof link.bizflowProductName === "string") &&
    typeof link.qty === "number";
}

export async function getShopifyLinksData() {
  const snapshot = await loadR11Snapshot(SHOPIFY_LINKS_SNAPSHOT_URL, "shopifyLinks");
  const valid = Array.isArray(snapshot?.links) && snapshot.links.every(isShopifyLink);
  if (snapshot && !valid) warnProviderFallback("shopify-links.json:links", "empty Shopify links");
  return {
    links: valid
      ? snapshot.links.map((link) => ({ ...link }))
      : []
  };
}

export async function getSuppliersData() {
  const snapshot = await loadR11Snapshot(SUPPLIERS_SNAPSHOT_URL, "suppliers");
  const suppliers = Array.isArray(snapshot?.suppliers) ? snapshot.suppliers : [];
  if (snapshot && !Array.isArray(snapshot.suppliers)) warnProviderFallback("suppliers.json:suppliers", "empty suppliers");
  const validSuppliers = suppliers.filter((supplier) => supplier && typeof supplier.id === "string" && typeof supplier.name === "string");
  if (validSuppliers.length !== suppliers.length) warnProviderFallback("suppliers.json:invalid rows", "drop invalid supplier rows");
  return {
    suppliers: validSuppliers
      .map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        contactUrl: supplier.contactUrl ?? supplier.contact_url ?? "",
        contactPerson: supplier.contactPerson ?? supplier.contact_person ?? "",
        category: supplier.category ?? "",
        note: supplier.note ?? ""
      }))
  };
}

export async function getExpenseData() {
  const snapshot = await loadR11Snapshot(EXPENSE_SNAPSHOT_URL, "expense");
  const valid = Array.isArray(snapshot?.reimbursements);
  if (snapshot && !valid) warnProviderFallback("expense.json:reimbursements", "empty reimbursements");
  const validRows = valid ? snapshot.reimbursements.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
  if (valid && validRows.length !== snapshot.reimbursements.length) warnProviderFallback("expense.json:invalid rows", "drop invalid reimbursements");
  return { reimbursements: validRows.map((item) => ({ ...item })) };
}

const WHATSAPP_SETTING_KEYS = [
  "claudeMode", "openaiBaseUrl", "model", "maxRepliesPerMin", "replyDelayBase",
  "cooldownMinutes", "botPhone", "botName", "bossChatName", "dailyReportHour",
  "knowledge", "chargersPrompt", "locationHintPrompt", "bossPromptChars", "latestExtVersion",
  "waOutboundMode", "metaGraphVersion", "metaPhoneNumberId", "metaWabaId", "metaTtsEnabled",
  "metaTtsRelayUrl", "metaTtsVoiceId", "metaTtsLanguageBoost", "metaTtsPrompt", "updatedAt"
];

function pickWhatsappSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    warnProviderFallback("whatsapp.json:settings", "empty settings");
    return {};
  }
  return WHATSAPP_SETTING_KEYS.reduce((safe, key) => {
    if (Object.hasOwn(settings, key)) safe[key] = settings[key];
    return safe;
  }, {});
}

function cloneWhatsappRows(rows, fields, source) {
  if (!Array.isArray(rows)) {
    warnProviderFallback(`whatsapp.json:${source}`, `empty ${source}`);
    return [];
  }
  const validRows = rows.filter((row) => row && typeof row === "object" && !Array.isArray(row));
  if (validRows.length !== rows.length) warnProviderFallback(`whatsapp.json:${source}`, `drop invalid ${source} rows`);
  return validRows.map((row) => fields.reduce((safe, key) => {
    if (Object.hasOwn(row, key)) safe[key] = Array.isArray(row[key]) ? row[key].slice() : row[key];
    return safe;
  }, {}));
}

// R12 WhatsApp admin snapshot. Credentials are deliberately not part of this provider contract.
export async function getWhatsappData() {
  const snapshot = await loadR11Snapshot(WHATSAPP_SNAPSHOT_URL, "whatsapp");
  const heartbeatValid = snapshot?.heartbeat && typeof snapshot.heartbeat === "object" && !Array.isArray(snapshot.heartbeat);
  if (snapshot && typeof snapshot.generated_at !== "string") warnProviderFallback("whatsapp.json:generated_at", "empty generatedAt");
  if (snapshot && !heartbeatValid) warnProviderFallback("whatsapp.json:heartbeat", "unknown heartbeat");
  return {
    generatedAt: typeof snapshot?.generated_at === "string" ? snapshot.generated_at : "",
    settings: pickWhatsappSettings(snapshot?.settings),
    clients: cloneWhatsappRows(snapshot?.clients, ["clientId", "mode", "version", "ua", "lastSeen"], "clients"),
    heartbeat: heartbeatValid ? {
      status: snapshot.heartbeat.status ?? "unknown",
      errorMessage: snapshot.heartbeat.errorMessage ?? "",
      lastHeartbeatAt: snapshot.heartbeat.lastHeartbeatAt ?? ""
    } : { status: "unknown", errorMessage: "", lastHeartbeatAt: "" },
    whitelist: cloneWhatsappRows(snapshot?.whitelist, ["id", "kind", "value", "note", "active"], "whitelist"),
    messages: cloneWhatsappRows(snapshot?.messages, ["id", "customerId", "role", "content", "channel", "time"], "messages"),
    replies: cloneWhatsappRows(snapshot?.replies, ["id", "customerId", "chatName", "isGroup", "segments", "channel", "time", "deliveredAt"], "replies"),
    unresolved: cloneWhatsappRows(snapshot?.unresolved, ["id", "customerId", "question", "categories", "resolvedAt", "time"], "unresolved"),
    dailyReports: cloneWhatsappRows(snapshot?.dailyReports, ["id", "date", "content", "createdAt"], "dailyReports"),
    logs: cloneWhatsappRows(snapshot?.logs, ["id", "category", "message", "channel", "time"], "logs")
  };
}

function cloneOcppValue(value, fallback, source) {
  const valid = Array.isArray(fallback)
    ? Array.isArray(value)
    : !!value && typeof value === "object" && !Array.isArray(value);
  if (!valid) {
    warnProviderFallback(`ocpp.json:${source}`, `empty ${source}`);
    return typeof structuredClone === "function" ? structuredClone(fallback) : JSON.parse(JSON.stringify(fallback));
  }
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

async function loadOcppSnapshot() {
  return await loadR11Snapshot(OCPP_SNAPSHOT_URL, "ocpp") ?? {};
}

// R12 OCPP admin data is read-only. Authentication tokens never enter this snapshot contract.
export async function getOcppMonitorData() {
  const live = await getLiveOcppMonitorData();
  if (live !== LIVE_OCPP_MISS) return live;
  const snapshot = await loadOcppSnapshot();
  if (Object.keys(snapshot).length && typeof snapshot.generated_at !== "string") warnProviderFallback("ocpp.json:generated_at", "empty generatedAt");
  if (Object.keys(snapshot).length && typeof snapshot.__ocppLogsScope !== "string") warnProviderFallback("ocpp.json:__ocppLogsScope", "empty logs scope");
  return {
    isLive: false,
    generatedAt: typeof snapshot.generated_at === "string" ? snapshot.generated_at : "",
    logsScope: typeof snapshot.__ocppLogsScope === "string" ? snapshot.__ocppLogsScope : "",
    logsDeferred: false,
    piles: cloneOcppValue(snapshot.piles, [], "piles"),
    logs: cloneOcppValue(snapshot["ocpp/logs"], [], "ocpp/logs"),
    commandLogs: cloneOcppValue(snapshot["command-logs"], [], "command-logs"),
    alarms: cloneOcppValue(snapshot.alarms, [], "alarms")
  };
}

export async function getOcppMonitorLogsData() {
  const live = await getLiveOcppMonitorLogsData();
  if (live !== LIVE_OCPP_MISS) return live;
  const snapshot = await loadOcppSnapshot();
  return {
    isLive: false,
    generatedAt: typeof snapshot.generated_at === "string" ? snapshot.generated_at : "",
    logsScope: typeof snapshot.__ocppLogsScope === "string" ? snapshot.__ocppLogsScope : "",
    logs: cloneOcppValue(snapshot["ocpp/logs"], [], "ocpp/logs")
  };
}

export async function getOcppChargingData() {
  const live = await getLiveOcppChargingData();
  if (live !== LIVE_OCPP_MISS) return live;
  const snapshot = await loadOcppSnapshot();
  return {
    stations: cloneOcppValue(snapshot.stations, [], "stations"),
    piles: cloneOcppValue(snapshot.piles, [], "piles"),
    operators: cloneOcppValue(snapshot.operators, [], "operators"),
    orders: cloneOcppValue(snapshot.orders, [], "orders"),
    shareCharges: cloneOcppValue(snapshot["share/charges"], [], "share/charges"),
    shareIncome: cloneOcppValue(snapshot["share/income"], [], "share/income"),
    shareBookings: cloneOcppValue(snapshot["share/bookings"], [], "share/bookings"),
    stationDetails: cloneOcppValue(snapshot.stationDetails, {}, "stationDetails"),
    sharePrices: cloneOcppValue(snapshot.sharePrices, {}, "sharePrices"),
    reports: cloneOcppValue(snapshot.reports, { day: [], month: [], year: [] }, "reports")
  };
}

export async function getOcppUsersData() {
  const live = await getLiveOcppUsersData();
  if (live !== LIVE_OCPP_MISS) return live;
  const snapshot = await loadOcppSnapshot();
  return {
    users: cloneOcppValue(snapshot["charge-users"], [], "charge-users"),
    tags: cloneOcppValue(snapshot["charge-user-tags"], [], "charge-user-tags")
  };
}

export async function getOcppFinanceData() {
  const live = await getLiveOcppFinanceData();
  if (live !== LIVE_OCPP_MISS) return live;
  const snapshot = await loadOcppSnapshot();
  return {
    recharges: cloneOcppValue(snapshot["finance/recharges"], [], "finance/recharges"),
    refunds: cloneOcppValue(snapshot["finance/refunds"], [], "finance/refunds"),
    userMoneyLogs: cloneOcppValue(snapshot["finance/user-money-logs"], [], "finance/user-money-logs"),
    operatorMoneyLogs: cloneOcppValue(snapshot["finance/operator-money-logs"], [], "finance/operator-money-logs"),
    platformMoneyLogs: cloneOcppValue(snapshot["finance/platform-money-logs"], [], "finance/platform-money-logs"),
    withdrawals: cloneOcppValue(snapshot["finance/withdrawals"], [], "finance/withdrawals")
  };
}

function isPendingDeductionInvoice(invoice) {
  return !!invoice && ["orderNo", "customer", "phone", "date", "source"]
    .every((key) => typeof invoice[key] === "string") &&
    typeof invoice.amount === "number" && Array.isArray(invoice.items) && invoice.items.every((item) =>
      item && typeof item.name === "string" && typeof item.qty === "number");
}

export async function getPendingDeductionData() {
  const snapshot = await loadR11Snapshot(PENDING_DEDUCTION_SNAPSHOT_URL, "pendingDeduction");
  const valid = Array.isArray(snapshot?.invoices) && snapshot.invoices.every(isPendingDeductionInvoice);
  if (snapshot && !valid) warnProviderFallback("pending-deduction.json:invoices", "empty pending deductions");
  return {
    invoices: valid
      ? snapshot.invoices.map((invoice) => ({
        ...invoice,
        items: invoice.items.map((item) => ({ ...item }))
      }))
      : []
  };
}

export async function getOrderRevenueSupportData() {
  const [aliasesSnapshot, customersSnapshot, inventorySnapshot] = await Promise.all([
    loadR11Snapshot(ALIASES_SNAPSHOT_URL, "aliases"),
    loadCustomersSnapshot(),
    loadInventorySnapshot()
  ]);
  const aliasesValid = Array.isArray(aliasesSnapshot?.aliases) && aliasesSnapshot.aliases.every(isInventoryAlias);
  const customersValid = Array.isArray(customersSnapshot?.customers) && customersSnapshot.customers.every((customer) =>
    isValidCustomer(customer) && typeof customer.detail?.totalAmount === "number");
  const inventoryValid = isInventorySnapshot(inventorySnapshot);
  if (aliasesSnapshot && !aliasesValid) warnProviderFallback("aliases.json:aliases", "empty revenue aliases");
  if (customersSnapshot && !customersValid) warnProviderFallback("customers.json:customer totals", "empty revenue customers");
  if (inventorySnapshot && !inventoryValid) warnProviderFallback("inventory.json:products", "empty revenue products");
  return {
    aliases: aliasesValid ? aliasesSnapshot.aliases.map(cloneInventoryAlias) : [],
    customers: customersValid ? customersSnapshot.customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.detail.email,
      totalAmount: customer.detail.totalAmount
    })) : [],
    products: inventoryValid ? inventorySnapshot.products.map((product) => ({ id: product.id, name: product.name })) : []
  };
}
