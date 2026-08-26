import { getSession, getSupabaseClient, TRANSIENT_AUTH_RESET_EVENT } from "./auth.js";
import { asArray, asNumber, asText } from "./live-snapshot-utils.js";
import {
  liveQueryKey,
  markLiveQueryCacheStale,
  readLiveQueryCache,
  writeLiveQueryCache
} from "./live-query-cache.js";
import { LIVE_SNAPSHOT_INVALIDATED_EVENT } from "./live-snapshot-dependencies.js";

export const LIVE_CUSTOMER_QUERY_MISS = Symbol("live-customer-query-miss");
export const CUSTOMER_QUERY_UPDATED_EVENT = "tp:customer-query-updated";
export const WARRANTY_QUERY_UPDATED_EVENT = "tp:warranty-query-updated";

const CUSTOMER_NAMESPACE = "customers-page";
const WARRANTY_NAMESPACE = "warranty-page";
const CUSTOMER_SOURCES = new Set(["all", "shopify", "framer", "other"]);
const CUSTOMER_IMEI_FILTERS = new Set(["all", "has", "none"]);
const CUSTOMER_SORTS = new Set(["createdDesc", "createdAsc", "lastPurchaseDesc", "lastPurchaseAsc"]);
const WARRANTY_BUCKETS = new Set(["all", "expired", "week", "month", "quarter", "year"]);
const NETWORK_REQUESTS = new Map();

let activeCustomerQuery = null;
let activeWarrantyQuery = null;
let activeUserId = "";
let queryGeneration = 0;

function resetQueryState() {
  queryGeneration += 1;
  activeCustomerQuery = null;
  activeWarrantyQuery = null;
  activeUserId = "";
  NETWORK_REQUESTS.clear();
}

function invalidatedSnapshots(event) {
  const snapshots = event?.detail?.snapshots;
  return new Set(Array.isArray(snapshots) ? snapshots.map(String) : []);
}

if (typeof window !== "undefined") {
  window.addEventListener(TRANSIENT_AUTH_RESET_EVENT, resetQueryState);
  // Existing customer/warranty write helpers already invalidate these snapshot
  // names. Translate that signal into bounded-query staleness without touching
  // any write path or bringing the old whole-table cache back into the list.
  window.addEventListener(LIVE_SNAPSHOT_INVALIDATED_EVENT, (event) => {
    if (!activeUserId) return;
    const snapshots = invalidatedSnapshots(event);
    if (snapshots.has("customers.json") || snapshots.has("warranty.json")) {
      markLiveQueryCacheStale({ userId: activeUserId, namespace: CUSTOMER_NAMESPACE });
    }
    if (snapshots.has("warranty.json")) {
      markLiveQueryCacheStale({ userId: activeUserId, namespace: WARRANTY_NAMESPACE });
    }
  });
}

function normalizeDate(value) {
  const match = String(value || "").match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]) ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function pageNumber(value) {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function pageSize(value) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(50, Math.max(1, number)) : 18;
}

export function normalizeCustomerQuery(query = {}) {
  return {
    page: pageNumber(query.page),
    pageSize: pageSize(query.pageSize),
    search: String(query.search || "").trim(),
    source: CUSTOMER_SOURCES.has(query.source) ? query.source : "all",
    imei: CUSTOMER_IMEI_FILTERS.has(query.imei) ? query.imei : "all",
    from: normalizeDate(query.from),
    to: normalizeDate(query.to),
    sort: CUSTOMER_SORTS.has(query.sort) ? query.sort : "createdDesc"
  };
}

export function normalizeWarrantyQuery(query = {}) {
  return {
    page: pageNumber(query.page),
    pageSize: pageSize(query.pageSize),
    search: String(query.search || "").trim(),
    bucket: WARRANTY_BUCKETS.has(query.bucket) ? query.bucket : "all",
    from: normalizeDate(query.from),
    to: normalizeDate(query.to)
  };
}

function customerOrder(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    no: asText(value.no),
    status: asText(value.status, "unpaid"),
    shippingStatus: asText(value.shippingStatus, "unshipped"),
    source: asText(value.source, "Manual"),
    productName: asText(value.productName, "—"),
    quantity: asNumber(value.quantity, 1),
    price: asNumber(value.price),
    date: asText(value.date)
  };
}

