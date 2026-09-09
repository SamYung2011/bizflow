import { RECEIPT_SIGN_TTL_SECONDS } from "./expense-receipt-path.js";

// One instance per page/account. Never persist signed bearer URLs in row data.
export function createReceiptUrlCache(signPaths, now = Date.now) {
  const cache = new Map();
  let generation = 0;
  let pending = null;
  const read = (path) => {
    const entry = cache.get(path);
    return entry && entry.expiresAt - now() > 5 * 60 * 1000 ? entry.url : "";
  };
  const remember = (path, url, issuedAt = now()) => {
    if (path && url) cache.set(path, { url, expiresAt: issuedAt + RECEIPT_SIGN_TTL_SECONDS * 1000 });
  };
  return {
    read,
    remember,
    clear() { generation += 1; cache.clear(); },
    async resolve(paths) {
      const requestGeneration = generation;
      if (pending) await pending;
      if (requestGeneration !== generation) return new Map();
      const unique = [...new Set(paths.filter(Boolean))];
      const missing = unique.filter((path) => !read(path));
      const started = now();
      if (missing.length) {
        const request = (async () => {
          const signed = await signPaths(missing, RECEIPT_SIGN_TTL_SECONDS);
          if (requestGeneration !== generation) return;
          for (const path of missing) remember(path, signed.get(path), started);
        })();
        pending = request;
        try { await request; } finally { if (pending === request) pending = null; }
      }
      return new Map(unique.filter((path) => read(path)).map((path) => [path, read(path)]));
    }
  };
}
