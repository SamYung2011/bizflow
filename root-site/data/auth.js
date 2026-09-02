import { createClient } from "../vendor/supabase-js.esm.js";
import {
  AUTH_CONTEXT_TIMEOUT_MS,
  AuthContextTimeoutError,
  withTimeout
} from "./auth-context-timeout.js";
import {
  activateLiveTableCacheUser,
  clearLiveTableCache,
  invalidateLiveAuthCache,
  liveAuthCacheVersion,
  liveTableCacheVersion,
  readLiveAuthCache,
  readLiveTableCache,
  writeLiveAuthCache,
  writeLiveTableCache
} from "./live-table-cache.js";
import { fetchAllTablePages } from "./fetch-all-pages.js";
import { clearLiveQueryCache } from "./live-query-cache.js";
import {
  COMPANY_SCOPED_SNAPSHOTS,
  LIVE_SNAPSHOT_INVALIDATED_EVENT,
  LIVE_SNAPSHOT_UPDATED_EVENT,
  LIVE_TABLE_SWR_REFRESHED_EVENT
} from "./live-snapshot-dependencies.js";

const ADMIN_EMAIL = "samyung2011@gmail.com";
const WA_ADMIN_EMAILS = Object.freeze([ADMIN_EMAIL, "a1017339632@gmail.com"]);
export const TRANSIENT_AUTH_RESET_EVENT = "tp:auth-transient-reset";

export const RBAC_KEYS = Object.freeze([
  "can_create_task",
  "can_assign_others",
  "can_edit_others_tasks",
  "can_delete_others_tasks",
  "can_validate_task",
  "can_manage_employees",
  "can_approve_registration",
  "can_view_commission",
  "can_manage_roles"
]);

let configPromise = null;
let clientPromise = null;
let currentUserPromise = null;
let currentUserPromiseVersion = "";
const tableFetchPromises = new Map();

function clearCurrentUserMemory() {
  currentUserPromise = null;
  currentUserPromiseVersion = "";
}

export function resetCurrentUserMemory() {
  clearCurrentUserMemory();
}

function notifyTransientAuthReset() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TRANSIENT_AUTH_RESET_EVENT));
  }
}

function handleAuthCacheEvent(event) {
  // INITIAL_SESSION is page bootstrap, not a state transition; clearing it would defeat cross-page caching.
  if (event === "INITIAL_SESSION") return;
  clearCurrentUserMemory();
  if (event === "SIGNED_OUT") {
    // Only explicit signOut() owns persistent cache removal; SDK refresh races can emit transient SIGNED_OUT.
    notifyTransientAuthReset();
    return;
  }
  const operation = invalidateLiveAuthCache();
  void operation.catch((error) => console.warn("[auth-cache] auth event invalidation failed", error));
}

function safeLocalStorageGet(key) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Privacy mode and storage denial keep the current in-memory context usable.
  }
}

function decodeJwtPayload(value) {
  const payload = String(value || "").split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function assertPublicKey(value) {
  const key = String(value || "").trim();
  const payload = decodeJwtPayload(key);
  if (key.startsWith("sb_secret_") || payload?.role === "service_role") {
    throw new Error("Task Platform refuses privileged Supabase credentials in browser config.");
  }
}

function normalizeConfig(module) {
  const url = String(module?.SUPABASE_URL || "").trim();
  const anonKey = String(module?.SUPABASE_ANON_KEY || "").trim();
  assertPublicKey(anonKey);
  let parsedUrl = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { configured: false, url: "", anonKey: "" };
  }
  const placeholder = parsedUrl.hostname === "your-project.supabase.co" || anonKey === "your-anon-key";
  const protocolAllowed = parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:";
  return {
    configured: protocolAllowed && !placeholder && anonKey.length > 0,
    url: protocolAllowed && !placeholder ? parsedUrl.href.replace(/\/$/, "") : "",
    anonKey: protocolAllowed && !placeholder ? anonKey : ""
  };
}

async function loadConfig() {
  if (!configPromise) {
    configPromise = import("../config.local.js")
      .then(normalizeConfig)
      .catch((error) => {
        if (error?.message?.includes("privileged Supabase credentials")) throw error;
        return { configured: false, url: "", anonKey: "" };
      });
  }
  return configPromise;
}

export async function isAuthConfigured() {
  return (await loadConfig()).configured;
}

