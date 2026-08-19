// Small, account-scoped query cache for server-paged views. Unlike the legacy
// table cache this stores only bounded result pages, so an offline fallback can
// never grow back into a whole-table download.

const CACHE_PREFIX = "tp-live-query:v1:";
const MEMORY_CACHE = new Map();
const MAX_ENTRIES_PER_SCOPE = 12;
const FRESH_MS = 60_000;

function storage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function liveQueryKey(query) {
  return JSON.stringify(stableValue(query ?? {}));
}

function scopePrefix(userId, namespace) {
  return `${CACHE_PREFIX}${encodeURIComponent(String(userId || ""))}:${encodeURIComponent(String(namespace || ""))}:`;
}

function cacheKey(userId, namespace, query) {
  return `${scopePrefix(userId, namespace)}${encodeURIComponent(liveQueryKey(query))}`;
}

function parseEntry(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.value != null ? parsed : null;
  } catch {
    return null;
  }
}

function storedKeys(prefix = CACHE_PREFIX) {
  const target = storage();
  const keys = new Set([...MEMORY_CACHE.keys()].filter((key) => key.startsWith(prefix)));
  if (!target) return [...keys];
  try {
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index);
      if (key?.startsWith(prefix)) keys.add(key);
    }
  } catch {
    return [...keys];
  }
  return [...keys];
}

function readRaw(key) {
  const target = storage();
  try {
    return target?.getItem(key) ?? MEMORY_CACHE.get(key) ?? null;
  } catch {
    return MEMORY_CACHE.get(key) ?? null;
  }
}

function writeRaw(key, value) {
  MEMORY_CACHE.set(key, value);
  try {
    storage()?.setItem(key, value);
  } catch {
    // localStorage may be unavailable or full; the in-memory page fallback is still useful.
  }
}

function removeRaw(key) {
  MEMORY_CACHE.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    // Best effort: account scoping prevents an unreadable old key leaking into another account.
  }
}

function trimScope(userId, namespace) {
  const prefix = scopePrefix(userId, namespace);
  const entries = storedKeys(prefix).map((key) => ({ key, entry: parseEntry(readRaw(key)) }))
    .sort((left, right) => Number(right.entry?.cachedAt || 0) - Number(left.entry?.cachedAt || 0));
  entries.slice(MAX_ENTRIES_PER_SCOPE).forEach(({ key }) => removeRaw(key));
}

export function readLiveQueryCache({ userId, namespace, query, now = Date.now() }) {
  if (!userId || !namespace) return null;
  const entry = parseEntry(readRaw(cacheKey(userId, namespace, query)));
  if (!entry) return null;
  return {
    value: entry.value,
    cachedAt: Number(entry.cachedAt || 0),
    stale: entry.stale === true || now - Number(entry.cachedAt || 0) > FRESH_MS
  };
}

export function writeLiveQueryCache({ userId, namespace, query, value, stale = false, now = Date.now() }) {
  if (!userId || !namespace || value == null) return false;
  const key = cacheKey(userId, namespace, query);
  writeRaw(key, JSON.stringify({ cachedAt: now, stale: stale === true, value }));
  trimScope(userId, namespace);
  return true;
}

export function markLiveQueryCacheStale({ userId, namespace, query = null }) {
  if (!userId || !namespace) return;
  const keys = query == null
    ? storedKeys(scopePrefix(userId, namespace))
    : [cacheKey(userId, namespace, query)];
  keys.forEach((key) => {
    const entry = parseEntry(readRaw(key));
    if (entry) writeRaw(key, JSON.stringify({ ...entry, stale: true }));
  });
}

export function invalidateLiveQueryCacheAfterWrite({ userId, namespace, preserve = null }) {
  if (!userId || !namespace) return;
  storedKeys(scopePrefix(userId, namespace)).forEach(removeRaw);
  if (preserve?.query && preserve.value != null) {
    writeLiveQueryCache({ userId, namespace, query: preserve.query, value: preserve.value, stale: true });
  }
}

export function clearLiveQueryCache() {
  storedKeys().forEach(removeRaw);
}

export const liveQueryCachePolicy = Object.freeze({
  freshMs: FRESH_MS,
  maxEntriesPerScope: MAX_ENTRIES_PER_SCOPE
});
