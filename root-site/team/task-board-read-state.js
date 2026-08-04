export const TASK_BOARD_READ_STATE_STORAGE_KEY = "tp-task-board-read-v1";

const STORAGE_VERSION = 1;
const CHUNK_SIZE = 24;

function asText(value) {
  return value == null ? "" : String(value);
}

function stableRows(rows, project) {
  return (Array.isArray(rows) ? rows : [])
    .map(project)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function stableAttachmentUrl(value) {
  const raw = asText(value).trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, "https://task-attachment.invalid");
    return parsed.origin === "https://task-attachment.invalid"
      ? parsed.pathname
      : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return raw.split(/[?#]/, 1)[0];
  }
}

function taskFingerprintValue(task, ancestors = new Set()) {
  const id = asText(task?.id);
  if (!id || ancestors.has(id)) return [id, "cycle"];
  const nextAncestors = new Set(ancestors).add(id);
  return [
    id,
    asText(task?.title),
    asText(task?.content ?? task?.note),
    asText(task?.priority),
    asText(task?.status),
    task?.done === true,
    asText(task?.due),
    asText(task?.startDate),
    asText(task?.completedAt),
    asText(task?.creatorId),
    asText(task?.departmentId),
    asText(task?.visibility),
    task?.requiresReview === true,
    asText(task?.approvedAt),
    stableRows(task?.assignees, (assignee) => [
      asText(assignee?.employeeId),
      asText(assignee?.completedAt),
      asText(assignee?.abandonedAt)
    ]),
    stableRows(task?.attachments, (attachment) => [
      stableAttachmentUrl(attachment?.url),
      asText(attachment?.name),
      asText(attachment?.type),
      Number(attachment?.size) || 0
    ]),
    stableRows(task?.feedback, (entry) => [
      asText(entry?.id),
      asText(entry?.authorUserId),
      asText(entry?.timestamp ?? entry?.time),
      asText(entry?.message ?? entry?.body),
      asText(entry?.parentId),
      stableRows(entry?.mentionedUserIds, (employeeId) => asText(employeeId)),
      stableRows(entry?.attachments, (attachment) => [
        stableAttachmentUrl(attachment?.url),
        asText(attachment?.name),
        asText(attachment?.type),
        Number(attachment?.size) || 0
      ])
    ]),
    stableRows(task?.subtasks, (subtask) => taskFingerprintValue(subtask, nextAncestors))
  ];
}

export function taskBoardFingerprint(task) {
  return JSON.stringify(taskFingerprintValue(task));
}

// 件1 (2026-08-04 批4「红点是跟登录账号走的」煊煊拍板): 这套指纹基线原先是单一全局 localStorage
// key,内部按 scopeKey(company:employeeId)拆子对象区分账号。现在物理 key 本身也按账号拆开——多
// 账号同机时连"同一个 key 下不同子对象共用一次读写"这层都不留,直接是两把互不相干的锁,不依赖内部
// scopes 分区不出错。accountId 缺失(未登录/身份未就绪)时返回 null,调用方(createTaskBoardReadTracker)
// 据此把整个 tracker 惰性化——这个函数本身保持纯函数,不猜测身份、不读写任何东西。
function accountScopedStorageKey(accountId) {
  return accountId ? `${TASK_BOARD_READ_STATE_STORAGE_KEY}:acct:${accountId}` : null;
}

// 旧全局 key 不做数据搬迁——冷启即空基线,是 refresh() 里 baseline===null 分支本来就有的"无基线=
// 暂不算未读"语义,不是这次改动新造的行为。只在账号命名空间的新 key 第一次写入成功后,顺手删一次
// 旧 key;每个 accountId 只删一次,不是每次 markSeen/refresh 都删。
const legacyPurgeDoneForAccount = new Set();

function purgeLegacyTaskBoardKeyOnce(storage, accountId) {
  if (!storage || legacyPurgeDoneForAccount.has(accountId)) return;
  legacyPurgeDoneForAccount.add(accountId);
  try {
    storage.removeItem(TASK_BOARD_READ_STATE_STORAGE_KEY);
  } catch {
    // Privacy mode or storage denial: nothing to clean up this session.
  }
}

function normalizedStoredRoot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== STORAGE_VERSION) {
    return { version: STORAGE_VERSION, scopes: {} };
  }
  const scopes = value.scopes && typeof value.scopes === "object" && !Array.isArray(value.scopes)
    ? value.scopes
    : {};
  return { version: STORAGE_VERSION, scopes: { ...scopes } };
}

