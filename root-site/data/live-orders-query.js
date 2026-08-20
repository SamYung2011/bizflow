import { getSession, getSupabaseClient, TRANSIENT_AUTH_RESET_EVENT } from "./auth.js";
import { asArray, asNumber, asText, formatDate, formatDateTime, formatTime } from "./live-snapshot-utils.js";
import {
  invalidateLiveQueryCacheAfterWrite,
  liveQueryKey,
  markLiveQueryCacheStale,
  readLiveQueryCache,
  writeLiveQueryCache
} from "./live-query-cache.js";

export const LIVE_ORDER_QUERY_MISS = Symbol("live-order-query-miss");
export const ORDER_QUERY_UPDATED_EVENT = "tp:order-query-updated";
export const ORDER_PAGE_SIZE = 50;

const ORDER_NAMESPACE = "orders-page";
const ORDER_DETAIL_NAMESPACE = "order-detail";
const ORDER_SOURCES = Object.freeze(["Framer", "Broadway", "Online Store", "Manual"]);
const ORDER_SORTS = new Set(["newest", "oldest", "amount_desc", "amount_asc"]);
const SHIPPING_FILTERS = new Set(["all", "pending", "in_transit", "exception", "delivered"]);
const FEE_PATTERN = /運費|郵費|shipping|freight|押金|deposit|優惠|折扣|discount|手續費|service/i;
const NETWORK_REQUESTS = new Map();
let activeQuery = null;
let activeUserId = "";
let orderQueryGeneration = 0;

if (typeof window !== "undefined") {
  window.addEventListener(TRANSIENT_AUTH_RESET_EVENT, () => {
    orderQueryGeneration += 1;
    activeQuery = null;
    activeUserId = "";
    NETWORK_REQUESTS.clear();
  });
}

const MACHINE_NOTE_SEGMENT = new RegExp("^(?:" + [
  "Framer 表單意向(?:\\s+\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2})?",
  "Shopify order\\s+\\S+",
  "(?:financial|fulfillment)=\\S*",
  "batch=\\S+(?:\\s+idx=\\S+)?(?:\\s+raw_status=\\S+)?"
].join("|") + ")$");

function visibleInvoiceNotes(notes) {
  return asText(notes)
    .replace(/__[A-Z_]+__(?::[\w-]+)?\s*/g, "")
    .replace(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z/g, (_, year, month, day, hour, minute) => {
      const utc = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute));
      const hongKong = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
      const pad = (value) => String(value).padStart(2, "0");
      return `${hongKong.getUTCFullYear()}-${pad(hongKong.getUTCMonth() + 1)}-${pad(hongKong.getUTCDate())} ${pad(hongKong.getUTCHours())}:${pad(hongKong.getUTCMinutes())}`;
    })
    .split(/[|\n]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && !MACHINE_NOTE_SEGMENT.test(segment))
    .join(" | ");
}

