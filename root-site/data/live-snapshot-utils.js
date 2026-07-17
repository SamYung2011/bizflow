import { fetchAllTable, getSession, TRANSIENT_AUTH_RESET_EVENT } from "./auth.js";
import { activateLiveTableCacheUser, invalidateLiveAuthCache, invalidateLiveTableCache } from "./live-table-cache.js";
import { LIVE_SNAPSHOT_UPDATED_EVENT } from "./live-snapshot-dependencies.js";

const HK_TIME_ZONE = "Asia/Hong_Kong";
const tablePromises = new Map();
const freshTablePromises = new Map();
const tableQueries = new Map();
let liveUserId = "";
let freshReadDepth = 0;

if (typeof window !== "undefined") {
  window.addEventListener(TRANSIENT_AUTH_RESET_EVENT, () => {
    liveUserId = "";
    tablePromises.clear();
  });
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function asText(value, fallback = "") {
  return value == null ? fallback : String(value);
}

export function dateParts(value, includeTime = false) {
  if (!value) return null;
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return { year: dateOnly[1], month: dateOnly[2], day: dateOnly[3], hour: "00", minute: "00", second: "00" };
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const fields = new Intl.DateTimeFormat("en-CA", {
    timeZone: HK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" } : {})
  }).formatToParts(date).reduce((out, part) => {
    if (part.type !== "literal") out[part.type] = part.value;
    return out;
  }, {});
  return {
    year: fields.year,
    month: fields.month,
    day: fields.day,
    hour: fields.hour ?? "00",
    minute: fields.minute ?? "00",
    second: fields.second ?? "00"
  };
}

export function formatDate(value, { compact = false } = {}) {
  const parts = dateParts(value);
  if (!parts) return "";
  return compact
    ? `${parts.year}/${Number(parts.month)}/${Number(parts.day)}`
    : `${parts.year}/${parts.month}/${parts.day}`;
}

export function formatDateTime(value, { seconds = false } = {}) {
  const parts = dateParts(value, true);
  if (!parts) return "";
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}${seconds ? `:${parts.second}` : ""}`;
}

export function formatMonthDay(value) {
  const parts = dateParts(value, true);
  return parts ? `${parts.month}/${parts.day}` : "";
}

export function formatTime(value) {
  const parts = dateParts(value, true);
  return parts ? `${parts.hour}:${parts.minute}` : "";
}

export function timestamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

export async function ensureLiveSession() {
  const session = await getSession();
  if (!session) {
    liveUserId = "";
    tablePromises.clear();
    return null;
  }
  if (liveUserId !== session.user.id) {
    liveUserId = session.user.id;
    tablePromises.clear();
  }
  await activateLiveTableCacheUser(session.user.id);
  return session;
}

export function allRows(table, orderCol = "created_at", ascending = true, secondaryOrder = "id") {
  const key = `${table}:${orderCol || ""}:${ascending}:${secondaryOrder || ""}`;
  tableQueries.set(key, { table, orderCol, ascending, secondaryOrder });
  if (freshReadDepth > 0) {
    if (!freshTablePromises.has(key)) {
      const promise = fetchAllTable(table, orderCol, ascending, secondaryOrder, { refresh: true })
        .finally(() => {
          if (freshTablePromises.get(key) === promise) freshTablePromises.delete(key);
        });
      freshTablePromises.set(key, promise);
    }
    const promise = freshTablePromises.get(key);
    tablePromises.set(key, promise);
    return promise;
  }
  if (!tablePromises.has(key)) {
    tablePromises.set(key, fetchAllTable(table, orderCol, ascending, secondaryOrder));
  }
  return tablePromises.get(key);
}

export async function withFreshLiveTableReads(operation) {
  freshReadDepth += 1;
  try {
    return await operation();
  } finally {
    freshReadDepth -= 1;
  }
}

export async function refreshStaleLiveTables() {
  // getCurrentUser refreshes these exact cache signatures during the same resume pass.
  const authTableKeys = new Set([
    "employee_companies:joined_at:true:id",
    "companies:name:true:id",
    "roles:name:true:id"
  ]);
  const queries = [...tableQueries].filter(([key]) => !authTableKeys.has(key)).map(([, query]) => query);
  const results = await Promise.allSettled(queries.map(({ table, orderCol, ascending, secondaryOrder }) =>
    fetchAllTable(table, orderCol, ascending, secondaryOrder)));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(`[live-table-cache] ${queries[index].table} resume refresh failed`, result.reason);
    }
  });
}

function liveTableTargets(tables) {
  return new Set(tables.flat().map((table) => String(table || "")).filter(Boolean));
}

function evictLiveTablePromises(targets) {
  if (!targets.size) return;
  for (const key of tablePromises.keys()) {
    if (targets.has(key.split(":", 1)[0])) tablePromises.delete(key);
  }
  for (const key of freshTablePromises.keys()) {
    if (targets.has(key.split(":", 1)[0])) freshTablePromises.delete(key);
  }
}

export async function refreshLiveTables(...tables) {
  const targets = liveTableTargets(tables);
  if (!targets.size) return [];
  const queries = [...tableQueries.values()].filter(({ table }) => targets.has(table));
  const results = await Promise.allSettled(queries.map(({ table, orderCol, ascending, secondaryOrder }) =>
    fetchAllTable(table, orderCol, ascending, secondaryOrder, { refresh: true })));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(`[live-realtime] ${queries[index].table} refresh failed`, result.reason);
    }
  });
  const queriedTables = new Set(queries.map(({ table }) => table));
  const refreshedTables = [...targets].filter((table) => !queriedTables.has(table) || queries.some((query, index) =>
    query.table === table && results[index]?.status === "fulfilled"));
  if (refreshedTables.length && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LIVE_SNAPSHOT_UPDATED_EVENT, { detail: { tables: refreshedTables } }));
  }
  return results;
}

export async function invalidateLiveTableData(...tables) {
  const targets = liveTableTargets(tables);
  if (!targets.size) return;
  evictLiveTablePromises(targets);
  await invalidateLiveTableCache([...targets]);
}

export async function invalidateLiveTables(...tables) {
  const targets = liveTableTargets(tables);
  if (!targets.size) return;
  evictLiveTablePromises(targets);
  await Promise.all([
    invalidateLiveTableCache([...targets]),
    invalidateLiveAuthCache()
  ]);
}
