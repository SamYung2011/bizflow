import { LIVE_SNAPSHOT_UPDATED_EVENT } from "./live-snapshot-dependencies.js";

function normalizedSet(values) {
  return new Set((Array.isArray(values) ? values : []).map((value) => String(value || "")).filter(Boolean));
}

export function liveSnapshotEventMatches(event, { snapshots = [], tables = [] } = {}) {
  const detail = event?.detail && typeof event.detail === "object" ? event.detail : {};
  const snapshotTargets = normalizedSet(snapshots);
  const tableTargets = normalizedSet(tables);
  if (detail.snapshot && snapshotTargets.has(String(detail.snapshot))) return true;
  if (Array.isArray(detail.snapshots) && detail.snapshots.some((snapshot) => snapshotTargets.has(String(snapshot || "")))) return true;
  return Array.isArray(detail.tables) && detail.tables.some((table) => tableTargets.has(String(table || "")));
}

export function attachLiveSnapshotRefresh({
  scope,
  target = typeof window === "undefined" ? null : window,
  snapshots = [],
  tables = [],
  isBlocked = () => false,
  refresh,
  warn = (...args) => console.warn(...args)
} = {}) {
  if (!scope || typeof refresh !== "function") throw new TypeError("Live snapshot refresh requires a page scope and refresh callback.");
  let pending = false;
  let refreshing = false;
  let disposed = false;

  async function run() {
    if (disposed || !scope.isCurrent()) return false;
    if (isBlocked()) {
      pending = true;
      return false;
    }
    if (refreshing) {
      pending = true;
      return false;
    }
    pending = false;
    refreshing = true;
    try {
      await refresh({
        defer() {
          pending = true;
        },
        isCurrent: () => !disposed && scope.isCurrent()
      });
      return true;
    } catch (error) {
      if (scope.isCurrent()) warn("[live-realtime] page refresh failed", error);
      return false;
    } finally {
      refreshing = false;
      if (pending && !disposed && scope.isCurrent() && !isBlocked()) queueMicrotask(() => void run());
    }
  }

  function onUpdated(event) {
    if (!liveSnapshotEventMatches(event, { snapshots, tables })) return;
    void run();
  }

  scope.listen(target, LIVE_SNAPSHOT_UPDATED_EVENT, onUpdated);
  scope.onCleanup(() => {
    disposed = true;
    pending = false;
  });

  return Object.freeze({
    flush() {
      if (!pending) return Promise.resolve(false);
      return run();
    },
    get pending() {
      return pending;
    }
  });
}
