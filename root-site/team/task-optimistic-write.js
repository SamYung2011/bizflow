export function createOptimisticWriteCoordinator() {
  const inFlight = new Map();

  return Object.freeze({
    get pending() {
      return inFlight.size > 0;
    },
    has(key) {
      return inFlight.has(String(key || ""));
    },
    run(key, { apply, write, isCurrent = () => true, reconcile, rollback, onFailure } = {}) {
      const normalizedKey = String(key || "");
      if (!normalizedKey || inFlight.has(normalizedKey)) return null;
      if (typeof apply !== "function" || typeof write !== "function") {
        throw new TypeError("Optimistic writes require apply and write callbacks.");
      }

      const token = {};
      inFlight.set(normalizedKey, token);
      try {
        // An async function runs synchronously until its first await. Keeping apply outside
        // settle makes the local UI transition explicit and testable before write() resolves.
        apply();
      } catch (error) {
        if (inFlight.get(normalizedKey) === token) inFlight.delete(normalizedKey);
        throw error;
      }

      return (async () => {
        try {
          const result = await write();
          if (isCurrent()) reconcile?.(result);
          return result;
        } catch (error) {
          if (isCurrent()) {
            rollback?.();
            onFailure?.(error);
          }
          return undefined;
        } finally {
          // clear() marks an old mount's writes stale. Do not let their late finally
          // delete a newer mount's in-flight write for the same task id.
          if (inFlight.get(normalizedKey) === token) inFlight.delete(normalizedKey);
        }
      })();
    },
    clear() {
      inFlight.clear();
    }
  });
}