export async function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = loadConfig().then((config) => {
      if (!config.configured) return null;
      // Security is enforced by production RLS plus RBAC. Browser checks only control visible UI.
      const client = createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      client.auth.onAuthStateChange((event) => {
        handleAuthCacheEvent(event);
      });
      return client;
    });
  }
  return clientPromise;
}

function requireClient(client) {
  if (!client) throw new Error("Supabase Auth is not configured.");
  return client;
}

async function loadSession() {
  const client = await getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session ?? null;
}

export async function getSession({ timeoutMs = AUTH_CONTEXT_TIMEOUT_MS } = {}) {
  try {
    return await withTimeout(loadSession(), timeoutMs, "getSession");
  } catch (error) {
    clearCurrentUserMemory();
    if (error instanceof AuthContextTimeoutError) {
      console.warn("auth getSession timeout");
    }
    throw error;
  }
}

export async function onAuthStateChange(callback) {
  const client = await getSupabaseClient();
  if (!client) return { unsubscribe() {} };
  const { data } = client.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return data.subscription;
}

export async function signInWithPassword({ email, password }) {
  const client = requireClient(await getSupabaseClient());
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error) throw result.error;
  return result.data;
}

export async function signUp({ email, password, name, companyName, note }) {
  const client = requireClient(await getSupabaseClient());
  const result = await client.auth.signUp({ email, password });
  if (result.error) throw result.error;
  const pending = await client.from("task_pending").insert({
    email,
    name,
    company_name: companyName,
    note: note || null,
    user_id: result.data.user?.id ?? null
  });
  if (pending.error) {
    await client.auth.signOut();
    throw new Error(`task_pending: ${pending.error.message || pending.error}`);
  }
  return result.data;
}

export async function signOut() {
  const client = await getSupabaseClient();
  if (!client) {
    clearCurrentUserMemory();
    await Promise.all([clearLiveTableCache(), clearLiveQueryCache()]);
    return;
  }
  const { error } = await client.auth.signOut();
  if (error) throw error;
  clearCurrentUserMemory();
  await Promise.all([clearLiveTableCache(), clearLiveQueryCache()]);
}

export async function resetPasswordForEmail(email, redirectTo) {
  const client = requireClient(await getSupabaseClient());
  const { error } = await client.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
  if (error) throw error;
}

export async function verifyRecoveryOtp({ email, token }) {
  const client = requireClient(await getSupabaseClient());
  const { data, error } = await client.auth.verifyOtp({ email, token, type: "recovery" });
  if (error) throw error;
  return data;
}

export async function updatePassword(password) {
  const client = requireClient(await getSupabaseClient());
  const { data, error } = await client.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

export async function completeForcedPasswordChange(password, employeeId) {
  const client = requireClient(await getSupabaseClient());
  await updatePassword(password);
  const { error } = await client.from("employees").update({ must_change_password: false }).eq("id", employeeId);
  if (error) throw new Error(`employees.must_change_password: ${error.message || error}`);
  await signOut();
}

async function fetchAllTableFromNetwork(client, table, orderCol, ascending, secondaryOrder) {
  return fetchAllTablePages({ client, table, orderCol, ascending, secondaryOrder });
}

function fetchAllTableOnce(client, userId, table, orderCol, ascending, secondaryOrder, cacheVersion) {
  // Include the table generation so a post-write rebuild can never reuse a
  // request that started before invalidateLiveTables() advanced the version.
  const key = `${userId}:${table}:${orderCol || ""}:${ascending}:${secondaryOrder || ""}:${cacheVersion}`;
  if (!tableFetchPromises.has(key)) {
    const promise = fetchAllTableFromNetwork(client, table, orderCol, ascending, secondaryOrder)
      .finally(() => {
        if (tableFetchPromises.get(key) === promise) tableFetchPromises.delete(key);
      });
    tableFetchPromises.set(key, promise);
  }
  return tableFetchPromises.get(key);
}

export async function fetchAllTable(table, orderCol, ascending = true, secondaryOrder = "id", { refresh = false } = {}) {
  const client = requireClient(await getSupabaseClient());
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData.session?.user?.id || "";
  if (userId) await activateLiveTableCacheUser(userId);
  const cacheArgs = { userId, table, orderCol, ascending, secondaryOrder };
  const cacheVersion = liveTableCacheVersion(table);
  const cached = userId && !refresh ? await readLiveTableCache(cacheArgs) : null;
  if (cached && !cached.stale) return cached.rows;
  if (cached) {
    void fetchAllTableOnce(client, userId, table, orderCol, ascending, secondaryOrder, cacheVersion)
      .then(async (rows) => {
        const stored = await writeLiveTableCache({ ...cacheArgs, rows, version: cacheVersion });
        if (stored && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(LIVE_TABLE_SWR_REFRESHED_EVENT, { detail: { table } }));
        }
      })
      .catch((error) => console.warn(`[live-table-cache] ${table} refresh failed`, error));
    return cached.rows;
  }
  const rows = await fetchAllTableOnce(client, userId, table, orderCol, ascending, secondaryOrder, cacheVersion);
  if (userId) await writeLiveTableCache({ ...cacheArgs, rows, version: cacheVersion });
  return rows;
}

