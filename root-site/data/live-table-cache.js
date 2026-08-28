import { LIVE_SNAPSHOT_INVALIDATED_EVENT, snapshotsForTables } from "./live-snapshot-dependencies.js";

const CACHE_PREFIX = "tp-live-table:v1:";
const CACHE_USER_KEY = `${CACHE_PREFIX}user`;
const CACHE_ROWS_PREFIX = `${CACHE_PREFIX}rows:`;
const CACHE_AUTH_PREFIX = `${CACHE_PREFIX}auth:`;
const CACHE_SNAPSHOT_PREFIX = `${CACHE_PREFIX}snapshot:`;
const CACHE_DB_NAME = "tp-live-table-cache";
const CACHE_DB_VERSION = 1;
const CACHE_STORE_NAME = "rows";
// Shape generations are deliberately local to affected snapshots. Customer
// joins are embedded in their affected payloads; members.json separately bumps
// when member fields or company-bound identity visibility semantics change.
const SNAPSHOT_CONTRACT_GENERATIONS = new Map([
  ["home.json", 3],
  ["members.json", 2],
  ["team-extras.json", 1],
  ["team-update-logs.json", 1],
  ["customers.json", 2],
  ["warranty.json", 2],
  ["orders.json", 2],
  ["pending-deduction.json", 1],
  ["expense.json", 1], // G-exp-6: rows now carry employee_name from an employees join.
  ["whatsapp.json", 1] // G-wa-7: settings now carry the full boss_prompt plus its real character count.
]);

export const LIVE_TABLE_CACHE_TTL_MS = 10 * 60_000;
export const LIVE_AUTH_CACHE_TTL_MS = 30 * 60_000;
export const LIVE_SNAPSHOT_CACHE_TTL_MS = LIVE_TABLE_CACHE_TTL_MS;
export const LIVE_SNAPSHOT_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
// IndexedDB is the primary store. This limit only applies to the sessionStorage fallback.
export const LIVE_TABLE_CACHE_MAX_BYTES = 1.5 * 1024 * 1024;

const memoryStorage = new Map();
const tableVersions = new Map();
const snapshotVersions = new Map();
let authVersion = 0;
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

function authCacheKey(userId) {
  return `${CACHE_AUTH_PREFIX}${encoded(userId)}`;
}

// Company-scoped snapshots append their company id so two companies of the same
// user never share one entry. The company segment stays last, keeping the
// userId:snapshot prefix that invalidateLiveSnapshotCache() parses intact.
function snapshotCacheKey(userId, snapshot, companyId) {
  const scope = companyId ? `:${encoded(companyId)}` : "";
  return `${CACHE_SNAPSHOT_PREFIX}${encoded(userId)}:${encoded(snapshot)}${scope}`;
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

function removeIndexedAuthValues() {
  return runIndexedDbTransaction("readwrite", (store) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value?.kind === "auth" || String(cursor.key || "").startsWith(CACHE_AUTH_PREFIX)) cursor.delete();
      cursor.continue();
    };
  });
}

