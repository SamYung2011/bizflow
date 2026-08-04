export const READ_STATE_STORAGE_KEY = "tp-read-state-v1";
// 件5b (2026-08-04): "updates" 加入 READ_KEYS,给「更新日誌」tab 接真实未读判定复用同一套
// 水位机制(与 tasks/orders/messages/inventory 同构),不新造并行 read-state 系统。
const READ_KEYS = new Set(["tasks", "orders", "messages", "inventory", "updates"]);
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
    // 件5a (2026-08-04, REDDOT-SURVEY 异常 #1): 外部/跨 tab 清空 localStorage 时 stored 是 null——
    // 之前只在 stored !== null 时才刷新 memoryState,导致本 tab 曾经 markRead 过的分类在清空后卡在
    // 内存里"半复位"(未标记过的分类正确复亮,标记过的死活不亮,直到整页刷新模块重新加载)。改成
    // 无论 stored 是否为 null 都覆盖 memoryState(null 归一化为 {}),清空立即对本 tab 生效,不必等
    // 刷新页面。JSON.parse 抛错(损坏数据/隐私模式拒绝存储)时仍走 catch,沿用上一次内存态不炸页面。
    memoryState = normalizeState(stored === null ? null : JSON.parse(stored));
  } catch {
    // Corrupt JSON, privacy mode, or storage denial: keep the in-memory state for this page session.
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
