import { getSession, getSupabaseClient, TRANSIENT_AUTH_RESET_EVENT } from "./auth.js";
import { LIVE_SNAPSHOT_INVALIDATED_EVENT } from "./live-snapshot-dependencies.js";
import { invalidateLiveQueryCacheAfterWrite, readLiveQueryCache, writeLiveQueryCache } from "./live-query-cache.js";
import { customerRow } from "./live-customers-query.js";

export const LIVE_CUSTOMER_DETAIL_MISS = Symbol("live-customer-detail-miss");
const NAMESPACE = "customer-detail";
const requests = new Map();
let userId = "";
let generation = 0;

function invalidate() {
  generation += 1;
  requests.clear();
  if (userId) invalidateLiveQueryCacheAfterWrite({ userId, namespace: NAMESPACE });
}

if (typeof window !== "undefined") {
  window.addEventListener(TRANSIENT_AUTH_RESET_EVENT, () => { invalidate(); userId = ""; });
  window.addEventListener(LIVE_SNAPSHOT_INVALIDATED_EVENT, (event) => {
    if ((event.detail?.snapshots ?? []).some((name) => ["customers.json", "warranty.json", "orders.json"].includes(name))) invalidate();
  });
}

export async function getLiveCustomerDetail(id, { refresh = false } = {}) {
  const [client, session] = await Promise.all([getSupabaseClient(), getSession()]);
  if (!client || !session?.user?.id) return LIVE_CUSTOMER_DETAIL_MISS;
  const account = session.user.id;
  if (account !== userId) { invalidate(); userId = account; }
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(id || ""))) return null;
  const query = { id: String(id) };
  const version = generation;
  const cached = readLiveQueryCache({ userId: account, namespace: NAMESPACE, query });
  if (cached && !cached.stale && !refresh) return cached.value;
  const key = `${account}:${version}:${query.id}`;
  if (requests.has(key)) return requests.get(key);
  const request = (async () => {
    const result = await client.rpc("bizflow_customer_detail", { p_customer_id: query.id });
    if (version !== generation || userId !== account) throw new DOMException("Customer detail superseded", "AbortError");
    if (result.error) throw result.error;
    if (!result.data) return null;
    if (!result.data.customer?.id || !Array.isArray(result.data.customer.detail?.orders)
      || !Array.isArray(result.data.members) || !Array.isArray(result.data.devices) || !Array.isArray(result.data.warranties)) {
      throw new Error("Invalid customer detail payload");
    }
    const customer = customerRow(result.data.customer);
    const value = { customer, detail: customer.detail, members: result.data.members, devices: result.data.devices, warranties: result.data.warranties };
    writeLiveQueryCache({ userId: account, namespace: NAMESPACE, query, value });
    return value;
  })().finally(() => { if (requests.get(key) === request) requests.delete(key); });
  requests.set(key, request);
  return request;
}