function normalizeDate(value) {
  const match = String(value || "").match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

export function normalizeOrderQuery(query = {}) {
  const source = ORDER_SOURCES.includes(query.source) ? query.source : "all";
  const shipping = SHIPPING_FILTERS.has(query.shipping) ? query.shipping : "all";
  const sort = ORDER_SORTS.has(query.sort) ? query.sort : "newest";
  const page = Number.isInteger(query.page) && query.page > 0 ? query.page : 1;
  return {
    page,
    pageSize: ORDER_PAGE_SIZE,
    search: String(query.search || "").trim(),
    source,
    shipping,
    from: normalizeDate(query.from),
    to: normalizeDate(query.to),
    sort
  };
}

function dcInvoiceNumber(invoiceNumber, id) {
  const raw = String(invoiceNumber || id || "");
  const stripped = raw.replace(/^DC/i, "");
  return `DC${/^\d+$/.test(stripped) ? stripped.padStart(5, "0") : stripped}`;
}

function displayInvoiceNumber(invoiceNumber, id) {
  return `#${invoiceNumber ?? asText(id).slice(0, 8)}`;
}

function normalizedItems(value) {
  return asArray(value).map((item, index) => ({
    id: item?.id ?? `line-${index + 1}`,
    name: asText(item?.name),
    quantity: asNumber(item?.qty, 1),
    price: asNumber(item?.price),
    productId: item?.product_id ?? null,
    warehouseId: item?.warehouse_id ?? null,
    warrantyMonths: item?.warranty_months ?? null,
    imeiCode: asText(item?.imei_code)
  }));
}

function productItems(value) {
  return normalizedItems(value).filter((item) => item.name && !FEE_PATTERN.test(item.name));
}

function invoiceFees(value) {
  const items = normalizedItems(value);
  const sum = (pattern) => items.filter((item) => pattern.test(item.name)).reduce((total, item) => total + item.price, 0);
  return {
    shipping: sum(/運費|郵費|shipping|freight/i),
    deposit: sum(/押金|deposit/i),
    discount: sum(/優惠|折扣|discount/i),
    service: sum(/手續費|service/i)
  };
}

function mapListRow(row) {
  const first = row.first_item || {};
  const second = row.second_item || null;
  return {
    id: String(row.id),
    invoiceNumber: String(row.invoice_number ?? row.id ?? ""),
    dcNumber: dcInvoiceNumber(row.invoice_number, row.id),
    customerId: row.customer_id ?? null,
    status: row.status === "Paid" ? "completed" : "in-progress",
    customer: asText(row.customer_name, "—"),
    phone: asText(row.customer_phone),
    channel: asText(row.channel, "Manual"),
    product: asText(first.name, "—"),
    qty: `×${asNumber(first.qty, 1)}`,
    date: formatDate(row.order_date),
    amount: `HKD$ ${asNumber(row.total)}`,
    salesperson: asText(row.salesperson_name),
    note: visibleInvoiceNotes(row.notes),
    secondItem: second?.name ? { name: asText(second.name), quantity: asNumber(second.qty, 1) } : null
  };
}

function mapPagePayload(payload, query) {
  const rows = asArray(payload?.rows).map(mapListRow);
  const totalCount = asNumber(payload?.total_count);
  return {
    __live: true,
    orders: rows,
    totalCount,
    page: query.page,
    pageSize: ORDER_PAGE_SIZE,
    pages: Math.max(1, Math.ceil(totalCount / ORDER_PAGE_SIZE)),
    dateRange: { from: asText(payload?.date_from), to: asText(payload?.date_to) },
    sources: ORDER_SOURCES.slice(),
    shippingCounts: {
      all: asNumber(payload?.shipping_counts?.all),
      pending: asNumber(payload?.shipping_counts?.pending),
      in_transit: asNumber(payload?.shipping_counts?.in_transit),
      exception: asNumber(payload?.shipping_counts?.exception),
      delivered: asNumber(payload?.shipping_counts?.delivered)
    },
    query: { ...query }
  };
}

function dispatchQueryUpdate(query, value, source) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ORDER_QUERY_UPDATED_EVENT, {
    detail: { queryKey: liveQueryKey(query), query: { ...query }, value, source }
  }));
}

async function liveContext() {
  const [client, session] = await Promise.all([getSupabaseClient(), getSession()]);
  if (!client || !session?.user?.id) return null;
  return { client, userId: session.user.id };
}

async function fetchOrderPage(context, query) {
  const generation = orderQueryGeneration;
  const requestKey = `${context.userId}:${generation}:${liveQueryKey(query)}`;
  if (NETWORK_REQUESTS.has(requestKey)) return NETWORK_REQUESTS.get(requestKey);
  const promise = context.client.rpc("bizflow_order_page", {
    p_search: query.search || null,
    p_source: query.source === "all" ? null : query.source,
    p_shipping: query.shipping === "all" ? null : query.shipping,
    p_date_from: query.from || null,
    p_date_to: query.to || null,
    p_sort: query.sort,
    p_offset: (query.page - 1) * ORDER_PAGE_SIZE,
    p_limit: ORDER_PAGE_SIZE
  }).then((result) => {
    if (result.error) throw result.error;
    if (generation !== orderQueryGeneration) throw new DOMException("Order query superseded", "AbortError");
    const value = mapPagePayload(result.data, query);
    writeLiveQueryCache({ userId: context.userId, namespace: ORDER_NAMESPACE, query, value });
    return value;
  }).finally(() => {
    NETWORK_REQUESTS.delete(requestKey);
  });
  NETWORK_REQUESTS.set(requestKey, promise);
  return promise;
}

