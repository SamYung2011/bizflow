import { getUnread, getUnreadWatermarks } from "./provider.js";
import { setReadStateAccount } from "./read-state.js";

const unreadByAccount = new Map();

function accountKey(currentUser) {
  const authenticated = typeof currentUser?.hasPermission === "function";
  const accountId = authenticated ? String(currentUser?.id || "") : "";
  setReadStateAccount(accountId || null);
  return accountId ? `account:${accountId}` : "demo";
}

function cloneState(value = {}) {
  return Object.fromEntries(Object.entries(value && typeof value === "object" ? value : {}));
}

export function cachedPageUnread(currentUser) {
  const cached = unreadByAccount.get(accountKey(currentUser));
  return {
    unread: cloneState(cached?.unread),
    watermarks: cloneState(cached?.watermarks),
  };
}

export function loadPageUnread({
  scope,
  currentUser,
  onUpdate = () => {},
  readUnread = getUnread,
  readWatermarks = getUnreadWatermarks,
  dispatchUpdated = () => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("tp:unread-change"));
  },
}) {
  const key = accountKey(currentUser);
  const promise = Promise.all([readUnread(), readWatermarks()])
    .then(([unread, watermarks]) => {
      const next = { unread: cloneState(unread), watermarks: cloneState(watermarks) };
      unreadByAccount.set(key, next);
      if (!scope?.isCurrent?.()) return next;
      onUpdate(next);
      dispatchUpdated(next);
      return next;
    })
    .catch((error) => {
      if (scope?.isCurrent?.()) console.warn("[page-unread] background refresh failed", error);
      return null;
    });
  return promise;
}