function activeCompanyStorageKey(employee) {
  return `team-active-company-${employee.user_id || employee.id}`;
}

export function hasPermission(context, key) {
  if (!RBAC_KEYS.includes(key)) return false;
  if (context?.isSuperAdmin || context?.isAdminOfActive) return true;
  return context?.permissions?.[key] === true;
}

export function deriveAuthContext({ session, employee, bindings, companies, roles, pendingCompanyIds = [] }) {
  if (!session?.user || !employee) return null;
  const ownBindings = bindings.filter((binding) => binding.employee_id === employee.id);
  const defaultBinding = ownBindings.find((binding) => binding.is_default) ?? ownBindings[0] ?? null;
  const allowedCompanyIds = employee.is_super_admin === true
    ? companies.map((company) => company.id)
    : ownBindings.map((binding) => binding.company_id);
  const rememberedCompanyId = safeLocalStorageGet(activeCompanyStorageKey(employee));
  const fallbackCompanyId = defaultBinding?.company_id ?? employee.company_id ?? allowedCompanyIds[0] ?? null;
  const activeCompanyId = allowedCompanyIds.includes(rememberedCompanyId) ? rememberedCompanyId : fallbackCompanyId;
  if (activeCompanyId) safeLocalStorageSet(activeCompanyStorageKey(employee), activeCompanyId);
  const activeBinding = ownBindings.find((binding) => binding.company_id === activeCompanyId) ?? null;
  const activeCompany = companies.find((company) => company.id === activeCompanyId) ?? null;
  const activeRole = roles.find((role) => role.id === activeBinding?.role_id) ?? null;
  const isSuperAdmin = employee.is_super_admin === true;
  const isAdminOfActive = isSuperAdmin || activeBinding?.is_company_admin === true;
  const isAdminOfAny = isSuperAdmin || ownBindings.some((binding) => binding.is_company_admin === true);
  const isBfAdmin = employee.is_admin === true || String(session.user.email || "").toLowerCase() === ADMIN_EMAIL;
  const isWaAdmin = isBfAdmin || WA_ADMIN_EMAILS.includes(String(session.user.email || "").toLowerCase());
  const pending = new Set(pendingCompanyIds);
  const bound = new Set(ownBindings.map((binding) => binding.company_id));
  const context = {
    id: employee.id,
    employeeId: employee.id,
    userId: session.user.id,
    name: employee.name || session.user.email || "",
    email: employee.email || session.user.email || "",
    position: activeBinding?.position || employee.role || "",
    phone: employee.phone || "",
    note: employee.note || "",
    role: activeRole?.name || employee.role || "",
    activeCompanyId,
    activeCompany,
    activeBinding,
    activeRole,
    bindings: ownBindings,
    switchableCompanies: companies.filter((company) => allowedCompanyIds.includes(company.id)),
    availableCompanies: companies
      .filter((company) => !bound.has(company.id) && !pending.has(company.id))
      .map(({ id, name }) => ({ id, name })),
    permissions: activeRole?.permissions && typeof activeRole.permissions === "object" ? { ...activeRole.permissions } : {},
    isSuperAdmin,
    isAdminOfActive,
    isAdminOfAny,
    isBfAdmin,
    isWaAdmin,
    isAdmin: isBfAdmin,
    bizflowMainAccess: employee.bizflow_main_access === true,
    mustChangePassword: employee.must_change_password === true,
    canShip: isBfAdmin || employee.can_ship === true,
    canViewRevenue: isBfAdmin || employee.can_view_revenue === true
  };
  context.hasPermission = (key) => hasPermission(context, key);
  return context;
}

