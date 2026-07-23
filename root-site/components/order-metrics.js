const TRANSIT_STATUSES = new Set(["已發貨", "在途", "派送中"]);
const SIGNED_MARKS = ["簽收", "签收"];
const DAY_MS = 24 * 60 * 60 * 1000;
// Mirrors bizflow_samyung/src/lib/shippingHelpers.js:3-14.
const SHIPPING_TRACKING_SINCE = "2026-05-05";

function parseDate(value) {
  const match = String(value || "").match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

function hongKongDateParts(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return [Number(values.year), Number(values.month), Number(values.day)];
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function rangeBounds(key, now) {
  const [year, month, day] = hongKongDateParts(now);
  const today = new Date(Date.UTC(year, month - 1, day));
  if (key === "all") return { start: new Date(Date.UTC(2000, 0, 1)), end: addDays(today, 1) };
  if (key === "thisMonth") return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
  if (key === "lastMonth") return { start: new Date(Date.UTC(year, month - 2, 1)), end: new Date(Date.UTC(year, month - 1, 1)) };
  if (key === "year") return { start: new Date(Date.UTC(year, 0, 1)), end: addDays(today, 1) };
  const start = new Date(today);
  start.setUTCMonth(start.getUTCMonth() - (key === "3m" ? 3 : 12));
  return { start, end: addDays(today, 1) };
}

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function stripDefaultTitle(value) {
  return String(value || "").replace(/\s*-\s*Default Title\s*$/i, "").trim();
}

function aggregateProducts(orders, support) {
  const aliasByName = new Map(support.aliases.map((alias) => [normalizeName(alias.aliasName), alias]));
  const productById = new Map(support.products.map((product) => [product.id, product.name]));
  const productByName = new Map(support.products.map((product) => [normalizeName(product.name), product.name]));
  const sales = new Map();

  function add(name, amount) {
    if (!name || !Number.isFinite(amount)) return;
    sales.set(name, (sales.get(name) || 0) + amount);
  }

  orders.forEach((order) => {
    (order.detail?.items || []).forEach((item) => {
      const quantity = Number(item.quantity) || 0;
      const amount = (Number(item.price) || 0) * quantity;
      if (!item.name || quantity <= 0) return;
      const alias = aliasByName.get(normalizeName(item.name));
      if (alias?.skip) return;
      if (alias?.products.length) {
        const multiplierTotal = alias.products.reduce((sum, product) => sum + (Number(product.qty) || 1), 0) || 1;
        alias.products.forEach((product, index) => {
          const multiplier = Number(product.qty) || 1;
          const name = productById.get(product.product_id) || alias.productNames[index] || stripDefaultTitle(item.name);
          add(name, amount * multiplier / multiplierTotal);
        });
        return;
      }
      const stripped = stripDefaultTitle(item.name);
      add(productByName.get(normalizeName(stripped)) || stripped, amount);
    });
  });
  return [...sales.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}

function aggregateCustomers(orders, support) {
  const customerByPhone = new Map();
  const customerByEmail = new Map();
  const customerByName = new Map();
  support.customers.forEach((customer) => {
    const phone = normalizeName(customer.phone);
    const email = normalizeName(customer.email);
    const name = normalizeName(customer.name);
    if (phone && !customerByPhone.has(phone)) customerByPhone.set(phone, customer);
    if (email && !customerByEmail.has(email)) customerByEmail.set(email, customer);
    if (name && !customerByName.has(name)) customerByName.set(name, customer);
  });
  const totals = new Map();
  orders.forEach((order) => {
    const phone = normalizeName(order.phone);
    const email = normalizeName(order.detail?.email);
    const name = normalizeName(order.customer);
    const customer = customerByPhone.get(phone) || customerByEmail.get(email) || customerByName.get(name);
    const key = customer?.id || `order:${phone || email || name || "unnamed"}`;
    const current = totals.get(key) || {
      id: customer?.id || key,
      name: customer?.name || order.customer || "—",
      totalAmount: 0
    };
    current.totalAmount += Number(order.detail?.paymentTotal) || 0;
    totals.set(key, current);
  });
  return [...totals.values()].sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 10);
}

export function aggregateRevenue(orders, support, range, now = new Date()) {
  const { start, end } = rangeBounds(range, now);
  const inRange = orders.filter((order) => {
    const date = parseDate(order.date);
    return date && date >= start && date < end;
  });
  const paid = inRange.filter((order) => order.status === "completed");
  const unpaid = inRange.filter((order) => order.status !== "completed");
  const totalRevenue = paid.reduce((sum, order) => sum + (Number(order.detail?.paymentTotal) || 0), 0);
  const unpaidAmount = unpaid.reduce((sum, order) => sum + (Number(order.detail?.paymentTotal) || 0), 0);
  const monthMap = new Map();
  paid.forEach((order) => {
    const month = String(order.date || "").slice(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + (Number(order.detail?.paymentTotal) || 0));
  });
  const products = aggregateProducts(paid, support);
  // Mirrors bizflow_samyung/src/views/Revenue.jsx:98-123: customer totals follow the selected range.
  const customers = aggregateCustomers(inRange, support);
  return {
    totalRevenue,
    paidCount: paid.length,
    average: paid.length ? Math.round(totalRevenue / paid.length) : 0,
    unpaidCount: unpaid.length,
    unpaidAmount,
    months: [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value })),
    products,
    customers,
    singleMonth: range === "thisMonth" || range === "lastMonth"
  };
}