function backgroundRefresh(context, query, source) {
  void fetchOrderPage(context, query)
    .then((value) => dispatchQueryUpdate(query, value, source))
    .catch((error) => {
      if (error?.name !== "AbortError") console.warn("[order-query] background refresh failed", error);
    });
}

export async function getLiveOrdersPage(query = {}, { refresh = false } = {}) {
  const context = await liveContext();
  if (!context) return LIVE_ORDER_QUERY_MISS;
  if (activeUserId && activeUserId !== context.userId) orderQueryGeneration += 1;
  const normalized = normalizeOrderQuery(query);
  activeQuery = normalized;
  activeUserId = context.userId;
  const cached = readLiveQueryCache({ userId: context.userId, namespace: ORDER_NAMESPACE, query: normalized });
  if (cached && !refresh) {
    backgroundRefresh(context, normalized, cached.stale ? "stale-cache" : "cache-revalidate");
    return { ...cached.value, cached: true, stale: cached.stale };
  }
  try {
    return await fetchOrderPage(context, normalized);
  } catch (error) {
    if (cached) return { ...cached.value, cached: true, stale: true, offline: true };
    throw error;
  }
}

export async function refreshCurrentOrderQuery({ soft = true, source = "realtime" } = {}) {
  if (!activeQuery || !activeUserId) return null;
  const context = await liveContext();
  if (!context || context.userId !== activeUserId) return null;
  if (soft) markLiveQueryCacheStale({ userId: context.userId, namespace: ORDER_NAMESPACE, query: activeQuery });
  const value = await fetchOrderPage(context, activeQuery);
  dispatchQueryUpdate(activeQuery, value, source);
  return value;
}

function patchListRow(order, invoice) {
  if (!invoice || String(order.id) !== String(invoice.id)) return order;
  const products = productItems(invoice.items);
  const first = products[0];
  const second = products[1];
  return {
    ...order,
    status: invoice.status === "Paid" ? "completed" : "in-progress",
    invoiceNumber: String(invoice.invoice_number ?? order.invoiceNumber),
    dcNumber: dcInvoiceNumber(invoice.invoice_number, invoice.id),
    product: first?.name || order.product,
    qty: first ? `×${first.quantity}` : order.qty,
    secondItem: second ? { name: second.name, quantity: second.quantity } : null,
    date: formatDate(invoice.date) || order.date,
    amount: `HKD$ ${asNumber(invoice.total)}`,
    note: invoice.notes === undefined ? order.note : visibleInvoiceNotes(invoice.notes)
  };
}

export async function invalidateOrderQueriesAfterWrite(invoice = null) {
  const context = await liveContext();
  if (!context) return;
  orderQueryGeneration += 1;
  let preserve = null;
  if (activeQuery && activeUserId === context.userId) {
    const cached = readLiveQueryCache({ userId: context.userId, namespace: ORDER_NAMESPACE, query: activeQuery });
    if (cached?.value) {
      const value = invoice
        ? { ...cached.value, orders: cached.value.orders.map((order) => patchListRow(order, invoice)) }
        : cached.value;
      preserve = { query: activeQuery, value };
    }
  }
  invalidateLiveQueryCacheAfterWrite({ userId: context.userId, namespace: ORDER_NAMESPACE, preserve });
  if (invoice?.id) invalidateLiveQueryCacheAfterWrite({ userId: context.userId, namespace: ORDER_DETAIL_NAMESPACE });
  if (preserve) dispatchQueryUpdate(activeQuery, preserve.value, "write");
  if (activeQuery) backgroundRefresh(context, activeQuery, "write-refresh");
}

