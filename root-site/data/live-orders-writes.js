import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";
import { allRows, invalidateLiveTables } from "./live-snapshot-utils.js";

const COMMISSION_CUTOFF = "2026-05-09";
const COMMISSION_RULES = { "轉插": 600 };
const EXTRA_ITEM_NAMES = new Set(["運費", "押金", "優惠", "手續費"]);

async function writeContext({ requireShip = false } = {}) {
  const [client, session, currentUser] = await Promise.all([
    getSupabaseClient(),
    getSession(),
    getCurrentUser()
  ]);
  if (!client || !session?.user || currentUser?.bizflowMainAccess !== true) {
    throw new Error("Authenticated order write context required");
  }
  if (requireShip && currentUser.canShip !== true) {
    throw new Error("Order shipping permission required");
  }
  return { client, currentUser };
}

function throwIfError(error) {
  if (error) throw error;
}

function textOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function positiveNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function moneyNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function invoiceLineId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function hongKongDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function normalizedItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const name = String(item?.name ?? "").trim();
    const qty = positiveNumber(item?.quantity ?? item?.qty);
    const price = moneyNumber(item?.price);
    if (!name || qty <= 0) throw new Error("Order item requires a name and positive quantity");
    return {
      id: item?.id || invoiceLineId(),
      name,
      qty,
      price,
      ...(item?.productId ? { product_id: String(item.productId) } : {}),
      ...(item?.warehouseId ? { warehouse_id: String(item.warehouseId) } : {}),
      ...(item?.warrantyMonths != null ? { warranty_months: Number(item.warrantyMonths) } : {}),
      ...(textOrNull(item?.imeiCode) ? { imei_code: textOrNull(item.imeiCode) } : {})
    };
  });
}

function finalInvoiceItems(items, fees = {}) {
  const rows = normalizedItems(items);
  const extras = [
    ["運費", moneyNumber(fees.shipping)],
    ["押金", moneyNumber(fees.deposit)],
    ["手續費", moneyNumber(fees.service)],
    ["優惠", -Math.abs(moneyNumber(fees.discount))]
  ];
  for (const [name, price] of extras) {
    if (price !== 0) rows.push({ id: invoiceLineId(), name, qty: 1, price });
  }
  return rows;
}

function invoiceTotal(items) {
  return items.reduce((sum, item) => sum + moneyNumber(item.price) * positiveNumber(item.qty), 0);
}

function validImei(value) {
  return /^\d{15}$/.test(String(value || "").replace(/[\s-]+/g, ""));
}

function itemImeis(items) {
  return [...new Set((items ?? [])
    .map((item) => String(item?.imei_code || "").replace(/[\s-]+/g, ""))
    .filter(validImei))];
}

async function invalidateOrderReads(...tables) {
  await invalidateLiveTables(...tables);
}

async function insertInvoiceWithRetry(client, buildPayload, maxAttempts = 8) {
  const maxResult = await client.from("invoices")
    .select("invoice_number")
    .not("invoice_number", "is", null)
    .lt("invoice_number", 100000)
    .order("invoice_number", { ascending: false })
    .limit(1);
  throwIfError(maxResult.error);
  const base = (Number(maxResult.data?.[0]?.invoice_number) || 0) + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const invoiceNumber = base + attempt;
    if (invoiceNumber >= 100000) throw new Error("Five-digit invoice number space exhausted");
    const result = await client.from("invoices").insert(buildPayload(invoiceNumber)).select("*").single();
    if (!result.error) return result.data;
    if (result.error.code !== "23505") throw result.error;
  }
  throw new Error("Invoice number conflict after retries");
}

