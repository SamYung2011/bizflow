const snapshotPromises = new Map();
let revision = 0;

function snapshotKey(value) {
  return String(value || "").trim();
}

function advanceRevision() {
  revision += 1;
}

export function providerSnapshotRevision() {
  return revision;
}

export function loadProviderSnapshot(snapshot, loader) {
  const key = snapshotKey(snapshot);
  if (!key || typeof loader !== "function") return Promise.resolve(null);
  if (!snapshotPromises.has(key)) {
    const promise = Promise.resolve().then(loader).catch((error) => {
      if (snapshotPromises.get(key) === promise) snapshotPromises.delete(key);
      throw error;
    });
    snapshotPromises.set(key, promise);
  }
  return snapshotPromises.get(key);
}

export function invalidateProviderSnapshotMemo(...snapshots) {
  const targets = snapshots.flat().map(snapshotKey).filter(Boolean);
  if (!targets.length) return;
  targets.forEach((snapshot) => snapshotPromises.delete(snapshot));
  advanceRevision();
}

export function updateProviderSnapshotMemo(snapshot, value) {
  const key = snapshotKey(snapshot);
  if (!key) return;
  snapshotPromises.set(key, Promise.resolve(value));
  advanceRevision();
}

export function clearProviderSnapshotMemo() {
  if (!snapshotPromises.size) return;
  snapshotPromises.clear();
  advanceRevision();
}