async function loadCurrentUser({ timeoutMs = AUTH_CONTEXT_TIMEOUT_MS } = {}) {
  const session = await getSession({ timeoutMs });
  if (!session) return null;
  const client = requireClient(await getSupabaseClient());
  const userId = session.user.id;
  const cached = await readLiveAuthCache(userId);
  const fetchAuthRows = async () => {
    const version = liveAuthCacheVersion();
    const employeeResult = await client.from("employees").select("*").eq("user_id", userId).maybeSingle();
    if (employeeResult.error) throw employeeResult.error;
    if (!employeeResult.data) return null;
    const pendingResult = await client.from("company_join_pending")
      .select("company_id")
      .eq("employee_id", employeeResult.data.id)
      .is("approved", null);
    if (pendingResult.error) throw pendingResult.error;
    const authRows = {
      employee: employeeResult.data,
      pendingCompanyIds: (pendingResult.data ?? []).map((row) => row.company_id)
    };
    await writeLiveAuthCache({ userId, ...authRows, version });
    return authRows;
  };
  const refreshAuthTables = !cached;
  const authRowsPromise = cached
    ? Promise.resolve({ employee: cached.employee, pendingCompanyIds: cached.pendingCompanyIds })
    : fetchAuthRows();
  if (cached?.stale) {
    void fetchAuthRows().then((rows) => {
      if (!rows) return invalidateLiveAuthCache();
      return null;
    }).catch((error) => console.warn("[auth-cache] background refresh failed", error));
  }
  const [authRows, bindings, companies, roles] = await Promise.all([
    authRowsPromise,
    fetchAllTable("employee_companies", "joined_at", true, "id", { refresh: refreshAuthTables }),
    fetchAllTable("companies", "name", true, "id", { refresh: refreshAuthTables }),
    fetchAllTable("roles", "name", true, "id", { refresh: refreshAuthTables })
  ]);
  if (!authRows) return null;
  return deriveAuthContext({
    session,
    employee: authRows.employee,
    bindings,
    companies,
    roles,
    pendingCompanyIds: authRows.pendingCompanyIds
  });
}

export async function getCurrentUser({
  refresh = false,
  timeoutMs = AUTH_CONTEXT_TIMEOUT_MS
} = {}) {
  const cacheVersion = liveAuthCacheVersion();
  if (refresh || currentUserPromiseVersion !== cacheVersion) clearCurrentUserMemory();
  if (!currentUserPromise) {
    const promise = withTimeout(
      loadCurrentUser({ timeoutMs }),
      timeoutMs,
      "getCurrentUser"
    )
      .catch((error) => {
        if (currentUserPromise === promise) clearCurrentUserMemory();
        throw error;
      });
    currentUserPromise = promise;
    currentUserPromiseVersion = cacheVersion;
  }
  return currentUserPromise;
}

// Company-scoped snapshots are cached per company, so a switch never has to drop the
// stored entries; only the memoized in-page copies are still keyed by snapshot name.
// The invalidated event evicts those live-builder and provider memos, and the updated
// event lets already-mounted pages rebuild for the new company right away instead of
// waiting out the snapshot TTL.
function notifyCompanyScopeChange() {
  if (typeof window === "undefined") return;
  const detail = { snapshots: [...COMPANY_SCOPED_SNAPSHOTS], tables: [], source: "company-switch" };
  window.dispatchEvent(new CustomEvent(LIVE_SNAPSHOT_INVALIDATED_EVENT, { detail }));
  window.dispatchEvent(new CustomEvent(LIVE_SNAPSHOT_UPDATED_EVENT, { detail }));
}

export async function setActiveCompany(companyId) {
  const context = await getCurrentUser();
  const nextCompanyId = String(companyId || "");
  if (!context?.switchableCompanies?.some((company) => company.id === nextCompanyId)) {
    throw new Error("Company is not available for the current user");
  }
  safeLocalStorageSet(`team-active-company-${context.userId || context.employeeId}`, nextCompanyId);
  clearCurrentUserMemory();
  await invalidateLiveAuthCache();
  const nextContext = await getCurrentUser();
  notifyCompanyScopeChange();
  return nextContext;
}