function customerRow(row) {
  const detail = row?.detail && typeof row.detail === "object" ? row.detail : {};
  const orders = asArray(detail.orders).map(customerOrder).filter(Boolean);
  return {
    id: asText(row?.id),
    groupCids: asArray(row?.groupCids).map(String),
    name: asText(row?.name, "—"),
    phone: asText(row?.phone),
    source: asText(row?.source, "other"),
    joinedAt: asText(row?.joinedAt),
    imei: asText(row?.imei),
    imeiCodes: asArray(row?.imeiCodes).map(String),
    allNames: asArray(row?.allNames).map(String),
    allEmails: asArray(row?.allEmails).map(String),
    allPhones: asArray(row?.allPhones).map(String),
    allPhoneMainlands: asArray(row?.allPhoneMainlands).map(String),
    allCarMakes: asArray(row?.allCarMakes).map(String),
    allCarModels: asArray(row?.allCarModels).map(String),
    type: asText(row?.type, "Regular") || "Regular",
    hasEmail: row?.hasEmail === true,
    hasPhone: row?.hasPhone === true,
    hasImei: row?.hasImei === true,
    deviceCount: asNumber(row?.deviceCount),
    orderCount: asNumber(row?.orderCount),
    detail: {
      totalAmount: asNumber(detail.totalAmount),
      firstOrderDate: asText(detail.firstOrderDate),
      email: asText(detail.email),
      carMake: asText(detail.carMake),
      carModelValue: asText(detail.carModelValue),
      carModel: detail.carModel == null ? null : asText(detail.carModel),
      shippingAddress: asText(detail.shippingAddress),
      order: customerOrder(detail.order),
      orders
    }
  };
}

function mapCustomerPayload(payload, query) {
  const totalCount = asNumber(payload?.total_count);
  return {
    __live: true,
    customers: asArray(payload?.rows).map(customerRow),
    dashboardCustomerCount: asNumber(payload?.customer_count),
    totalCount,
    page: query.page,
    pageSize: query.pageSize,
    pages: Math.max(1, Math.ceil(totalCount / query.pageSize)),
    dateRange: { from: asText(payload?.date_from), to: asText(payload?.date_to) },
    sourceCounts: {
      all: asNumber(payload?.source_counts?.all),
      shopify: asNumber(payload?.source_counts?.shopify),
      framer: asNumber(payload?.source_counts?.framer),
      other: asNumber(payload?.source_counts?.other)
    },
    imeiCounts: {
      all: asNumber(payload?.imei_counts?.all),
      has: asNumber(payload?.imei_counts?.has),
      none: asNumber(payload?.imei_counts?.none)
    },
    query: { ...query }
  };
}

function warrantyRow(row) {
  const renewal = row?.latestRenewal;
  return {
    invoiceId: asText(row?.invoiceId),
    productId: row?.productId == null ? null : asText(row.productId),
    no: asText(row?.no),
    product: asText(row?.product, "—"),
    customer: asText(row?.customer, "—"),
    customerId: row?.customerId == null ? null : asText(row.customerId),
    phone: asText(row?.phone),
    phones: asArray(row?.phones).map(String),
    purchaseDate: asText(row?.purchaseDate),
    expiry: asText(row?.expiry),
    warrantyMonths: asNumber(row?.warrantyMonths),
    bucket: asText(row?.bucket),
    daysLeft: asNumber(row?.daysLeft),
    latestRenewal: renewal && typeof renewal === "object" ? {
      months: asNumber(renewal.months),
      paidAt: asText(renewal.paidAt),
      previousEnd: asText(renewal.previousEnd),
      newEnd: asText(renewal.newEnd)
    } : null
  };
}

function mapWarrantyPayload(payload, query) {
  const totalCount = asNumber(payload?.total_count);
  const counts = payload?.bucket_counts ?? {};
  return {
    __live: true,
    items: asArray(payload?.rows).map(warrantyRow),
    totalCount,
    page: query.page,
    pageSize: query.pageSize,
    pages: Math.max(1, Math.ceil(totalCount / query.pageSize)),
    bucketCounts: Object.fromEntries(
      ["all", "expired", "week", "month", "quarter", "year"].map((bucket) => [bucket, asNumber(counts[bucket])])
    ),
    query: { ...query }
  };
}

async function liveContext() {
  const [client, session] = await Promise.all([getSupabaseClient(), getSession()]);
  if (!client || !session?.user?.id) return null;
  if (activeUserId && activeUserId !== session.user.id) queryGeneration += 1;
  activeUserId = session.user.id;
  return { client, userId: session.user.id };
}

function dispatchUpdate(eventName, query, value, source) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(eventName, {
    detail: { queryKey: liveQueryKey(query), query: { ...query }, value, source }
  }));
}

