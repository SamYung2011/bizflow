export const READ_STATE_STORAGE_KEY = "tp-read-state-v1";
// 件5b (2026-08-04): "updates" 加入 READ_KEYS,给「更新日誌」tab 接真实未读判定复用同一套
// 水位机制(与 tasks/orders/messages/inventory 同构),不新造并行 read-state 系统。
const READ_KEYS = new Set(["tasks", "orders", "messages", "inventory", "updates"]);
let memoryState = {};
let unreadWatermarks = {};

// 件1 (2026-08-04 批4「红点是跟登录账号走的」煊煊拍板): 这套水位曾是全浏览器一份 flat 存储,同机
// 多账号会串号(A 号读过的分类,B 号一登录也显示已读)。改成按当前登录账号切物理 localStorage key。
// 账号身份只认 auth.js 的真实登录身份(session 存在时的 employee.id),由 provider.js 在
// buildUnreadState() 里每次 await 解析后回调 setReadStateAccount(),不是这个模块自己去 fetch
// session——这里保持纯存储层、可脱离网络/DOM 之外的东西单测。activeAccountId 为 null 时(未登录/
// 身份尚未解析出来)getReadState 恒返回 {}、markRead 恒 no-op——不读、不写、不亮,也不落回旧的
// 全局 key,避免用一个假身份写脏数据或提前泄漏还不确定是谁的已读状态。
let activeAccountId = null;
// 旧全局 key 不做数据搬迁(冷启=新账号 key 下 getReadState 返回 {},等价于"从来没读过"的首访全亮
// 态,这本来就是既有设计,见上面 5a 的空水位语义)。只在这个账号第一次成功写入新 key 后,顺手删一次
// 旧 key——一次性清理,不是每次 markRead 都删;账号切换(极少发生,通常伴随整页刷新)会重置这个
// 标记,让新账号也有一次清理机会。
let legacyKeyPurgedForAccount = undefined;

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, watermark]) => READ_KEYS.has(key) && typeof watermark === "string")
  );
}

function accountStorageKey(accountId) {
  return `${READ_STATE_STORAGE_KEY}:acct:${accountId}`;
}

// 唯一身份写入口:provider.js 的 buildUnreadState() 在每次算未读前都会 await 解析当前账号并调用
// 这个函数,保证"先知道是谁,再读/算未读",不依赖调用方恰好在同一个 Promise.all 里先 resolve 了
// getCurrentUser() 那种脆弱的时序假设。同一个账号重复调用是幂等 no-op。
export function setReadStateAccount(accountId) {
  const next = accountId ? String(accountId) : null;
  if (next === activeAccountId) return;
  activeAccountId = next;
  memoryState = {}; // 换账号(或退回未登录):内存缓存不能带着上一个身份的数据过去,下次 getReadState 会用新 key 重新灌。
}

export function getReadStateAccount() {
  return activeAccountId;
}

// shell.js 的跨 tab storage 事件监听要按"当前这个 tab 的账号自己的 key"精确匹配,不能用前缀模糊匹配
// ——否则会对"别的账号在另一个 tab 写自己的 key"这种事件也触发无谓重算(数据不会错,但没必要,也
// 违背"跟别的号无关就别响应"的精神)。没有 activeAccountId 时返回 null,天然匹配不上任何真实
// storage 事件的 event.key。
export function getActiveReadStateStorageKey() {
  return activeAccountId ? accountStorageKey(activeAccountId) : null;
}

function purgeLegacyReadStateKeyOnce() {
  if (legacyKeyPurgedForAccount === activeAccountId) return;
  legacyKeyPurgedForAccount = activeAccountId;
  try {
    window.localStorage.removeItem(READ_STATE_STORAGE_KEY);
  } catch {
    // Privacy mode or storage denial: nothing to clean up this session.
  }
}

export function getReadState() {
  const storageKey = getActiveReadStateStorageKey();
  if (!storageKey) return {}; // 未登录/身份未就绪:不读旧全局 key 兜底,恒空。
  try {
    const stored = window.localStorage.getItem(storageKey);
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
  const storageKey = getActiveReadStateStorageKey();
  if (!storageKey) return; // 未登录/身份未就绪:不写,也不派发 tp:unread-change——不能让 UI 表现得像"已经标记已读"。
  if (document.prerendering) {
    document.addEventListener("prerenderingchange", () => markRead(key, watermark), { once: true });
    return;
  }
  memoryState = { ...getReadState(), [key]: watermark };
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(memoryState));
    purgeLegacyReadStateKeyOnce();
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