function commissionAmount(invoice, products, aliases) {
  // Keep alias precedence and cutoff aligned with src/lib/commission.js:10-44.
  if (!invoice.salesperson_id || !invoice.date || invoice.date < COMMISSION_CUTOFF) return 0;
  if (String(invoice.notes || "").includes("__BROADWAY__")) return 0;
  const productById = new Map(products.map((product) => [String(product.id), product]));
  const productByName = new Map(products.map((product) => [String(product.name || "").trim().toLowerCase(), product]));
  const aliasByName = new Map(aliases.map((alias) => [String(alias.alias_name || "").trim().toLowerCase(), alias]));
  return (Array.isArray(invoice.items) ? invoice.items : []).reduce((total, item) => {
    if (EXTRA_ITEM_NAMES.has(String(item?.name || "").trim())) return total;
    const qty = positiveNumber(item?.qty);
    const alias = aliasByName.get(String(item?.name || "").trim().toLowerCase());
    const resolved = alias
      ? (alias.skip === true ? [] : (Array.isArray(alias.products) ? alias.products : []))
      : [{ product_id: item?.product_id || productByName.get(String(item?.name || "").trim().toLowerCase())?.id, qty: 1 }];
    return total + resolved.reduce((sum, mapping) => {
      const product = productById.get(String(mapping?.product_id || ""));
      const rate = COMMISSION_RULES[product?.category];
      return sum + (rate ? rate * positiveNumber(mapping?.qty, 1) * qty : 0);
    }, 0);
  }, 0);
}

async function appendCustomerDevices(client, customerId, imeis) {
  if (!customerId || !imeis.length) return { inserted: [], conflicts: [] };
  const lookup = await client.from("customer_devices").select("imei,customer_id").in("imei", imeis);
  throwIfError(lookup.error);
  const existing = new Map((lookup.data ?? []).map((row) => [String(row.imei), row]));
  const conflicts = [];
  const additions = [];
  for (const imei of imeis) {
    const owner = existing.get(imei);
    if (!owner) additions.push(imei);
    else if (String(owner.customer_id) !== String(customerId)) conflicts.push(imei);
  }
  if (!additions.length) return { inserted: [], conflicts };
  const result = await client.from("customer_devices").insert(
    additions.map((imei) => ({ customer_id: customerId, imei, device_type: "adapter_pro" }))
  ).select("*");
  throwIfError(result.error);
  return { inserted: result.data ?? [], conflicts };
}

function customerPayload(values) {
  const name = textOrNull(values?.name);
  if (!name) throw new Error("Customer name is required");
  return {
    name,
    phone: textOrNull(values?.phone),
    email: textOrNull(values?.email),
    car_model: textOrNull(values?.carModel),
    address: textOrNull(values?.address)
  };
}

export async function getLiveOrderWriteOptions(invoiceId = "") {
  const { client } = await writeContext();
  const [employees, warehouses] = await Promise.all([
    allRows("employees", "created_at"),
    allRows("warehouses", "sort_order")
  ]);
  let invoice = null;
  if (invoiceId) {
    const result = await client.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
    throwIfError(result.error);
    invoice = result.data ?? null;
  }
  return {
    invoice,
    defaultWarehouseId: warehouses[0]?.id ?? null,
    salespeople: employees
      .filter((employee) => employee.role === "銷售" && employee.active !== false)
      .map((employee) => ({ id: employee.id, name: employee.name || employee.email || "—" }))
  };
}

export async function createLiveOrderCustomer(values) {
  const { client } = await writeContext();
  const imei = String(values?.imei || "").replace(/[\s-]+/g, "");
  if (imei && !validImei(imei)) throw new Error("Customer IMEI must contain 15 digits");
  const result = await client.from("customers").insert(customerPayload(values)).select("*").single();
  throwIfError(result.error);
  let deviceResult = { inserted: [], conflicts: [] };
  let deviceError = null;
  if (imei) {
    try {
      deviceResult = await appendCustomerDevices(client, result.data.id, [imei]);
    } catch (error) {
      deviceError = error;
    }
  }
  await invalidateOrderReads("customers", "customer_devices");
  return { customer: result.data, deviceConflicts: deviceResult.conflicts, deviceError };
}

export async function updateLiveOrderCustomer(customerId, values) {
  const { client } = await writeContext();
  const imei = String(values?.imei || "").replace(/[\s-]+/g, "");
  if (imei && !validImei(imei)) throw new Error("Customer IMEI must contain 15 digits");
  const result = await client.from("customers")
    .update(customerPayload(values))
    .eq("id", customerId)
    .select("*")
    .single();
  throwIfError(result.error);
  let deviceResult = { inserted: [], conflicts: [] };
  let deviceError = null;
  if (imei) {
    try {
      deviceResult = await appendCustomerDevices(client, customerId, [imei]);
    } catch (error) {
      deviceError = error;
    }
  }
  await invalidateOrderReads("customers", "customer_devices");
  return { customer: result.data, deviceConflicts: deviceResult.conflicts, deviceError };
}