function removeIndexedSnapshots(snapshots) {
  return runIndexedDbTransaction("readwrite", (store) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value?.kind === "snapshot" && snapshots.has(String(cursor.value?.snapshot || ""))) cursor.delete();
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

function parseAuthPayload(value, expectedUserId) {
  const payload = typeof value === "string" ? JSON.parse(value) : value;
  if (!payload?.employee || typeof payload.employee !== "object" || Array.isArray(payload.employee) ||
    payload.userId !== expectedUserId || !Array.isArray(payload.pendingCompanyIds) ||
    !payload.pendingCompanyIds.every((companyId) => typeof companyId === "string") ||
    !Number.isFinite(payload.cachedAt)) {
    throw new Error("invalid auth cache payload");
  }
  return payload;
}

function parseSnapshotPayload(value, expectedUserId, expectedSnapshot, expectedCompanyId) {
  const payload = typeof value === "string" ? JSON.parse(value) : value;
  if (!payload?.value || typeof payload.value !== "object" || Array.isArray(payload.value) ||
    payload.userId !== expectedUserId || payload.snapshot !== expectedSnapshot ||
    // Entries written before company scoping carry no companyId; they stay readable
    // only for company-neutral reads and can never satisfy a scoped one.
    String(payload.companyId || "") !== expectedCompanyId ||
    !Number.isFinite(payload.cachedAt)) {
    throw new Error("invalid snapshot cache payload");
  }
  return payload;
}

function payloadResult(payload, versionStale = false) {
  return {
    rows: payload.rows,
    stale: versionStale || Date.now() - payload.cachedAt >= LIVE_TABLE_CACHE_TTL_MS
  };
}

function snapshotVersionState(payloadVersion, currentVersion) {
  if (payloadVersion === undefined || payloadVersion === currentVersion) return "current";
  const payloadParts = String(payloadVersion).split(":");
  const currentParts = String(currentVersion).split(":");
  if (payloadParts.length === 3 && currentParts.length === 3 &&
    payloadParts[0] === currentParts[0] && payloadParts[1] === currentParts[1]) {
    return "stale";
  }
  return "incompatible";
}

function versionChangedInThisPage(table) {
  return cacheEpoch > 0 || tableVersions.has(String(table || ""));
}

function authVersionChangedInThisPage() {
  return cacheEpoch > 0 || authVersion > 0;
}

function snapshotVersionChangedInThisPage(snapshot) {
  const key = String(snapshot || "");
  return cacheEpoch > 0 || (SNAPSHOT_CONTRACT_GENERATIONS.get(key) || 0) > 0 || snapshotVersions.has(key);
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
  snapshotVersions.clear();
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
    if (activeUserId && activeUserId !== nextUserId) {
      // Versions are page-local. User-keyed IndexedDB/sessionStorage entries stay isolated
      // and coexist across account switches; only explicit signOut clears persisted data.
      tableVersions.clear();
      snapshotVersions.clear();
      authVersion = 0;
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
  if (activeUserId !== normalizedUserId) return null;
  const key = cacheKey(normalizedUserId, table, orderCol, ascending, secondaryOrder);
  const currentVersion = liveTableCacheVersion(table);
  const indexed = await readIndexedValue(key);
  if (indexed.value) {
    try {
      const payload = parsePayload(indexed.value);
      const versionStale = versionChangedInThisPage(table) && payload.version !== undefined && payload.version !== currentVersion;
      return payloadResult(payload, versionStale);
    } catch {
      await removeIndexedValue(key);
    }
  }
  const fallback = fallbackPayload(key);
  if (!fallback) return null;
  const versionStale = versionChangedInThisPage(table) && fallback.version !== undefined && fallback.version !== currentVersion;
  if (indexed.available) {
    const migrated = { ...fallback, key, userId: normalizedUserId, table: String(table || "") };
    const migration = await writeIndexedValue(migrated);
    if (migration.available) removeFallbackValue(key);
  }
  return payloadResult(fallback, versionStale);
}

export function liveTableCacheVersion(table) {
  return `${cacheEpoch}:${tableVersions.get(String(table || "")) || 0}`;
}

export function liveAuthCacheVersion() {
  return `${cacheEpoch}:${authVersion}`;
}

export function liveSnapshotCacheVersion(snapshot) {
  const key = String(snapshot || "");
  return `${cacheEpoch}:${SNAPSHOT_CONTRACT_GENERATIONS.get(key) || 0}:${snapshotVersions.get(key) || 0}`;
}

export async function readLiveSnapshotCache({ userId, snapshot, companyId = "" }) {
  const normalizedUserId = String(userId || "");
  const normalizedSnapshot = String(snapshot || "");
  const normalizedCompanyId = String(companyId || "");
  if (!normalizedUserId || !normalizedSnapshot) return null;
  await activateLiveTableCacheUser(normalizedUserId);
  if (activeUserId !== normalizedUserId) return null;
  const key = snapshotCacheKey(normalizedUserId, normalizedSnapshot, normalizedCompanyId);
  const currentVersion = liveSnapshotCacheVersion(normalizedSnapshot);
  const usePayload = async (payload, remove) => {
    const versionState = snapshotVersionChangedInThisPage(normalizedSnapshot)
      ? snapshotVersionState(payload.version, currentVersion)
      : "current";
    if (versionState === "incompatible") {
      await remove();
      return null;
    }
    const age = Date.now() - payload.cachedAt;
    return {
      value: payload.value,
      // Age never turns a usable snapshot into a blank screen. Entries beyond the
      // retention window remain stale and are replaced after a successful SWR refresh.
      stale: versionState === "stale" || age >= LIVE_SNAPSHOT_CACHE_TTL_MS || age >= LIVE_SNAPSHOT_CACHE_MAX_AGE_MS,
      cachedAt: payload.cachedAt
    };
  };
  const indexed = await readIndexedValue(key);
  if (indexed.value) {
    try {
      return await usePayload(
        parseSnapshotPayload(indexed.value, normalizedUserId, normalizedSnapshot, normalizedCompanyId),
        () => removeIndexedValue(key)
      );
    } catch {
      await removeIndexedValue(key);
    }
  }
  const serialized = getFallbackValue(key);
  if (!serialized) return null;
  try {
    const payload = parseSnapshotPayload(serialized, normalizedUserId, normalizedSnapshot, normalizedCompanyId);
    const result = await usePayload(payload, async () => removeFallbackValue(key));
    if (!result) return null;
    if (indexed.available) {
      const migration = await writeIndexedValue(payload);
      if (migration.available) removeFallbackValue(key);
    }
    return result;
  } catch {
    removeFallbackValue(key);
    return null;
  }
}

export async function writeLiveSnapshotCache({ userId, snapshot, companyId = "", value, version }) {
  const normalizedUserId = String(userId || "");
  const normalizedSnapshot = String(snapshot || "");
  const normalizedCompanyId = String(companyId || "");
  if (!normalizedUserId || !normalizedSnapshot || !value || typeof value !== "object" || Array.isArray(value)) return false;
  if (version !== undefined && version !== liveSnapshotCacheVersion(normalizedSnapshot)) return false;
  await activateLiveTableCacheUser(normalizedUserId);
  if (version !== undefined && version !== liveSnapshotCacheVersion(normalizedSnapshot)) return false;
  const key = snapshotCacheKey(normalizedUserId, normalizedSnapshot, normalizedCompanyId);
  const payload = {
    key,
    userId: normalizedUserId,
    kind: "snapshot",
    table: "",
    snapshot: normalizedSnapshot,
    companyId: normalizedCompanyId,
    cachedAt: Date.now(),
    value,
    version: version ?? liveSnapshotCacheVersion(normalizedSnapshot)
  };
  const indexed = await writeIndexedValue(payload);
  if (indexed.available) {
    removeFallbackValue(key);
    if (payload.version !== liveSnapshotCacheVersion(normalizedSnapshot)) {
      await removeIndexedValue(key);
      return false;
    }
    return true;
  }
  const serialized = JSON.stringify(payload);
  if (serializedBytes(serialized) > LIVE_TABLE_CACHE_MAX_BYTES || payload.version !== liveSnapshotCacheVersion(normalizedSnapshot)) {
    removeFallbackValue(key);
    return false;
  }
  setFallbackValue(key, serialized);
  return true;
}

export async function invalidateLiveSnapshotCache(...snapshots) {
  const targets = new Set(snapshots.flat().map((snapshot) => String(snapshot || "")).filter(Boolean));
  if (!targets.size) return;
  targets.forEach((snapshot) => snapshotVersions.set(snapshot, (snapshotVersions.get(snapshot) || 0) + 1));
  fallbackKeys().forEach((key) => {
    if (!key.startsWith(CACHE_SNAPSHOT_PREFIX)) return;
    const [, snapshot = ""] = key.slice(CACHE_SNAPSHOT_PREFIX.length).split(":");
    if (targets.has(decodeURIComponent(snapshot))) removeFallbackValue(key);
  });
  await removeIndexedSnapshots(targets);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LIVE_SNAPSHOT_INVALIDATED_EVENT, { detail: { snapshots: [...targets] } }));
  }
}

