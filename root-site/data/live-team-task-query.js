// Phase 1 deliberately keeps the full-detail packed response out of
// live-query-cache/localStorage. Restore a bounded cache only after phase 2
// ships include_detail=false plus lazy detail fetching.
import { getCurrentUser, getSession, getSupabaseClient, TRANSIENT_AUTH_RESET_EVENT } from "./auth.js";
import { rememberLiveUnreadSummary } from "./live-home-query.js";
import { getReadState, setReadStateAccount } from "./read-state.js";

export const LIVE_TEAM_TASK_MISS = Symbol("live-team-task-miss");

const ARRAY_KEYS = Object.freeze([
  "tasks", "assignees", "feedbacks", "members", "departments", "employeeDepartments",
  "employeeCompanies", "roles", "companies", "taskPending", "companyJoinPending",
  "updateLogs", "updateLogComments"
]);
const NETWORK_REQUESTS = new Map();
let activeUserId = "";

function resetTeamTaskQuery() {
  activeUserId = "";
  NETWORK_REQUESTS.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener(TRANSIENT_AUTH_RESET_EVENT, resetTeamTaskQuery);
}

async function context() {
  const [client, session, currentUser] = await Promise.all([
    getSupabaseClient(), getSession(), getCurrentUser()
  ]);
  if (!client || !session?.user?.id || !currentUser) return null;
  if (activeUserId && activeUserId !== session.user.id) NETWORK_REQUESTS.clear();
  activeUserId = session.user.id;
  setReadStateAccount(currentUser.id || null);
  return { client, currentUser, read: { ...getReadState() }, userId: session.user.id };
}

function completedLimit(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(0, number) : null;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Team task RPC returned a non-object payload");
  }
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(payload[key])) throw new Error(`Team task RPC payload.${key} must be an array`);
  }
  if (!payload.taskStats || typeof payload.taskStats !== "object" || Array.isArray(payload.taskStats)) {
    throw new Error("Team task RPC payload.taskStats must be an object");
  }
  for (const key of ["total", "completed", "open", "abandoned"]) {
    if (!Number.isFinite(Number(payload.taskStats[key]))) {
      throw new Error(`Team task RPC payload.taskStats.${key} must be numeric`);
    }
  }
  if (!payload.unread || typeof payload.unread !== "object" || Array.isArray(payload.unread)) {
    throw new Error("Team task RPC payload.unread must be an object");
  }
  if (!payload.unread.unread || typeof payload.unread.unread !== "object" || Array.isArray(payload.unread.unread)
      || !payload.unread.watermarks || typeof payload.unread.watermarks !== "object" || Array.isArray(payload.unread.watermarks)) {
    throw new Error("Team task RPC payload.unread must contain unread and watermarks objects");
  }
  return payload;
}

async function withCurrentUnread(payload, read) {
  const unread = await rememberLiveUnreadSummary(payload.unread, { read });
  return unread ? { ...payload, unread } : payload;
}

function requestKey(live, query) {
  return JSON.stringify([
    live.userId,
    query.companyId,
    query.completedLimit,
    query.includeDetail,
    live.read.tasks || null,
    live.read.orders || null,
    live.read.messages || null,
    live.read.inventory || null,
    live.read.updates || null
  ]);
}

async function fetchTeamTaskPage(live, query) {
  const key = requestKey(live, query);
  if (NETWORK_REQUESTS.has(key)) return NETWORK_REQUESTS.get(key);
  const promise = live.client.rpc("bizflow_team_task_page", {
    p_company_id: query.companyId || null,
    p_completed_limit: query.completedLimit,
    p_include_detail: query.includeDetail,
    p_tasks_read: live.read.tasks || null,
    p_orders_read: live.read.orders || null,
    p_messages_read: live.read.messages || null,
    p_inventory_read: live.read.inventory || null,
    p_updates_read: live.read.updates || null
  }).then(async (result) => {
    if (result.error) throw result.error;
    const payload = validatePayload(result.data);
    return withCurrentUnread(payload, live.read);
  }).finally(() => {
    NETWORK_REQUESTS.delete(key);
  });
  NETWORK_REQUESTS.set(key, promise);
  return promise;
}

export async function getLiveTeamTaskPage({
  companyId = "",
  completedLimit: limit = null,
  includeDetail = true
} = {}) {
  const live = await context();
  if (!live) return LIVE_TEAM_TASK_MISS;
  const query = {
    companyId: String(companyId || live.currentUser.activeCompanyId || ""),
    completedLimit: completedLimit(limit),
    includeDetail: includeDetail === true
  };
  return fetchTeamTaskPage(live, query);
}
