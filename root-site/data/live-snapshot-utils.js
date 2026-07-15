import { fetchAllTable, getSession } from "./auth.js";
import { activateLiveTableCacheUser, clearLiveTableCache, invalidateLiveTableCache } from "./live-table-cache.js";

const HK_TIME_ZONE = "Asia/Hong_Kong";
const tablePromises = new Map();
let liveUserId = "";

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
    clearLiveTableCache();
    return null;
  }
  if (liveUserId !== session.user.id) {
    liveUserId = session.user.id;
    tablePromises.clear();
  }
  activateLiveTableCacheUser(session.user.id);
  return session;
}

export function allRows(table, orderCol = "created_at", ascending = true, secondaryOrder = "id") {
  const key = `${table}:${orderCol || ""}:${ascending}:${secondaryOrder || ""}`;
  if (!tablePromises.has(key)) {
    tablePromises.set(key, fetchAllTable(table, orderCol, ascending, secondaryOrder));
  }
  return tablePromises.get(key);
}

export function invalidateLiveTables(...tables) {
  const targets = new Set(tables.flat().map((table) => String(table || "")).filter(Boolean));
  if (!targets.size) return;
  for (const key of tablePromises.keys()) {
    if (targets.has(key.split(":", 1)[0])) tablePromises.delete(key);
  }
  invalidateLiveTableCache([...targets]);
}