export function markLiveSnapshotCacheStale(...snapshots) {
  const targets = new Set(snapshots.flat().map((snapshot) => String(snapshot || "")).filter(Boolean));
  if (!targets.size) return;
  targets.forEach((snapshot) => snapshotVersions.set(snapshot, (snapshotVersions.get(snapshot) || 0) + 1));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LIVE_SNAPSHOT_INVALIDATED_EVENT, { detail: { snapshots: [...targets] } }));
  }
}

export async function readLiveAuthCache(userId) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId) return null;
  await activateLiveTableCacheUser(normalizedUserId);
  if (activeUserId !== normalizedUserId) return null;
  const key = authCacheKey(normalizedUserId);
  const currentVersion = liveAuthCacheVersion();
  const indexed = await readIndexedValue(key);
  if (indexed.value) {
    try {
      const payload = parseAuthPayload(indexed.value, normalizedUserId);
      if (authVersionChangedInThisPage() && payload.version !== undefined && payload.version !== currentVersion) {
        await removeIndexedValue(key);
        return null;
      }
      return {
        employee: payload.employee,
        pendingCompanyIds: payload.pendingCompanyIds.slice(),
        stale: Date.now() - payload.cachedAt >= LIVE_AUTH_CACHE_TTL_MS
      };
    } catch {
      await removeIndexedValue(key);
    }
  }
  const serialized = getFallbackValue(key);
  if (!serialized) return null;
  try {
    const payload = parseAuthPayload(serialized, normalizedUserId);
    if (authVersionChangedInThisPage() && payload.version !== undefined && payload.version !== currentVersion) {
      removeFallbackValue(key);
      return null;
    }
    if (indexed.available) {
      const migrated = { ...payload, key, userId: normalizedUserId, kind: "auth", table: "" };
      const migration = await writeIndexedValue(migrated);
      if (migration.available) removeFallbackValue(key);
    }
    return {
      employee: payload.employee,
      pendingCompanyIds: payload.pendingCompanyIds.slice(),
      stale: Date.now() - payload.cachedAt >= LIVE_AUTH_CACHE_TTL_MS
    };
  } catch {
    removeFallbackValue(key);
    return null;
  }
}