function readStoredRoot(storage, storageKey) {
  try {
    return normalizedStoredRoot(JSON.parse(storage?.getItem(storageKey) || "null"));
  } catch {
    return normalizedStoredRoot(null);
  }
}

function readBaseline(storage, storageKey, scopeKey) {
  const scope = readStoredRoot(storage, storageKey).scopes[scopeKey];
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const signatures = scope.signatures;
  if (!signatures || typeof signatures !== "object" || Array.isArray(signatures)) return null;
  return {
    complete: scope.complete === true,
    signatures: Object.fromEntries(Object.entries(signatures).filter(([id, signature]) => id && typeof signature === "string"))
  };
}

function writeBaseline(storage, storageKey, accountId, scopeKey, signatures) {
  if (!storage || !storageKey) return;
  const root = readStoredRoot(storage, storageKey);
  root.scopes[scopeKey] = { complete: true, signatures: { ...signatures } };
  try {
    storage.setItem(storageKey, JSON.stringify(root));
    purgeLegacyTaskBoardKeyOnce(storage, accountId);
  } catch {
    // Privacy mode or storage denial: the in-memory baseline remains usable for this mount.
  }
}

function defaultSchedule(callback) {
  if (typeof requestIdleCallback === "function") {
    return { type: "idle", id: requestIdleCallback(callback, { timeout: 250 }) };
  }
  return {
    type: "timeout",
    id: setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 8 }), 0)
  };
}

function defaultCancel(handle) {
  if (!handle) return;
  if (handle.type === "idle" && typeof cancelIdleCallback === "function") cancelIdleCallback(handle.id);
  if (handle.type === "timeout") clearTimeout(handle.id);
}

function defaultStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function createTaskBoardReadTracker({
  scopeKey,
  accountId = null,
  storage = defaultStorage(),
  schedule = defaultSchedule,
  cancel = defaultCancel,
  onUnreadChange = () => {}
}) {
  const storageKey = accountScopedStorageKey(accountId);
  const storedBaseline = storageKey ? readBaseline(storage, storageKey, scopeKey) : null;
  let baseline = storedBaseline?.signatures ?? null;
  let baselineComplete = storedBaseline?.complete === true;
  let currentSignatures = {};
  let unreadIds = new Set();
  let generation = 0;
  let scheduled = null;
  let disposed = false;

  function emit() {
    onUnreadChange(new Set(unreadIds));
  }

  function refresh(tasks) {
    generation += 1;
    const refreshGeneration = generation;
    cancel(scheduled);
    scheduled = null;
    // 件1: 没有账号身份就没有"我看过没看过"这件事——不读、不算、不亮,交白卷式地保持空未读,而不是
    // "当没登录时假装全部未读"那种更吵的默认态(那是 read-state.js 那套水位系统自己的冷启语义,两套
    // 系统的"缺省"含义本来就不同,这里不强行对齐)。仍然走 schedule() 异步一拍,保持与正常路径同样
    // 的"onUnreadChange 总是异步到达"契约,调用方不用为这一种情况特殊处理时序。
    if (!storageKey) {
      scheduled = schedule(() => {
        scheduled = null;
        if (disposed || refreshGeneration !== generation) return;
        currentSignatures = {};
        unreadIds = new Set();
        emit();
      });
      return;
    }
    const roots = (Array.isArray(tasks) ? tasks : []).filter((task) => task?.parentId == null && task?.id);
    const nextSignatures = {};
    let index = 0;

    const runChunk = (deadline) => {
      scheduled = null;
      if (disposed || refreshGeneration !== generation) return;
      let processed = 0;
      while (index < roots.length && processed < CHUNK_SIZE &&
        (processed === 0 || deadline?.didTimeout || Number(deadline?.timeRemaining?.() ?? 0) > 1)) {
        const task = roots[index++];
        nextSignatures[String(task.id)] = taskBoardFingerprint(task);
        processed += 1;
      }
      if (index < roots.length) {
        scheduled = schedule(runChunk);
        return;
      }

      currentSignatures = nextSignatures;
      if (baseline === null || !baselineComplete) {
        baseline = { ...currentSignatures };
        baselineComplete = true;
        unreadIds = new Set();
        writeBaseline(storage, storageKey, accountId, scopeKey, baseline);
        emit();
        return;
      }

      const retainedBaseline = Object.fromEntries(
        Object.entries(baseline).filter(([id]) => Object.hasOwn(currentSignatures, id))
      );
      const removedStaleRows = Object.keys(retainedBaseline).length !== Object.keys(baseline).length;
      baseline = retainedBaseline;
      unreadIds = new Set(Object.keys(currentSignatures).filter((id) => baseline[id] !== currentSignatures[id]));
      if (removedStaleRows) writeBaseline(storage, storageKey, accountId, scopeKey, baseline);
      emit();
    };

    scheduled = schedule(runChunk);
  }

  function markSeen(taskIds) {
    if (!storageKey) return false;
    let changed = false;
    for (const rawId of taskIds ?? []) {
      const id = String(rawId || "");
      if (!unreadIds.has(id) || !Object.hasOwn(currentSignatures, id)) continue;
      baseline ??= {};
      baseline[id] = currentSignatures[id];
      unreadIds.delete(id);
      changed = true;
    }
    if (!changed) return false;
    writeBaseline(storage, storageKey, accountId, scopeKey, baseline);
    emit();
    return true;
  }

  function dispose() {
    disposed = true;
    generation += 1;
    cancel(scheduled);
    scheduled = null;
  }

  return Object.freeze({ refresh, markSeen, dispose });
}

export function createTaskBoardColumnReadObserver({
  tracker,
  documentRef = typeof document === "undefined" ? null : document,
  Observer = typeof IntersectionObserver === "undefined" ? null : IntersectionObserver,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer),
  settleMs = 500,
  visibilityThreshold = 0.75
}) {
  let observer = null;
  const timers = new Map();

  function clear() {
    observer?.disconnect();
    observer = null;
    timers.forEach((timer) => cancel(timer));
    timers.clear();
  }

  function markColumnSeen(header) {
    if (!header?.isConnected || documentRef?.visibilityState === "hidden") return false;
    const taskIds = [...(header.closest?.("[data-task-column]")?.querySelectorAll?.("[data-task-card]") ?? [])]
      .map((card) => card.getAttribute?.("data-task-card"))
      .filter(Boolean);
    return tracker.markSeen(taskIds);
  }

  function observe() {
    clear();
    if (!documentRef || !tracker) return;
    const headers = [...documentRef.querySelectorAll("[data-task-column-read]")]
      .filter((header) => header.closest?.("[data-task-column]")?.querySelector?.("[data-task-column-unread]"));
    if (!headers.length) return;
    if (typeof Observer !== "function") {
      headers.forEach(markColumnSeen);
      return;
    }
    observer = new Observer((entries) => {
      entries.forEach((entry) => {
        const header = entry.target;
        const existing = timers.get(header);
        if (existing !== undefined) cancel(existing);
        timers.delete(header);
        if (!entry.isIntersecting || entry.intersectionRatio < visibilityThreshold ||
          documentRef.visibilityState === "hidden") return;
        const timer = schedule(() => {
          timers.delete(header);
          markColumnSeen(header);
        }, settleMs);
        timers.set(header, timer);
      });
    }, { threshold: [0, visibilityThreshold] });
    headers.forEach((header) => observer.observe(header));
  }

  return Object.freeze({ observe, clear, dispose: clear });
}