function shippingPayload(shipping, canShip) {
  if (!canShip || !shipping) return {};
  if (shipping.mode === "pickup") {
    const now = new Date().toISOString();
    return {
      carrier: "self_pickup",
      tracking_number: null,
      shipping_status: "已簽收",
      shipped_at: now,
      delivered_at: now
    };
  }
  const trackingNumber = textOrNull(shipping.trackingNumber);
  if (!trackingNumber) return {};
  if (!/^[A-Za-z0-9]{6,}$/.test(trackingNumber)) throw new Error("Invalid tracking number");
  return {
    carrier: "SF HK",
    tracking_number: trackingNumber,
    shipping_status: "已發貨",
    shipped_at: new Date().toISOString(),
    delivered_at: null
  };
}

async function restoreAfterPaidFailure(client, recovery) {
  const failures = [];
  const attempt = async (operation) => {
    try {
      const result = await operation();
      if (result?.error) throw result.error;
    } catch (error) {
      failures.push(error);
    }
  };
  if (recovery.invoiceId) {
    await attempt(() => client.from("stock_deduction_audit").delete().eq("invoice_id", recovery.invoiceId));
    await attempt(() => client.from("inventory_movements").delete().eq("invoice_id", recovery.invoiceId));
  }
  for (const stock of [...recovery.stocks].reverse()) {
    if (stock.existed) {
      await attempt(async () => {
        const result = await client.from("inventory_stock")
          .update({ qty: stock.qty, updated_at: stock.updatedAt })
          .eq("id", stock.id)
          .eq("qty", stock.afterQty)
          .select("id")
          .maybeSingle();
        throwIfError(result.error);
        if (!result.data) throw new Error("Inventory changed before recovery completed");
        return result;
      });
    } else {
      await attempt(async () => {
        const result = await client.from("inventory_stock")
          .delete()
          .eq("product_id", stock.productId)
          .eq("warehouse_id", stock.warehouseId)
          .eq("qty", stock.afterQty)
          .select("id")
          .maybeSingle();
        throwIfError(result.error);
        if (!result.data) throw new Error("Inventory changed before recovery completed");
        return result;
      });
    }
  }
  for (const item of [...recovery.inventory].reverse()) {
    await attempt(() => client.from("inventory").update(item.before).eq("id", item.id));
  }
  if (recovery.invoiceId) await attempt(() => client.from("invoices").delete().eq("id", recovery.invoiceId));
  return failures;
}

