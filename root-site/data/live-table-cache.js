const CACHE_PREFIX = "tp-live-table:v1:";
const CACHE_USER_KEY = `${CACHE_PREFIX}user`;
const CACHE_ROWS_PREFIX = `${CACHE_PREFIX}rows:`;
const CACHE_DB_NAME = "tp-live-table-cache";
const CACHE_DB_VERSION = 1;
const CACHE_STORE_NAME = "rows";

export const LIVE_TABLE_CACHE_TTL_MS = 60_000;
// IndexedDB is the primary store. This limit only applies to the sessionStorage fallback.
export const LIVE_TABLE_CACHE_MAX_BYTES = 1.5 * 1024 * 1024;

const memoryStorage = new Map();
const tableVersions = new Map();
let activeUserId = "";
let cacheEpoch = 0;
let activationQueue = Promise.resolve();
let databasePromise = null;
let indexedDbDisabled = false;
let indexedDbWarningShown = false;

function sessionStorageTarget() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getFallbackValue(key) {
  try {
    const value = sessionStorageTarget()?.getItem(key) ?? null;
    if (value !== null) memoryStorage.set(key, value);
  } catch {
    // The in-memory copy keeps this page usable when browser storage is denied.
  }
  return memoryStorage.get(key) ?? null;
}

function setFallbackValue(key, value) {
  memoryStorage.set(key, value);
  try {
    sessionStorageTarget()?.setItem(key, value);
  } catch {
    // Privacy and quota failures keep the current in-memory context usable.
  }
}

function removeFallbackValue(key) {
  memoryStorage.delete(key);
  try {
    sessionStorageTarget()?.removeItem(key);
  } catch {
    // The in-memory copy is already gone.
  }
}

function fallbackKeys() {
  const keys = new Set(memoryStorage.keys());
  try {
    const target = sessionStorageTarget();
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

function warnIndexedDbFallback(error) {
  if (indexedDbWarningShown) return;
  indexedDbWarningShown = true;
  console.warn("[live-table-cache] IndexedDB unavailable; using sessionStorage fallback", error);
}

function disableIndexedDb(error) {
  indexedDbDisabled = true;
  databasePromise = null;
  warnIndexedDbFallback(error);
}

function indexedDbApi() {
  if (indexedDbDisabled || typeof window === "undefined") return null;
  try {
    return window.indexedDB ?? null;
  } catch (error) {
    disableIndexedDb(error);
    return null;
  }
}

function openDatabase() {
  const indexedDb = indexedDbApi();
  if (!indexedDb) return Promise.resolve(null);
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    let settled = false;
    const finish = (database, error) => {
      if (settled) {
        database?.close?.();
        return;
      }
      settled = true;
      if (error) disableIndexedDb(error);
      resolve(database);
    };
    let request;
    try {
      request = indexedDb.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    } catch (error) {
      finish(null, error);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CACHE_STORE_NAME)) {
        database.createObjectStore(CACHE_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      finish(database, null);
    };
    request.onerror = () => finish(null, request.error || new Error("IndexedDB open failed"));
    request.onblocked = () => finish(null, new Error("IndexedDB open blocked"));
  });
  return databasePromise;
}

async function runIndexedDbTransaction(mode, operation) {
  const database = await openDatabase();
  if (!database) return { available: false, value: null };
  try {
    const value = await new Promise((resolve, reject) => {
      const transaction = database.transaction(CACHE_STORE_NAME, mode);
      const store = transaction.objectStore(CACHE_STORE_NAME);
      let result = null;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
      try {
        operation(store, (nextValue) => {
          result = nextValue;
        });
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
    return { available: true, value };
  } catch (error) {
    database.close();
    disableIndexedDb(error);
    return { available: false, value: null };
  }
}

function readIndexedValue(key) {
  return runIndexedDbTransaction("readonly", (store, setResult) => {
    const request = store.get(key);
    request.onsuccess = () => setResult(request.result ?? null);
  });
}

function writeIndexedValue(value) {
  return runIndexedDbTransaction("readwrite", (store) => {
    store.put(value);
  });
}

function removeIndexedValue(key) {
  return runIndexedDbTransaction("readwrite", (store) => {
    store.delete(key);
  });
}

function removeIndexedTables(tables) {
  return runIndexedDbTransaction("readwrite", (store) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (tables.has(String(cursor.value?.table || ""))) cursor.delete();
      cursor.continue();
    };
  });
}

function clearIndexedValues() {
  return runIndexedDbTransaction("readwrite", (store) => {
    store.clear();
  });
}

function parsePayload(value) {
  const payload = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(payload?.rows) || !Number.isFinite(payload?.cachedAt)) {
    throw new Error("invalid cache payload");
  }
  return payload;
}

function payloadResult(payload) {
  return {
    rows: payload.rows,
    stale: Date.now() - payload.cachedAt >= LIVE_TABLE_CACHE_TTL_MS
  };
}

function versionChangedInThisPage(table) {
  return cacheEpoch > 0 || tableVersions.has(String(table || ""));
}

