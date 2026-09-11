import { getSession, getSupabaseClient, getRememberedActiveCompanyId, TRANSIENT_AUTH_RESET_EVENT } from './auth.js';
import { liveAuthCacheVersion, liveSnapshotCacheVersion } from './live-table-cache.js';
import { readLiveQueryCache, writeLiveQueryCache } from './live-query-cache.js';

const dependencies = {
  'orders-page': ['orders.json'], 'order-revenue': ['orders.json'],
  'customers-page': ['customers.json', 'warranty.json'], 'warranty-page': ['warranty.json'],
  'home-dashboard': ['home.json'],
  unread: ['tasks.json','orders.json','whatsapp.json','inventory.json','team-update-logs.json']
};
const dirty = new Map();
if (typeof window !== "undefined") window.addEventListener("tp:live-snapshot-invalidated", (event) => {
  for (const name of event.detail?.snapshots ?? []) dirty.set(name, (dirty.get(name) || 0) + 1);
});
const pageId = `${Date.now()}:${Math.random()}`;
let epoch = 0;
let activeUserId = '';
if (typeof window !== 'undefined') window.addEventListener(TRANSIENT_AUTH_RESET_EVENT, () => { epoch += 1; activeUserId = ''; });

export function liveReadVersion(userId, namespace, companyId = getRememberedActiveCompanyId(userId)) {
  return JSON.stringify([userId, companyId, epoch, liveAuthCacheVersion(),
    (dependencies[namespace] ?? (namespace.endsWith(".json") ? [namespace] : [])).map((name) => [liveSnapshotCacheVersion(name), dirty.get(name) || 0]), pageId]);
}

export async function sessionReadContext(namespace) {
  const startedEpoch = epoch;
  const [client, session] = await Promise.all([getSupabaseClient(), getSession()]);
  if (startedEpoch !== epoch) throw new DOMException("Live identity reset", "AbortError");
  if (!client || !session?.user?.id) return null;
  const userId = session.user.id;
  if (activeUserId && activeUserId !== userId) epoch += 1;
  activeUserId = userId;
  return { client, userId, namespace, scopeKey: liveReadVersion(userId, namespace) };
}

export function isReadContextCurrent(context) {
  return context.userId === activeUserId && context.scopeKey === liveReadVersion(context.userId, context.namespace);
}

export function assertReadContextCurrent(context) {
  if (!isReadContextCurrent(context)) throw new DOMException('Live read superseded', 'AbortError');
}

export function readScopedQueryCache(context, query) {
  const entry = readLiveQueryCache({ userId: context.userId, namespace: context.namespace, query });
  if (entry?.scopeKey === context.scopeKey) return entry;
  // Runtime invalidation counters restart on document reload. Adopt persisted
  // data only before this document has any auth/snapshot invalidation, and only
  // for the same identity/company and snapshot schema generations.
  try {
    const before = JSON.parse(entry?.scopeKey);
    const now = JSON.parse(context.scopeKey);
    const clean = now[2] === 0 && now[3] === '0:0' && now[4].every(([v, dirty]) => v.split(':')[0] === '0' && v.split(':')[2] === '0' && dirty === 0);
    const contracts = now[4].every(([v], i) => v.split(':')[1] === before[4]?.[i]?.[0]?.split(':')[1]);
    if (before[5] && before[5] !== pageId && before[0] === now[0] && before[1] === now[1] && clean && contracts) return entry;
  } catch { /* Old or malformed entries need one fresh read. */ }
  return null;
}

export function writeScopedQueryCache(context, query, value) {
  assertReadContextCurrent(context);
  writeLiveQueryCache({ userId: context.userId, namespace: context.namespace, query, value, scopeKey: context.scopeKey });
}
