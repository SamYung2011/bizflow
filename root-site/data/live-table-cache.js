const CACHE_PREFIX = "tp-live-table:v1:";
const CACHE_USER_KEY = `${CACHE_PREFIX}user`;
const CACHE_ROWS_PREFIX = `${CACHE_PREFIX}rows:`;

export const LIVE_TABLE_CACHE_TTL_MS = 60_000;
export const LIVE_TABLE_CACHE_MAX_BYTES = 1.5 * 1024 * 1024;

const memoryStorage = new Map();
const tableVersions = new Map();
let activeUserId = "";

function storage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getValue(key) {
  try {
    const value = storage()?.getItem(key) ?? null;
    if (value !== null) memoryStorage.set(key, value);
  } catch {
    // The in-memory copy keeps this page usable when browser storage is denied.
  }
  return memoryStorage.get(key) ?? null;
}

function setValue(key, value) {
  memoryStorage.set(key, value);
  try {
    storage()?.setItem(key, value);
  } catch {
    // Quota/privacy failures fall back to the in-memory copy for this page.
  }
}

function removeValue(key) {
  memoryStorage.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    // The in-memory copy is already gone.
  }
}

function storedKeys() {
  const keys = new Set(memoryStorage.keys());
  try {
    const target = storage();
    for (let index = 0; target && index < target.length; index += 1) {
      const key = target.key(index);
      if (key) keys.add(key);
    }
  } catch {
    // The in-memory keys remain available.
  }
  return [...keys];
}

function encoded(value) {
  return encodeURIComponent(String(value ?? ""));
}

function cacheKey(userId, table, orderCol, ascending, secondaryOrder) {
  return `${CACHE_ROWS_PREFIX}${encoded(userId)}:${encoded(table)}:${encoded(orderCol)}:${ascending ? "asc" : "desc"}:${encoded(secondaryOrder)}`;
}

function serializedBytes(value) {
  if (typeof TextEncoder === "function") return new TextEncoder().encode(value).byteLength;
  return value.length;
}

export function activateLiveTableCacheUser(userId) {
  const nextUserId = String(userId || "");
  if (!nextUserId) return false;
  const storedUserId = getValue(CACHE_USER_KEY) || "";
  const userChanged = activeUserId !== nextUserId;
  if ((storedUserId && storedUserId !== nextUserId) || (!storedUserId && storedKeys().some((key) => key.startsWith(CACHE_ROWS_PREFIX)))) {
    clearLiveTableCache();
  }
  activeUserId = nextUserId;
  setValue(CACHE_USER_KEY, nextUserId);
  return userChanged;
}

export function readLiveTableCache({ userId, table, orderCol, ascending, secondaryOrder }) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId || getValue(CACHE_USER_KEY) !== normalizedUserId) return null;
  const key = cacheKey(normalizedUserId, table, orderCol, ascending, secondaryOrder);
  const serialized = getValue(key);
  if (!serialized) return null;
  try {
    const cached = JSON.parse(serialized);
    if (!Array.isArray(cached?.rows) || !Number.isFinite(cached?.cachedAt)) throw new Error("invalid cache payload");
    return {
      rows: cached.rows,
      stale: Date.now() - cached.cachedAt >= LIVE_TABLE_CACHE_TTL_MS
    };
  } catch {
    removeValue(key);
    return null;
  }
}

export function liveTableCacheVersion(table) {
  return tableVersions.get(String(table || "")) || 0;
}

export function writeLiveTableCache({ userId, table, orderCol, ascending, secondaryOrder, rows, version }) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId || !Array.isArray(rows)) return false;
  if (version !== undefined && version !== liveTableCacheVersion(table)) return false;
  activateLiveTableCacheUser(normalizedUserId);
  const key = cacheKey(normalizedUserId, table, orderCol, ascending, secondaryOrder);
  const serialized = JSON.stringify({ cachedAt: Date.now(), rows });
  if (serializedBytes(serialized) > LIVE_TABLE_CACHE_MAX_BYTES) {
    removeValue(key);
    return false;
  }
  setValue(key, serialized);
  return true;
}

export function invalidateLiveTableCache(...tables) {
  const targets = new Set(tables.flat().map((table) => String(table || "")).filter(Boolean));
  if (!targets.size) return;
  targets.forEach((table) => tableVersions.set(table, liveTableCacheVersion(table) + 1));
  storedKeys().forEach((key) => {
    if (!key.startsWith(CACHE_ROWS_PREFIX)) return;
    const [, table = ""] = key.slice(CACHE_ROWS_PREFIX.length).split(":");
    if (targets.has(decodeURIComponent(table))) removeValue(key);
  });
}

export function clearLiveTableCache() {
  storedKeys().forEach((key) => {
    if (key.startsWith(CACHE_PREFIX)) removeValue(key);
  });
  activeUserId = "";
  tableVersions.clear();
}