function fallbackPayload(key) {
  const serialized = getFallbackValue(key);
  if (!serialized) return null;
  try {
    return parsePayload(serialized);
  } catch {
    removeFallbackValue(key);
    return null;
  }
}

function clearFallbackValues() {
  fallbackKeys().forEach((key) => {
    if (key.startsWith(CACHE_PREFIX)) removeFallbackValue(key);
  });
}

async function clearCacheStores() {
  cacheEpoch += 1;
  activeUserId = "";
  tableVersions.clear();
  clearFallbackValues();
  await clearIndexedValues();
}

function queueActivation(operation) {
  const task = activationQueue.then(operation, operation);
  activationQueue = task.catch(() => {});
  return task;
}

export function activateLiveTableCacheUser(userId) {
  const nextUserId = String(userId || "");
  if (!nextUserId) return Promise.resolve(false);
  return queueActivation(async () => {
    const firstActivation = !activeUserId;
    const storedUserId = getFallbackValue(CACHE_USER_KEY) || "";
    const indexedOwner = firstActivation && !storedUserId
      ? String((await readIndexedValue(CACHE_USER_KEY)).value?.userId || "")
      : "";
    const userChanged = Boolean(
      (activeUserId && activeUserId !== nextUserId)
      || (storedUserId && storedUserId !== nextUserId)
      || (indexedOwner && indexedOwner !== nextUserId)
    );
    if (userChanged) {
      await clearCacheStores();
    }
    activeUserId = nextUserId;
    setFallbackValue(CACHE_USER_KEY, nextUserId);
    if (firstActivation || userChanged) {
      await writeIndexedValue({ key: CACHE_USER_KEY, userId: nextUserId, table: "" });
    }
    return userChanged;
  });
}

export async function readLiveTableCache({ userId, table, orderCol, ascending, secondaryOrder }) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId) return null;
  await activateLiveTableCacheUser(normalizedUserId);
  if (getFallbackValue(CACHE_USER_KEY) !== normalizedUserId) return null;
  const key = cacheKey(normalizedUserId, table, orderCol, ascending, secondaryOrder);
  const currentVersion = liveTableCacheVersion(table);
  const indexed = await readIndexedValue(key);
  if (indexed.value) {
    try {
      const payload = parsePayload(indexed.value);
      if (versionChangedInThisPage(table) && payload.version !== undefined && payload.version !== currentVersion) {
        await removeIndexedValue(key);
        return null;
      }
      return payloadResult(payload);
    } catch {
      await removeIndexedValue(key);
    }
  }
  const fallback = fallbackPayload(key);
  if (!fallback) return null;
  if (versionChangedInThisPage(table) && fallback.version !== undefined && fallback.version !== currentVersion) {
    removeFallbackValue(key);
    return null;
  }
  if (indexed.available) {
    const migrated = { ...fallback, key, userId: normalizedUserId, table: String(table || "") };
    const migration = await writeIndexedValue(migrated);
    if (migration.available) removeFallbackValue(key);
  }
  return payloadResult(fallback);
}

export function liveTableCacheVersion(table) {
  return `${cacheEpoch}:${tableVersions.get(String(table || "")) || 0}`;
}

export async function writeLiveTableCache({ userId, table, orderCol, ascending, secondaryOrder, rows, version }) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId || !Array.isArray(rows)) return false;
  if (version !== undefined && version !== liveTableCacheVersion(table)) return false;
  await activateLiveTableCacheUser(normalizedUserId);
  if (version !== undefined && version !== liveTableCacheVersion(table)) return false;
  const key = cacheKey(normalizedUserId, table, orderCol, ascending, secondaryOrder);
  const payload = {
    key,
    userId: normalizedUserId,
    table: String(table || ""),
    cachedAt: Date.now(),
    rows,
    version: version ?? liveTableCacheVersion(table)
  };
  const indexed = await writeIndexedValue(payload);
  if (indexed.available) {
    removeFallbackValue(key);
    if (payload.version !== liveTableCacheVersion(table)) {
      await removeIndexedValue(key);
      return false;
    }
    return true;
  }
  const serialized = JSON.stringify(payload);
  if (serializedBytes(serialized) > LIVE_TABLE_CACHE_MAX_BYTES) {
    removeFallbackValue(key);
    return false;
  }
  if (payload.version !== liveTableCacheVersion(table)) return false;
  setFallbackValue(key, serialized);
  return true;
}

export async function invalidateLiveTableCache(...tables) {
  const targets = new Set(tables.flat().map((table) => String(table || "")).filter(Boolean));
  if (!targets.size) return;
  targets.forEach((table) => tableVersions.set(table, (tableVersions.get(table) || 0) + 1));
  fallbackKeys().forEach((key) => {
    if (!key.startsWith(CACHE_ROWS_PREFIX)) return;
    const [, table = ""] = key.slice(CACHE_ROWS_PREFIX.length).split(":");
    if (targets.has(decodeURIComponent(table))) removeFallbackValue(key);
  });
  await removeIndexedTables(targets);
}

export function clearLiveTableCache() {
  return queueActivation(clearCacheStores);
}
