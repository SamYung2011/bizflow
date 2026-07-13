const memorySession = new Map();
const consumedKeys = new Set();

function normalizeKey(key) {
  return typeof key === "string" && key !== "" ? key : null;
}

export function getSessionValue(key) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey || consumedKeys.has(normalizedKey)) return null;
  try {
    const stored = window.sessionStorage.getItem(normalizedKey);
    if (stored !== null) memorySession.set(normalizedKey, stored);
  } catch {
    // Privacy mode or storage denial: keep the in-memory value for this page session.
  }
  return memorySession.get(normalizedKey) ?? null;
}

export function setSessionValue(key, value) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey || typeof value !== "string") return;
  consumedKeys.delete(normalizedKey);
  memorySession.set(normalizedKey, value);
  try {
    window.sessionStorage.setItem(normalizedKey, value);
  } catch {
    // In-memory fallback is already updated.
  }
}

export function consumeSessionValue(key) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return null;
  const value = getSessionValue(normalizedKey);
  consumedKeys.add(normalizedKey);
  memorySession.delete(normalizedKey);
  try {
    window.sessionStorage.removeItem(normalizedKey);
  } catch {
    // The tombstone prevents this page session from consuming a stale value twice.
  }
  return value;
}
