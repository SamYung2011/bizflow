import { getCurrentUser, getSession, getSupabaseClient, TRANSIENT_AUTH_RESET_EVENT } from "./auth.js";
import { clampLiveUnreadSummary, rememberLiveUnreadSummary } from "./live-home-query.js";
import {
  liveQueryKey,
  markLiveQueryCacheStale,
  readLiveQueryCache,
  writeLiveQueryCache
} from "./live-query-cache.js";
import { LIVE_SNAPSHOT_INVALIDATED_EVENT, LIVE_SNAPSHOT_UPDATED_EVENT } from "./live-snapshot-dependencies.js";
import { getReadState, setReadStateAccount } from "./read-state.js";

export const LIVE_TEAM_TASK_MISS = Symbol("live-team-task-miss");

const TEAM_TASK_NAMESPACE = "team-task-page";
const TEAM_TASK_SNAPSHOTS = Object.freeze(["tasks.json", "members.json", "team-extras.json"]);
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

function invalidatedSnapshots(event) {
  const snapshots = event?.detail?.snapshots;
  return new Set(Array.isArray(snapshots) ? snapshots.map(String) : []);
}

if (typeof window !== "undefined") {
  window.addEventListener(TRANSIENT_AUTH_RESET_EVENT, resetTeamTaskQuery);
  window.addEventListener(LIVE_SNAPSHOT_INVALIDATED_EVENT, (event) => {
    if (!activeUserId) return;
    const snapshots = invalidatedSnapshots(event);
    if (TEAM_TASK_SNAPSHOTS.some((snapshot) => snapshots.has(snapshot))) {
      markLiveQueryCacheStale({ userId: activeUserId, namespace: TEAM_TASK_NAMESPACE });
    }
  });
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
  if (!payload.currentUser || typeof payload.currentUser !== "object" || Array.isArray(payload.currentUser)) {
    throw new Error("Team task RPC payload.currentUser must be an object");
  }
  for (const key of ["employeeId", "name", "activeCompanyId"]) {
    if (typeof payload.currentUser[key] !== "string") {
      throw new Error(`Team task RPC payload.currentUser.${key} must be a string`);
    }
  }
  if (!payload.permissions || typeof payload.permissions !== "object" || Array.isArray(payload.permissions)) {
    throw new Error("Team task RPC payload.permissions must be an object");
  }
  for (const key of ["isBfAdmin", "canDeleteOthersTasks", "featureAiBatch"]) {
    if (typeof payload.permissions[key] !== "boolean") {
      throw new Error(`Team task RPC payload.permissions.${key} must be a boolean`);
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

function notifyTeamTaskUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIVE_SNAPSHOT_UPDATED_EVENT, {
    detail: { snapshots: [...TEAM_TASK_SNAPSHOTS], source: "team-task-query" }
  }));
}

async function fetchTeamTaskPage(live, query, { notify = false } = {}) {
  const requestKey = `${live.userId}:${liveQueryKey({ query, read: live.read })}`;
  if (NETWORK_REQUESTS.has(requestKey)) return NETWORK_REQUESTS.get(requestKey);
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
    writeLiveQueryCache({
      userId: live.userId,
      namespace: TEAM_TASK_NAMESPACE,
      query,
      value: payload
    });
    const value = await withCurrentUnread(payload, live.read);
    if (notify) notifyTeamTaskUpdated();
    return value;
  }).finally(() => {
    NETWORK_REQUESTS.delete(requestKey);
  });
  NETWORK_REQUESTS.set(requestKey, promise);
  return promise;
}

function backgroundTeamTaskRefresh(live, query, { notify = false } = {}) {
  const promise = fetchTeamTaskPage(live, query, { notify });
  void promise
    .catch((error) => console.warn("[team-task-query] background refresh failed", error));
  return promise;
}

export async function getLiveTeamTaskPage({
  companyId = "",
  completedLimit: limit = null,
  includeDetail = true,
  refresh = false
} = {}) {
  const live = await context();
  if (!live) return LIVE_TEAM_TASK_MISS;
  const query = {
    companyId: String(companyId || live.currentUser.activeCompanyId || ""),
    completedLimit: completedLimit(limit),
    includeDetail: includeDetail === true
  };
  const cached = readLiveQueryCache({
    userId: live.userId,
    namespace: TEAM_TASK_NAMESPACE,
    query
  });
  if (cached && !refresh) {
    const revalidate = backgroundTeamTaskRefresh(live, query, { notify: cached.stale === true });
    const value = { ...cached.value, unread: await clampLiveUnreadSummary(cached.value.unread), cached: true, stale: cached.stale };
    Object.defineProperty(value, "revalidate", { value: revalidate });
    return value;
  }
  try {
    return await fetchTeamTaskPage(live, query);
  } catch (error) {
    if (cached) {
      return { ...cached.value, unread: await clampLiveUnreadSummary(cached.value.unread), cached: true, stale: true, offline: true };
    }
    throw error;
  }
}