export function isSignedStatus(value) {
  return SIGNED_MARKS.some((mark) => String(value || "").includes(mark));
}

export function isOverdueUnsigned(order, now = new Date()) {
  const shippingStatus = order.detail?.shippingStatus;
  // Mirrors bizflow_samyung/src/lib/shippingHelpers.js:16-27: manual exception OR shipped >14 days.
  if (shippingStatus === "異常") return true;
  if (!TRANSIT_STATUSES.has(shippingStatus)) return false;
  const shippedDate = parseDate(order.detail?.shippedAt);
  if (!shippedDate) return false;
  const [year, month, day] = hongKongDateParts(now);
  const cutoff = Date.UTC(year, month - 1, day) - 14 * DAY_MS;
  return shippedDate.getTime() < cutoff;
}

export function matchesShippingFilter(order, filter, now = new Date()) {
  if (filter === "all") return true;
  const shippingStatus = order.detail?.shippingStatus;
  if (filter === "pending") {
    const invoiceDate = String(order.date || "").replaceAll("/", "-");
    return shippingStatus === "unshipped" && invoiceDate >= SHIPPING_TRACKING_SINCE;
  }
  if (filter === "in_transit") return TRANSIT_STATUSES.has(shippingStatus);
  if (filter === "exception") return isOverdueUnsigned(order, now);
  if (filter === "delivered") return isSignedStatus(shippingStatus);
  return true;
}

export function aggregateShippingCounts(orders, now = new Date()) {
  const counts = { all: orders.length, pending: 0, in_transit: 0, exception: 0, delivered: 0 };
  for (const order of orders) {
    for (const filter of ["pending", "in_transit", "exception", "delivered"]) {
      if (matchesShippingFilter(order, filter, now)) counts[filter] += 1;
    }
  }
  return counts;
}

export function deriveShippingListView(orders, filter = "all", now = new Date()) {
  const source = Array.isArray(orders) ? orders : [];
  return {
    counts: aggregateShippingCounts(source, now),
    orders: source.filter((order) => matchesShippingFilter(order, filter, now))
  };
}

export function aggregateInventoryStock(products) {
  const carriers = products.filter((product) => product.parentId !== null || (product.detail?.variants?.length ?? 0) === 0);
  const positive = carriers.filter((product) => Number(product.stock) > 0);
  const lowStockCarriers = carriers.filter((product) => (product.status || "active") !== "discontinued");
  return {
    carrierCount: carriers.length,
    activeSkuCount: positive.length,
    totalQuantity: carriers.reduce((sum, product) => sum + (Number(product.stock) || 0), 0),
    // Mirrors bizflow_samyung/src/context/AppContext.jsx:412-426: exclude discontinued, include zero stock.
    lowStockCount: lowStockCarriers.filter((product) => Number(product.stock) < 50).length
  };
}