async function fetchPage({ context, namespace, rpc, params, query, mapPayload }) {
  const generation = queryGeneration;
  const requestKey = `${namespace}:${context.userId}:${generation}:${liveQueryKey(query)}`;
  if (NETWORK_REQUESTS.has(requestKey)) return NETWORK_REQUESTS.get(requestKey);
  const promise = context.client.rpc(rpc, params).then((result) => {
    if (result.error) throw result.error;
    if (generation !== queryGeneration) throw new DOMException("Customer query superseded", "AbortError");
    const value = mapPayload(result.data, query);
    writeLiveQueryCache({ userId: context.userId, namespace, query, value });
    return value;
  }).finally(() => NETWORK_REQUESTS.delete(requestKey));
  NETWORK_REQUESTS.set(requestKey, promise);
  return promise;
}

function fetchCustomerPage(context, query) {
  return fetchPage({
    context,
    namespace: CUSTOMER_NAMESPACE,
    rpc: "bizflow_customer_page",
    query,
    params: {
      p_search: query.search || null,
      p_source: query.source === "all" ? null : query.source,
      p_imei: query.imei === "all" ? null : query.imei,
      p_date_from: query.from || null,
      p_date_to: query.to || null,
      p_sort: query.sort,
      p_offset: (query.page - 1) * query.pageSize,
      p_limit: query.pageSize
    },
    mapPayload: mapCustomerPayload
  });
}

function fetchWarrantyPage(context, query) {
  return fetchPage({
    context,
    namespace: WARRANTY_NAMESPACE,
    rpc: "bizflow_warranty_page",
    query,
    params: {
      p_search: query.search || null,
      p_bucket: query.bucket === "all" ? null : query.bucket,
      p_purchase_from: query.from || null,
      p_purchase_to: query.to || null,
      p_offset: (query.page - 1) * query.pageSize,
      p_limit: query.pageSize
    },
    mapPayload: mapWarrantyPayload
  });
}

function backgroundRefresh({ fetcher, context, query, eventName, source }) {
  void fetcher(context, query)
    .then((value) => dispatchUpdate(eventName, query, value, source))
    .catch((error) => {
      if (error?.name !== "AbortError") console.warn("[customer-query] background refresh failed", error);
    });
}

async function readPage({ query, refresh, namespace, fetcher, eventName }) {
  const context = await liveContext();
  if (!context) return LIVE_CUSTOMER_QUERY_MISS;
  const cached = readLiveQueryCache({ userId: context.userId, namespace, query });
  if (cached && !refresh) {
    backgroundRefresh({
      fetcher, context, query, eventName,
      source: cached.stale ? "stale-cache" : "cache-revalidate"
    });
    return { ...cached.value, cached: true, stale: cached.stale };
  }
  try {
    return await fetcher(context, query);
  } catch (error) {
    if (cached) return { ...cached.value, cached: true, stale: true, offline: true };
    throw error;
  }
}

export async function getLiveCustomersPage(query = {}, { refresh = false } = {}) {
  const normalized = normalizeCustomerQuery(query);
  activeCustomerQuery = normalized;
  return readPage({
    query: normalized,
    refresh,
    namespace: CUSTOMER_NAMESPACE,
    fetcher: fetchCustomerPage,
    eventName: CUSTOMER_QUERY_UPDATED_EVENT
  });
}

export async function getLiveWarrantyPage(query = {}, { refresh = false } = {}) {
  const normalized = normalizeWarrantyQuery(query);
  activeWarrantyQuery = normalized;
  return readPage({
    query: normalized,
    refresh,
    namespace: WARRANTY_NAMESPACE,
    fetcher: fetchWarrantyPage,
    eventName: WARRANTY_QUERY_UPDATED_EVENT
  });
}

export async function refreshCurrentCustomerQuery({ soft = true, source = "realtime", notify = true } = {}) {
  if (!activeCustomerQuery || !activeUserId) return null;
  const context = await liveContext();
  if (!context || context.userId !== activeUserId) return null;
  if (soft) markLiveQueryCacheStale({ userId: context.userId, namespace: CUSTOMER_NAMESPACE, query: activeCustomerQuery });
  const value = await fetchCustomerPage(context, activeCustomerQuery);
  if (notify) dispatchUpdate(CUSTOMER_QUERY_UPDATED_EVENT, activeCustomerQuery, value, source);
  return value;
}

export async function refreshCurrentWarrantyQuery({ soft = true, source = "realtime", notify = true } = {}) {
  if (!activeWarrantyQuery || !activeUserId) return null;
  const context = await liveContext();
  if (!context || context.userId !== activeUserId) return null;
  if (soft) markLiveQueryCacheStale({ userId: context.userId, namespace: WARRANTY_NAMESPACE, query: activeWarrantyQuery });
  const value = await fetchWarrantyPage(context, activeWarrantyQuery);
  if (notify) dispatchUpdate(WARRANTY_QUERY_UPDATED_EVENT, activeWarrantyQuery, value, source);
  return value;
}