function mapDetail(invoice, customer, salesperson, events, devices) {
  const items = productItems(invoice.items);
  const first = items[0] || { name: "—", quantity: 1 };
  const order = {
    id: String(invoice.id),
    invoiceNumber: String(invoice.invoice_number ?? invoice.id ?? ""),
    dcNumber: dcInvoiceNumber(invoice.invoice_number, invoice.id),
    customerId: invoice.customer_id ?? null,
    status: invoice.status === "Paid" ? "completed" : "in-progress",
    customer: asText(customer?.name, "—"),
    phone: asText(customer?.phone),
    channel: asText(invoice.channel) || (asText(invoice.notes).includes("__FORMS_BUY__") ? "Framer" : asText(invoice.notes).includes("__BROADWAY__") ? "Broadway" : invoice.invoice_number != null ? "Online Store" : "Manual"),
    product: first.name,
    qty: `×${first.quantity}`,
    date: formatDate(invoice.date),
    amount: `HKD$ ${asNumber(invoice.total)}`
  };
  const carModel = `${asText(customer?.car_make)} ${asText(customer?.car_model)}`.trim() || null;
  const detail = {
    orderNo: displayInvoiceNumber(invoice.invoice_number, invoice.id),
    time: formatTime(invoice.created_at),
    shippingStatus: asText(invoice.shipping_status, "unshipped") || "unshipped",
    shippedAt: formatDateTime(invoice.shipped_at),
    carrier: asText(invoice.carrier),
    trackingNo: asText(invoice.tracking_number),
    salesperson: asText(salesperson?.name),
    note: visibleInvoiceNotes(invoice.notes),
    salespersonId: invoice.salesperson_id ?? null,
    customerId: invoice.customer_id ?? null,
    paymentTotal: asNumber(invoice.total),
    email: asText(customer?.email),
    carModel,
    carMake: asText(customer?.car_make),
    carModelValue: asText(customer?.car_model),
    shippingAddress: asText(customer?.address),
    items,
    fees: invoiceFees(invoice.items),
    timeline: asArray(events).map((event) => ({
      label: asText(event.description).split("：")[0],
      time: formatDateTime(event.event_at)
    })),
    devices: asArray(devices).map((device) => ({
      id: String(device.id),
      imei: asText(device.imei),
      type: asText(device.device_type),
      createdAt: formatDateTime(device.created_at)
    }))
  };
  return { order: { ...order, detail }, detail };
}

export async function getLiveOrderDetail(id, { refresh = false } = {}) {
  const context = await liveContext();
  if (!context) return LIVE_ORDER_QUERY_MISS;
  const query = { id: String(id || "") };
  const generation = orderQueryGeneration;
  const cached = readLiveQueryCache({ userId: context.userId, namespace: ORDER_DETAIL_NAMESPACE, query });
  if (cached && !refresh) return cached.value;
  const invoiceResult = await context.client.from("invoices")
    .select("id,invoice_number,customer_id,salesperson_id,date,created_at,items,total,status,notes,carrier,tracking_number,shipping_status,shipped_at,delivered_at")
    .eq("id", query.id)
    .maybeSingle();
  if (invoiceResult.error) {
    if (cached) return cached.value;
    throw invoiceResult.error;
  }
  if (!invoiceResult.data) return null;
  const invoice = invoiceResult.data;
  const [customerResult, salespersonResult, eventsResult, devicesResult] = await Promise.all([
    invoice.customer_id
      ? context.client.from("customers").select("id,name,phone,email,address,car_make,car_model").eq("id", invoice.customer_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    invoice.salesperson_id
      ? context.client.from("employees").select("id,name").eq("id", invoice.salesperson_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    context.client.from("shipment_events").select("event_at,description").eq("invoice_id", invoice.id).order("event_at", { ascending: false }).limit(6),
    invoice.customer_id
      ? context.client.from("customer_devices").select("id,imei,device_type,created_at").eq("customer_id", invoice.customer_id).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null })
  ]);
  const error = customerResult.error || salespersonResult.error || eventsResult.error || devicesResult.error;
  if (error) {
    if (cached) return cached.value;
    throw error;
  }
  const value = mapDetail(invoice, customerResult.data, salespersonResult.data, eventsResult.data, devicesResult.data);
  if (generation !== orderQueryGeneration) throw new DOMException("Order detail superseded", "AbortError");
  writeLiveQueryCache({ userId: context.userId, namespace: ORDER_DETAIL_NAMESPACE, query, value });
  return value;
}