export async function createAndPayLiveOrder({ customerId, salespersonId, items, fees, shipping }) {
  const { client, currentUser } = await writeContext();
  if (!customerId) throw new Error("Order customer is required");
  const invoiceItems = finalInvoiceItems(items, fees);
  const productItems = invoiceItems.filter((item) => !EXTRA_ITEM_NAMES.has(item.name));
  if (!productItems.length) throw new Error("Order requires at least one product");
  const total = invoiceTotal(invoiceItems);
  if (total <= 0) throw new Error("Order total must be greater than zero");

  if (productItems.some((item) => !item.product_id)) {
    throw new Error("Order product selection is incomplete");
  }
  const productIds = [...new Set(productItems.map((item) => String(item.product_id)))];
  const [productsResult, warehousesResult] = await Promise.all([
    client.from("products").select("*").in("id", productIds),
    client.from("warehouses").select("*").order("sort_order", { ascending: true })
  ]);
  throwIfError(productsResult.error);
  throwIfError(warehousesResult.error);
  const products = productsResult.data ?? [];
  const productById = new Map(products.map((product) => [String(product.id), product]));
  if (productById.size !== productIds.length) throw new Error("One or more selected products no longer exist");
  const defaultWarehouseId = warehousesResult.data?.[0]?.id ?? null;
  if (!defaultWarehouseId) throw new Error("Order inventory warehouse is unavailable");

  const deductionsByKey = new Map();
  for (const item of productItems) {
    const product = productById.get(String(item.product_id));
    if (product?.is_virtual === true || product?.category === "_archived") continue;
    const warehouseId = item.warehouse_id || defaultWarehouseId;
    item.warehouse_id = warehouseId;
    if (item.warranty_months == null && product?.warranty_months != null) {
      item.warranty_months = Number(product.warranty_months);
    }
    const key = `${product.id}|${warehouseId}`;
    const row = deductionsByKey.get(key) ?? { product, warehouseId, qty: 0, itemRows: [] };
    row.qty += positiveNumber(item.qty);
    row.itemRows.push({ name: item.name, qty: positiveNumber(item.qty) });
    deductionsByKey.set(key, row);
  }

  const recovery = { invoiceId: "", stocks: [], inventory: [] };
  let invoice = null;
  try {
    invoice = await insertInvoiceWithRetry(client, (invoiceNumber) => ({
      invoice_number: invoiceNumber,
      customer_id: customerId,
      salesperson_id: salespersonId || null,
      date: hongKongDate(),
      items: invoiceItems,
      total,
      status: "Unpaid",
      notes: null,
      legacy_skip_deduct: false,
      ...shippingPayload(shipping, currentUser.canShip === true)
    }));
    recovery.invoiceId = invoice.id;

    const deductions = [...deductionsByKey.values()];
    for (const deduction of deductions) {
      const stockResult = await client.from("inventory_stock")
        .select("*")
        .eq("product_id", deduction.product.id)
        .eq("warehouse_id", deduction.warehouseId)
        .maybeSingle();
      throwIfError(stockResult.error);
      const stock = stockResult.data;
      const currentQty = Number(stock?.qty) || 0;
      if (stock) {
        const update = await client.from("inventory_stock")
          .update({ qty: currentQty - deduction.qty, updated_at: new Date().toISOString() })
          .eq("id", stock.id)
          .eq("qty", currentQty)
          .select("id")
          .maybeSingle();
        throwIfError(update.error);
        if (!update.data) throw new Error("Inventory changed while the order was being paid");
        recovery.stocks.push({
          existed: true,
          id: stock.id,
          qty: currentQty,
          afterQty: currentQty - deduction.qty,
          updatedAt: stock.updated_at,
          productId: deduction.product.id,
          warehouseId: deduction.warehouseId
        });
      } else {
        const insert = await client.from("inventory_stock").insert({
          product_id: deduction.product.id,
          warehouse_id: deduction.warehouseId,
          qty: -deduction.qty,
          updated_at: new Date().toISOString()
        });
        throwIfError(insert.error);
        recovery.stocks.push({
          existed: false,
          productId: deduction.product.id,
          warehouseId: deduction.warehouseId,
          afterQty: -deduction.qty
        });
      }
    }

    if (deductions.length) {
      const movementResult = await client.from("inventory_movements").insert(deductions.map((deduction) => ({
        product_id: deduction.product.id,
        warehouse_id: deduction.warehouseId,
        delta: -deduction.qty,
        type: "sale",
        reason: `發票 #${invoice.invoice_number || invoice.id} 標記已付款`,
        invoice_id: invoice.id
      })));
      throwIfError(movementResult.error);

      const auditResult = await client.from("stock_deduction_audit").insert(deductions.flatMap((deduction) =>
        deduction.itemRows.map((item) => ({
          invoice_id: invoice.id,
          item_name: item.name,
          mapped_product_id: deduction.product.id,
          mapped_qty: item.qty,
          warehouse_id: deduction.warehouseId,
          decision: "confirm",
          audited_by: currentUser.employeeId || null
        }))
      ));
      throwIfError(auditResult.error);
    }

    const warrantyProducts = deductions.filter((deduction) => Number(deduction.product.warranty_months) > 0);
    if (warrantyProducts.length) {
      const legacyResult = await client.from("inventory")
        .select("*")
        .in("product_id", warrantyProducts.map((deduction) => deduction.product.id))
        .eq("status", "In Stock");
      throwIfError(legacyResult.error);
      const availableByProduct = new Map();
      for (const row of legacyResult.data ?? []) {
        const list = availableByProduct.get(row.product_id) ?? [];
        list.push(row);
        availableByProduct.set(row.product_id, list);
      }
      const invoiceDate = new Date();
      for (const deduction of warrantyProducts) {
        const warrantyEnd = new Date(invoiceDate);
        warrantyEnd.setMonth(warrantyEnd.getMonth() + Number(deduction.product.warranty_months));
        const rows = (availableByProduct.get(deduction.product.id) ?? []).slice(0, deduction.qty);
        for (const row of rows) {
          recovery.inventory.push({
            id: row.id,
            before: {
              status: row.status,
              customer_id: row.customer_id,
              sold_date: row.sold_date,
              warranty_end: row.warranty_end,
              invoice_id: row.invoice_id
            }
          });
          const legacyUpdate = await client.from("inventory").update({
            status: "Sold",
            customer_id: customerId,
            sold_date: hongKongDate(),
            warranty_end: warrantyEnd.toISOString().slice(0, 10),
            invoice_id: invoice.id
          }).eq("id", row.id);
          throwIfError(legacyUpdate.error);
        }
      }
    }

    const aliases = await allRows("line_item_aliases", "created_at");
    const commission = commissionAmount({ ...invoice, items: invoiceItems }, products, aliases);
    const paidResult = await client.from("invoices")
      .update({ status: "Paid", commission_amount: commission })
      .eq("id", invoice.id)
      .select("*")
      .single();
    throwIfError(paidResult.error);

    const imeiResult = await appendCustomerDevices(client, customerId, itemImeis(invoiceItems));
    await invalidateOrderReads(
      "invoices",
      "inventory_stock",
      "inventory_movements",
      "stock_deduction_audit",
      "inventory",
      "customer_devices"
    );
    return { invoice: paidResult.data, deviceConflicts: imeiResult.conflicts };
  } catch (error) {
    const recoveryFailures = await restoreAfterPaidFailure(client, recovery);
    await invalidateOrderReads(
      "invoices",
      "inventory_stock",
      "inventory_movements",
      "stock_deduction_audit",
      "inventory"
    );
    if (recoveryFailures.length) {
      console.error("[orders] paid-order recovery failed", recoveryFailures);
      const recoveryError = new Error("Order payment failed and automatic recovery was incomplete");
      recoveryError.cause = error;
      throw recoveryError;
    }
    throw error;
  }
}

