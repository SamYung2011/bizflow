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

function normalizedStoredRoot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== STORAGE_VERSION) {
    return { version: STORAGE_VERSION, scopes: {} };
  }
  const scopes = value.scopes && typeof value.scopes === "object" && !Array.isArray(value.scopes)
    ? value.scopes
    : {};
  return { version: STORAGE_VERSION, scopes: { ...scopes } };
}

function readStoredRoot(storage) {
  try {
    return normalizedStoredRoot(JSON.parse(storage?.getItem(TASK_BOARD_READ_STATE_STORAGE_KEY) || "null"));
  } catch {
    return normalizedStoredRoot(null);
  }
}

function readBaseline(storage, scopeKey) {
  const scope = readStoredRoot(storage).scopes[scopeKey];
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const signatures = scope.signatures;
  if (!signatures || typeof signatures !== "object" || Array.isArray(signatures)) return null;
  return {
    complete: scope.complete === true,
    signatures: Object.fromEntries(Object.entries(signatures).filter(([id, signature]) => id && typeof signature === "string"))
  };
}

function writeBaseline(storage, scopeKey, signatures) {
  if (!storage) return;
  const root = readStoredRoot(storage);
  root.scopes[scopeKey] = { complete: true, signatures: { ...signatures } };
  try {
    storage.setItem(TASK_BOARD_READ_STATE_STORAGE_KEY, JSON.stringify(root));
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
  storage = defaultStorage(),
  schedule = defaultSchedule,
  cancel = defaultCancel,
  onUnreadChange = () => {}
}) {
  const storedBaseline = readBaseline(storage, scopeKey);
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
        writeBaseline(storage, scopeKey, baseline);
        emit();
        return;
      }

      const retainedBaseline = Object.fromEntries(
        Object.entries(baseline).filter(([id]) => Object.hasOwn(currentSignatures, id))
      );
      const removedStaleRows = Object.keys(retainedBaseline).length !== Object.keys(baseline).length;
      baseline = retainedBaseline;
      unreadIds = new Set(Object.keys(currentSignatures).filter((id) => baseline[id] !== currentSignatures[id]));
      if (removedStaleRows) writeBaseline(storage, scopeKey, baseline);
      emit();
    };

    scheduled = schedule(runChunk);
  }

  function markSeen(taskIds) {
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
    writeBaseline(storage, scopeKey, baseline);
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