export async function writeLiveAuthCache({ userId, employee, pendingCompanyIds = [], version }) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId || !employee || typeof employee !== "object" || Array.isArray(employee) ||
    !Array.isArray(pendingCompanyIds) || !pendingCompanyIds.every((companyId) => typeof companyId === "string")) return false;
  if (version !== undefined && version !== liveAuthCacheVersion()) return false;
  await activateLiveTableCacheUser(normalizedUserId);
  if (version !== undefined && version !== liveAuthCacheVersion()) return false;
  const key = authCacheKey(normalizedUserId);
  const payload = {
    key,
    userId: normalizedUserId,
    kind: "auth",
    table: "",
    cachedAt: Date.now(),
    employee,
    pendingCompanyIds: pendingCompanyIds.slice(),
    version: version ?? liveAuthCacheVersion()
  };
  const indexed = await writeIndexedValue(payload);
  if (indexed.available) {
    removeFallbackValue(key);
    if (payload.version !== liveAuthCacheVersion()) {
      await removeIndexedValue(key);
      return false;
    }
    return true;
  }
  const serialized = JSON.stringify(payload);
  if (serializedBytes(serialized) > LIVE_TABLE_CACHE_MAX_BYTES || payload.version !== liveAuthCacheVersion()) {
    removeFallbackValue(key);
    return false;
  }
  setFallbackValue(key, serialized);
  return true;
}

export async function invalidateLiveAuthCache() {
  authVersion += 1;
  fallbackKeys().forEach((key) => {
    if (key.startsWith(CACHE_AUTH_PREFIX)) removeFallbackValue(key);
  });
  await removeIndexedAuthValues();
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

function advanceLiveTableCacheVersions(tables) {
  const targets = new Set(tables.flat().map((table) => String(table || "")).filter(Boolean));
  targets.forEach((table) => tableVersions.set(table, (tableVersions.get(table) || 0) + 1));
  return targets;
}

export async function invalidateLiveTableCache(...tables) {
  const targets = advanceLiveTableCacheVersions(tables);
  if (!targets.size) return;
  const snapshots = snapshotsForTables(targets);
  if (snapshots.size) markLiveSnapshotCacheStale([...snapshots]);
}

export async function invalidateLiveTableCacheAfterWrite(...tables) {
  const targets = advanceLiveTableCacheVersions(tables);
  if (!targets.size) return;
  fallbackKeys().forEach((key) => {
    if (!key.startsWith(CACHE_ROWS_PREFIX)) return;
    const [, table = ""] = key.slice(CACHE_ROWS_PREFIX.length).split(":");
    if (targets.has(decodeURIComponent(table))) removeFallbackValue(key);
  });
  const snapshots = snapshotsForTables(targets);
  await Promise.all([
    removeIndexedTables(targets),
    snapshots.size ? invalidateLiveSnapshotCache([...snapshots]) : Promise.resolve()
  ]);
}

export function clearLiveTableCache() {
  return queueActivation(clearCacheStores);
}