export async function updateLiveOrder(invoiceId, { items, fees, salespersonId, totalOverride }) {
  const { client } = await writeContext();
  const invoiceResult = await client.from("invoices").select("*").eq("id", invoiceId).single();
  throwIfError(invoiceResult.error);
  const invoice = invoiceResult.data;
  const invoiceItems = finalInvoiceItems(items, fees);
  if (!invoiceItems.some((item) => !EXTRA_ITEM_NAMES.has(item.name))) {
    throw new Error("Order requires at least one product");
  }
  const updates = {
    items: invoiceItems,
    total: Number.isFinite(Number(totalOverride)) ? Number(totalOverride) : invoiceTotal(invoiceItems),
    salesperson_id: salespersonId || null
  };
  if (updates.total <= 0) throw new Error("Order total must be greater than zero");
  if (String(invoice.status || "").trim().toLowerCase() === "paid") {
    const [products, aliases] = await Promise.all([
      allRows("products", "name"),
      allRows("line_item_aliases", "created_at")
    ]);
    updates.commission_amount = commissionAmount({ ...invoice, ...updates }, products, aliases);
  }
  const result = await client.from("invoices").update(updates).eq("id", invoiceId).select("*").single();
  throwIfError(result.error);
  let imeiResult = { conflicts: [] };
  let deviceError = null;
  try {
    imeiResult = await appendCustomerDevices(client, invoice.customer_id, itemImeis(invoiceItems));
  } catch (error) {
    deviceError = error;
  }
  await invalidateOrderReads("invoices", "customer_devices");
  return { invoice: result.data, deviceConflicts: imeiResult.conflicts, deviceError };
}

export async function updateLiveOrderShipping(invoiceId, { mode, trackingNumber }) {
  const { client } = await writeContext({ requireShip: true });
  const updates = shippingPayload({ mode, trackingNumber }, true);
  if (!Object.keys(updates).length) throw new Error("Tracking number is required");
  const result = await client.from("invoices").update(updates).eq("id", invoiceId).select("*").single();
  throwIfError(result.error);
  await invalidateOrderReads("invoices");
  return result.data;
}
