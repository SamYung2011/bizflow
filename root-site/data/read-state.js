export const READ_STATE_STORAGE_KEY = "tp-read-state-v1";
const READ_KEYS = new Set(["tasks", "orders", "messages", "inventory"]);
let memoryState = {};
let unreadWatermarks = {};

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, watermark]) => READ_KEYS.has(key) && typeof watermark === "string")
  );
}

export function getReadState() {
  try {
    const stored = window.localStorage.getItem(READ_STATE_STORAGE_KEY);
    if (stored !== null) memoryState = normalizeState(JSON.parse(stored));
  } catch {
    // Privacy mode or storage denial: keep the in-memory state for this page session.
  }
  return { ...memoryState };
}

export function markRead(key, watermark) {
  if (!READ_KEYS.has(key) || typeof watermark !== "string" || watermark === "") return;
  if (document.prerendering) {
    document.addEventListener("prerenderingchange", () => markRead(key, watermark), { once: true });
    return;
  }
  memoryState = { ...getReadState(), [key]: watermark };
  try {
    window.localStorage.setItem(READ_STATE_STORAGE_KEY, JSON.stringify(memoryState));
  } catch {
    // In-memory fallback is already updated.
  }
  window.dispatchEvent(new CustomEvent("tp:unread-change", { detail: { key, watermark } }));
}

export function rememberUnreadWatermarks(watermarks) {
  unreadWatermarks = normalizeState(watermarks);
}

export function getRememberedUnreadWatermarks() {
  return { ...unreadWatermarks };
}
