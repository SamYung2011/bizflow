// Phase 1 deliberately keeps the full-detail packed response out of
// live-query-cache/localStorage. Restore a bounded cache only after phase 2
// ships include_detail=false plus lazy detail fetching.
import { getCurrentUser, getRememberedActiveCompanyId, getRememberedEmployeeId, getSession, getSupabaseClient, TRANSIENT_AUTH_RESET_EVENT } from "./auth.js";
import { rememberLiveUnreadSummary } from "./live-home-query.js";
import { getReadState, peekReadState, setReadStateAccount } from "./read-state.js";
import { readLiveAuthCache } from "./live-table-cache.js";
import { TEAM_TASK_RPC_ENABLED } from "./team-feature-flags.js";

export const LIVE_TEAM_TASK_MISS = Symbol("live-team-task-miss");

const ARRAY_KEYS = Object.freeze([
  "tasks", "assignees", "feedbacks", "members", "departments", "employeeDepartments",
  "employeeCompanies", "roles", "companies", "taskPending", "companyJoinPending",
  "updateLogs", "updateLogComments"
]);
const NETWORK_REQUESTS = new Map();
let activeUserId = "";
let PREFETCH = null;
let prefetchedUnread = null;
let prefetchStart = null;
let authGeneration = 0;

function resetTeamTaskQuery() {
  activeUserId = "";
  NETWORK_REQUESTS.clear();
  PREFETCH = null;
  prefetchedUnread = null;
  prefetchStart = null;
  authGeneration += 1;
}

if (typeof window !== "undefined") {
  window.addEventListener(TRANSIENT_AUTH_RESET_EVENT, resetTeamTaskQuery);
}

async function context() {
  const [client, session, currentUser] = await Promise.all([
    getSupabaseClient(), getSession(), getCurrentUser()
  ]);
  if (!client || !session?.user?.id || !currentUser) return null;
  if ((activeUserId && activeUserId !== session.user.id)
      || (PREFETCH && PREFETCH.userId !== session.user.id)) resetTeamTaskQuery();
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

function readKey(read) {
  return JSON.stringify([read.tasks || null, read.orders || null, read.messages || null,
    read.inventory || null, read.updates || null]);
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
    // A speculative company must not seed the current company's unread memo.
    // The page adopts it only after auth and scope matching below.
    return live.currentUser ? withCurrentUnread(payload, live.read) : payload;
  }).finally(() => {
    if (NETWORK_REQUESTS.get(key) === promise) NETWORK_REQUESTS.delete(key);
  });
  NETWORK_REQUESTS.set(key, promise);
  return promise;
}

export async function prefetchTeamTaskPage() {
  try {
    if (!TEAM_TASK_RPC_ENABLED) return null;
    if (PREFETCH) return await PREFETCH.promise;
    if (!prefetchStart) {
      const generation = authGeneration;
      const start = (async () => {
        const [client, session] = await Promise.all([getSupabaseClient(), getSession()]);
        if (!client || !session?.user?.id) return null;
        const userId = session.user.id;
        const companyId = getRememberedActiveCompanyId(userId);
        const cached = await readLiveAuthCache(userId);
        if (generation !== authGeneration) return null;
        const read = peekReadState(cached?.employee?.id || getRememberedEmployeeId(userId));
        const promise = fetchTeamTaskPage({ client, userId, read }, {
          companyId, completedLimit: null, includeDetail: true
        });
        promise.catch(() => {});
        PREFETCH = { userId, companyId, readKey: readKey(read), promise };
        prefetchedUnread = PREFETCH;
        return promise;
      })();
      prefetchStart = start;
      const clearStart = () => { if (prefetchStart === start) prefetchStart = null; };
      start.then(clearStart, clearStart);
    }
    return await prefetchStart;
  } catch (error) {
    console.warn("[team-task-query] prefetch failed", error);
    return null;
  }
}

export function peekPrefetchedTeamTaskPage() {
  // Page activation asks for unread after claiming the page and marking tasks
  // read. Hand the same promise to that first bell read; retain no page cache.
  const promise = PREFETCH?.promise ?? prefetchedUnread?.promise ?? null;
  prefetchedUnread = null;
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
  const prefetched = PREFETCH;
  PREFETCH = null; // One first-screen claim, including a scope mismatch.
  if (prefetched?.userId === live.userId && query.completedLimit === null && query.includeDetail
      && prefetched.readKey === readKey(live.read)
      && (!prefetched.companyId || prefetched.companyId === query.companyId)) {
    const generation = authGeneration;
    try {
      // Keep the settled promise too: a fast RPC can finish before shellReady.
      const payload = await prefetched.promise;
      if (generation === authGeneration
          && String(payload.currentUser?.activeCompanyId || "") === query.companyId) {
        return withCurrentUnread(payload, live.read);
      }
    } catch {
      // Speculation is optional; a failed prefetch gets a fresh page request.
    }
  }
  if (prefetchedUnread === prefetched) prefetchedUnread = null;
  return fetchTeamTaskPage(live, query);
}
