import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";
import { invalidateLiveTables } from "./live-snapshot-utils.js";

let healthPromise = null;

export const SHOPIFY_PRODUCT_IMAGE_BUCKET = "shopify-product-images";
export const SHOPIFY_PRODUCT_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const SHOPIFY_PRODUCT_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

const shopifyImageMimeTypes = new Set(SHOPIFY_PRODUCT_IMAGE_ACCEPT.split(","));
const shopifyImagePublicMarker = `/storage/v1/object/public/${SHOPIFY_PRODUCT_IMAGE_BUCKET}/`;

export class ShopifyCatalogWriteError extends Error {
  constructor(message, { code = "SHOPIFY_CATALOG_WRITE_FAILED", detail = null } = {}) {
    super(message);
    this.name = "ShopifyCatalogWriteError";
    this.code = code;
    this.detail = detail;
  }
}

async function adminContext() {
  const [client, session, currentUser] = await Promise.all([
    getSupabaseClient(), getSession(), getCurrentUser()
  ]);
  if (!client || !session?.user || currentUser?.isBfAdmin !== true || currentUser?.bizflowMainAccess !== true) {
    throw new ShopifyCatalogWriteError("BizFlow administrator required", { code: "SHOPIFY_ADMIN_REQUIRED" });
  }
  return { client, currentUser };
}

async function responsePayload(response) {
  if (!response) return null;
  try {
    const readable = typeof response.clone === "function" ? response.clone() : response;
    if (typeof readable.json === "function") return await readable.json();
  } catch {
    // Some relays expose a body without a usable JSON content type. Fall back to text.
  }
  try {
    const readable = typeof response.clone === "function" ? response.clone() : response;
    if (typeof readable.text === "function") {
      const raw = await readable.text();
      return raw ? JSON.parse(raw) : null;
    }
  } catch {
    // Preserve the original safe client error when the relay body is unavailable.
  }
  return null;
}

async function functionErrorPayload(error, response) {
  for (const candidate of [response, error?.context, error?.context?.response]) {
    const detail = await responsePayload(candidate);
    if (detail && typeof detail === "object") return detail;
  }
  if (error?.context && typeof error.context === "object" && error.context.code) return error.context;
  return null;
}

async function invokeCatalog(action, payload = {}) {
  const { client } = await adminContext();
  const result = await client.functions.invoke("shopify-catalog-write", { body: { action, ...payload } });
  if (result.error) {
    const detail = await functionErrorPayload(result.error, result.response);
    throw new ShopifyCatalogWriteError(detail?.error || result.error.message || "Shopify request failed", {
      code: detail?.code || "SHOPIFY_EDGE_REQUEST_FAILED",
      detail
    });
  }
  if (!result.data?.ok) {
    throw new ShopifyCatalogWriteError(result.data?.error || "Shopify request failed", {
      code: result.data?.code || "SHOPIFY_CATALOG_WRITE_FAILED",
      detail: result.data
    });
  }
  return result.data;
}

export async function getShopifyCredentialHealth({ refresh = false } = {}) {
  if (refresh) healthPromise = null;
  if (!healthPromise) {
    healthPromise = invokeCatalog("health")
      .then((data) => data.health)
      .catch((error) => ({
        configured: false,
        connected: false,
        readReady: false,
        writeReady: false,
        missingReadScopes: [],
        missingWriteScopes: ["write_products", "write_inventory"],
        code: error.code,
        error: error.message
      }))
      .finally(() => {
        // A short-lived promise only deduplicates concurrent page mounts. A later
        // navigation rechecks scopes so a newly-rotated token becomes live quickly.
        queueMicrotask(() => { healthPromise = null; });
      });
  }
  return healthPromise;
}

export async function getShopifyAlignmentPlan() {
  return invokeCatalog("alignment-plan");
}

function requestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "00000000-0000-4000-8000-" + `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-12).padStart(12, "0");
}

function imageWriteError(message, code) {
  return new ShopifyCatalogWriteError(message, { code });
}

async function browserImageDimensions(file) {
  if (typeof globalThis.createImageBitmap === "function") {
    let bitmap;
    try {
      bitmap = await globalThis.createImageBitmap(file);
      return { width: bitmap.width, height: bitmap.height };
    } catch {
      throw imageWriteError("Product image could not be decoded", "SHOPIFY_IMAGE_CONTENT_INVALID");
    } finally {
      bitmap?.close?.();
    }
  }
  if (typeof globalThis.Image === "function" && globalThis.URL?.createObjectURL) {
    const objectUrl = globalThis.URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const image = new globalThis.Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(imageWriteError("Product image could not be decoded", "SHOPIFY_IMAGE_CONTENT_INVALID"));
        image.src = objectUrl;
      });
    } finally {
      globalThis.URL.revokeObjectURL(objectUrl);
    }
  }
  throw imageWriteError("Image validation is unavailable in this browser", "SHOPIFY_IMAGE_CONTENT_INVALID");
}

async function validateBrowserImage(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw imageWriteError("Choose a product image", "SHOPIFY_IMAGE_REQUIRED");
  }
  const contentType = String(file.type || "").toLowerCase();
  if (!shopifyImageMimeTypes.has(contentType)) {
    throw imageWriteError("Product image must be JPEG, PNG, WebP, or GIF", "SHOPIFY_IMAGE_TYPE_UNSUPPORTED");
  }
  if (!Number.isInteger(file.size) || file.size <= 0 || file.size > SHOPIFY_PRODUCT_IMAGE_MAX_BYTES) {
    throw imageWriteError("Product image must be no larger than 20 MB", "SHOPIFY_IMAGE_SIZE_INVALID");
  }
  const { width, height } = await browserImageDimensions(file);
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  if (!width || !height || width > 4472 || height > 4472 || (width * height) > 20_000_000 ||
    !shortSide || (longSide / shortSide) > 100) {
    throw imageWriteError("Product image dimensions are not supported", "SHOPIFY_IMAGE_DIMENSIONS_INVALID");
  }
  const bytes = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return {
    digest: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    contentType,
    size: file.size,
    width,
    height
  };
}

export function isManagedLiveInventoryImage(value) {
  try {
    const url = new URL(String(value || ""));
    return url.pathname.includes(shopifyImagePublicMarker) && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export async function uploadLiveInventoryImage(file) {
  const preparedInput = await validateBrowserImage(file);
  const prepared = await invokeCatalog("prepare-image-upload", preparedInput);
  const image = prepared.image;
  if (!image?.path || !image?.publicUrl) {
    throw imageWriteError("Product image upload could not be prepared", "SHOPIFY_IMAGE_SIGN_FAILED");
  }
  if (image.existing) return { ...image, uploadedByThisDraft: false };
  const { client } = await adminContext();
  const uploaded = await client.storage.from(image.bucket || SHOPIFY_PRODUCT_IMAGE_BUCKET)
    .uploadToSignedUrl(image.path, image.token, file, {
      cacheControl: "31536000",
      contentType: preparedInput.contentType,
      upsert: false
    });
  if (uploaded.error) {
    // A parallel identical upload can win between prepare and upload. The
    // server-side digest verifier is the only safe way to absorb that race.
    try {
      const verified = await invokeCatalog("verify-image-upload", { path: image.path });
      return { ...verified.image, uploadedByThisDraft: false };
    } catch {
      throw imageWriteError(uploaded.error.message || "Product image upload failed", "SHOPIFY_IMAGE_UPLOAD_FAILED");
    }
  }
  try {
    const verified = await invokeCatalog("verify-image-upload", { path: image.path });
    return { ...verified.image, uploadedByThisDraft: true };
  } catch (error) {
    try {
      await invokeCatalog("cleanup-image-upload", { publicUrl: image.publicUrl });
    } catch {
      // Preserve the validation error; a later same-digest prepare also
      // self-heals an invalid leftover object before issuing a new token.
    }
    throw error;
  }
}

export async function cleanupLiveInventoryImage(value) {
  if (!isManagedLiveInventoryImage(value)) return { ok: true, removed: false, retained: false };
  return invokeCatalog("cleanup-image-upload", { publicUrl: String(value) });
}

export async function createLiveInventoryProduct(product) {
  const result = await invokeCatalog("create", { requestId: requestId(), product });
  await invalidateLiveTables("products", "inventory_stock", "shopify_variant_links", "shopify_catalog_bindings", "shopify_catalog_jobs");
  return result;
}

function localProductRow(product, parentProduct, parentProductId = null) {
  return {
    id: product.id,
    name: String(product.name || "").trim(),
    price: Math.max(0, Number(product.price) || 0),
    warranty_months: Math.max(0, Math.trunc(Number(product.warrantyMonths) || 0)),
    category: String(parentProduct.category || "").trim() || null,
    internal_code: String(product.internalCode || "").trim() || null,
    status: ["draft", "active", "discontinued"].includes(product.status) ? product.status : "draft",
    image_url: String(product.imageUrl || parentProduct.imageUrl || "").trim() || null,
    specs: String(product.specs || "").trim() || null,
    product_type: String(parentProduct.productType || "").trim() || null,
    collections: parentProductId ? [] : (Array.isArray(parentProduct.collections) ? parentProduct.collections : []),
    tags: parentProductId ? [] : (Array.isArray(parentProduct.tags) ? parentProduct.tags : []),
    parent_product_id: parentProductId,
    shopify_excluded: product.shopifyExcluded === true,
    is_virtual: false
  };
}

function localVariants(product) {
  return [
    ...(Array.isArray(product.variants) ? product.variants : []),
    ...(Array.isArray(product.bizflowOnlyVariants) ? product.bizflowOnlyVariants : [])
  ];
}

function localStockRows(product) {
  return [product, ...localVariants(product)]
    .flatMap((item) => (Array.isArray(item.stocks) ? item.stocks : []).map((stock) => ({
      product_id: item.id,
      warehouse_id: stock.warehouseId,
      // Stock may go negative: persist the signed value instead of clamping it to 0.
      qty: Math.trunc(Number(stock.quantity) || 0),
      updated_at: new Date().toISOString()
    })));
}

async function updateBizflowOnlyInventoryProduct(product) {
  const { client } = await adminContext();
  const variants = localVariants(product);
  const parent = localProductRow(product, product);
  const updated = await client.from("products").update(parent).eq("id", product.id).select("id").maybeSingle();
  if (updated.error) throw new ShopifyCatalogWriteError(updated.error.message, { code: "BIZFLOW_PRODUCT_UPDATE_FAILED" });
  if (!updated.data?.id) throw new ShopifyCatalogWriteError("BizFlow product not found", { code: "BIZFLOW_PRODUCT_NOT_FOUND" });

  if (variants.length) {
    const savedVariants = await client.from("products").upsert(
      variants.map((variant) => localProductRow(variant, product, product.id)),
      { onConflict: "id" }
    );
    if (savedVariants.error) {
      throw new ShopifyCatalogWriteError(savedVariants.error.message, { code: "BIZFLOW_VARIANT_UPDATE_FAILED" });
    }
  }

  const existingVariants = await client.from("products").select("id").eq("parent_product_id", product.id);
  if (existingVariants.error) {
    throw new ShopifyCatalogWriteError(existingVariants.error.message, { code: "BIZFLOW_VARIANT_READ_FAILED" });
  }
  const retainedIds = new Set(variants.map((variant) => variant.id));
  const removedIds = (existingVariants.data || []).map((row) => row.id).filter((id) => !retainedIds.has(id));
  if (removedIds.length) {
    const removed = await client.from("products").delete().in("id", removedIds).eq("parent_product_id", product.id);
    if (removed.error) {
      throw new ShopifyCatalogWriteError(removed.error.message, { code: "BIZFLOW_VARIANT_DELETE_FAILED" });
    }
  }

  const stocks = localStockRows(product);
  if (stocks.length) {
    const savedStocks = await client.from("inventory_stock").upsert(stocks, { onConflict: "product_id,warehouse_id" });
    if (savedStocks.error) {
      throw new ShopifyCatalogWriteError(savedStocks.error.message, { code: "BIZFLOW_STOCK_UPDATE_FAILED" });
    }
  }
  await invalidateLiveTables("products", "inventory_stock");
  return { ok: true, localOnly: true, productId: product.id };
}

export async function updateLiveInventoryProduct(
  product,
  expectedShopifyUpdatedAt = "",
  expectedShopifyStructureHash = "",
  { shopifyBound = true } = {}
) {
  if (!shopifyBound) return updateBizflowOnlyInventoryProduct(product);
  let result;
  try {
    result = await invokeCatalog("update", {
      requestId: requestId(), product, expectedShopifyUpdatedAt, expectedShopifyStructureHash
    });
  } catch (error) {
    // The Edge function may have persisted the explicit exclusion intent
    // before a later Shopify step failed; do not leave the local snapshot stale.
    await invalidateLiveTables("products");
    throw error;
  }
  await invalidateLiveTables("products", "inventory_stock", "shopify_variant_links", "shopify_catalog_bindings", "shopify_catalog_jobs");
  return result;
}

export async function deleteLiveInventoryProduct(bizflowParentProductId, { shopifyBound = true } = {}) {
  if (!shopifyBound) {
    const { client } = await adminContext();
    const removed = await client.from("products").delete().eq("id", bizflowParentProductId).select("id").maybeSingle();
    if (removed.error) throw new ShopifyCatalogWriteError(removed.error.message, { code: "BIZFLOW_PRODUCT_DELETE_FAILED" });
    if (!removed.data?.id) throw new ShopifyCatalogWriteError("BizFlow product not found", { code: "BIZFLOW_PRODUCT_NOT_FOUND" });
    await invalidateLiveTables("products", "inventory_stock");
    return { ok: true, localOnly: true, productId: bizflowParentProductId };
  }
  const result = await invokeCatalog("delete", {
    requestId: requestId(), bizflowParentProductId
  });
  await invalidateLiveTables("products", "inventory_stock", "shopify_variant_links", "shopify_catalog_bindings", "shopify_catalog_jobs");
  return result;
}

export async function confirmLiveShopifyBinding(bizflowParentProductId, shopifyProductId) {
  const result = await invokeCatalog("confirm-binding", { bizflowParentProductId, shopifyProductId });
  await invalidateLiveTables("shopify_catalog_bindings");
  return result;
}

export async function linkLiveShopifyComponent({ shopifyVariantId, shopifyProductId, shopifySku, bizflowProductId, qty }) {
  const result = await invokeCatalog("link-component", {
    shopifyVariantId, shopifyProductId, shopifySku, bizflowProductId, qty
  });
  await invalidateLiveTables("shopify_variant_links");
  return result;
}

export async function unlinkLiveShopifyComponent({ shopifyVariantId, bizflowProductId }) {
  const result = await invokeCatalog("unlink-component", { shopifyVariantId, bizflowProductId });
  await invalidateLiveTables("shopify_variant_links");
  return result;
}

export async function previewLiveShopifyAliasLinks() {
  return invokeCatalog("link-from-aliases", { confirm: false });
}

export async function confirmLiveShopifyAliasLinks() {
  const result = await invokeCatalog("link-from-aliases", { confirm: true });
  await invalidateLiveTables("shopify_variant_links");
  return result;
}

export async function saveLiveShopifyResourceMapping({ kind, bizflowKey, shopifyResourceId, shopifyName = "" }) {
  const result = await invokeCatalog("save-resource-mapping", {
    kind, bizflowKey, shopifyResourceId, shopifyName
  });
  await invalidateLiveTables("shopify_resource_mappings");
  return result;
}

function inventoryDomainWriteError(message, code, detail = null) {
  return new ShopifyCatalogWriteError(message, { code, detail });
}

function aliasPayload(draft) {
  return {
    alias_name: String(draft?.aliasName || draft?.alias_name || "").trim(),
    skip: draft?.skip === true,
    products: draft?.skip === true ? [] : (Array.isArray(draft?.products)
      ? draft.products.filter((product) => product?.product_id && Number(product.qty) > 0)
      : []),
    note: String(draft?.note || "").trim() || null,
    verified: true,
    updated_at: new Date().toISOString()
  };
}

export async function saveLiveInventoryAlias(draft) {
  const { client } = await adminContext();
  const payload = aliasPayload(draft);
  if (!payload.alias_name) throw inventoryDomainWriteError("Alias name is required", "INVENTORY_ALIAS_NAME_REQUIRED");
  const query = draft?.id
    ? client.from("line_item_aliases").update(payload).eq("id", draft.id)
    : client.from("line_item_aliases").insert(payload);
  const saved = await query.select().single();
  if (saved.error) throw inventoryDomainWriteError(saved.error.message, "INVENTORY_ALIAS_SAVE_FAILED");
  await invalidateLiveTables("line_item_aliases");
  return saved.data;
}

export async function deleteLiveInventoryAlias(aliasId) {
  const { client } = await adminContext();
  const removed = await client.from("line_item_aliases").delete().eq("id", aliasId);
  if (removed.error) throw inventoryDomainWriteError(removed.error.message, "INVENTORY_ALIAS_DELETE_FAILED");
  await invalidateLiveTables("line_item_aliases");
  return { ok: true, aliasId };
}

export async function verifyLiveInventoryAlias(aliasId) {
  const { client } = await adminContext();
  const verified = await client.from("line_item_aliases")
    .update({ verified: true, updated_at: new Date().toISOString() })
    .eq("id", aliasId)
    .select()
    .single();
  if (verified.error) throw inventoryDomainWriteError(verified.error.message, "INVENTORY_ALIAS_VERIFY_FAILED");
  await invalidateLiveTables("line_item_aliases");
  return verified.data;
}

function supplierPayload(draft) {
  return {
    name: String(draft?.name || "").trim(),
    contact_url: String(draft?.contactUrl || draft?.contact_url || "").trim() || null,
    contact_person: String(draft?.contactPerson || draft?.contact_person || "").trim() || null,
    category: String(draft?.category || "").trim() || null,
    note: String(draft?.note || "").trim() || null
  };
}

export async function createLiveInventorySupplier(draft) {
  const { client } = await adminContext();
  const payload = supplierPayload(draft);
  if (!payload.name) throw inventoryDomainWriteError("Supplier name is required", "INVENTORY_SUPPLIER_NAME_REQUIRED");
  const saved = await client.from("suppliers").insert(payload).select().single();
  if (saved.error) throw inventoryDomainWriteError(saved.error.message, "INVENTORY_SUPPLIER_CREATE_FAILED");
  await invalidateLiveTables("suppliers");
  return saved.data;
}

export async function updateLiveInventorySupplier(supplierId, draft) {
  const { client } = await adminContext();
  const patch = { ...supplierPayload(draft), updated_at: new Date().toISOString() };
  if (!patch.name) throw inventoryDomainWriteError("Supplier name is required", "INVENTORY_SUPPLIER_NAME_REQUIRED");
  const saved = await client.from("suppliers").update(patch).eq("id", supplierId).select().single();
  if (saved.error) throw inventoryDomainWriteError(saved.error.message, "INVENTORY_SUPPLIER_UPDATE_FAILED");
  await invalidateLiveTables("suppliers");
  return saved.data;
}

export async function deleteLiveInventorySupplier(supplierId) {
  const { client } = await adminContext();
  const removed = await client.from("suppliers").delete().eq("id", supplierId);
  if (removed.error) throw inventoryDomainWriteError(removed.error.message, "INVENTORY_SUPPLIER_DELETE_FAILED");
  await invalidateLiveTables("suppliers");
  return { ok: true, supplierId };
}

const pendingDeductionTables = [
  "invoices", "inventory_stock", "inventory_movements", "stock_deduction_audit", "line_item_aliases"
];

function invoiceItems(invoice) {
  let items = invoice?.items;
  if (typeof items === "string") {
    try { items = JSON.parse(items); } catch { items = []; }
  }
  return Array.isArray(items) ? items : [];
}

function normalizedAliasName(value) {
  return String(value || "").toLowerCase().trim();
}

function buildLiveDeductionPlan({ invoice, products, warehouses, stocks, aliases }) {
  if (invoice.legacy_skip_deduct === true) {
    return [{ name: "Historical invoice", source_item_name: "Historical invoice", qty: 0, skip: true }];
  }
  if (String(invoice.notes || "").includes("__BROADWAY__")) {
    return [{ name: "Broadway channel", source_item_name: "Broadway channel", qty: 0, skip: true }];
  }
  const defaultWarehouseId = warehouses[0]?.id || null;
  const items = invoiceItems(invoice);
  const parentIds = new Set(products.filter((product) => product.parent_product_id).map((product) => product.parent_product_id));
  const aliasByName = new Map(aliases.map((alias) => [normalizedAliasName(alias.alias_name), alias]));
  const plan = [];
  for (const item of items) {
    const itemName = String(item?.name || "");
    const itemQty = Number(item?.qty) || 0;
    const alias = aliasByName.get(normalizedAliasName(itemName));
    if (!alias) {
      const product = products.find((candidate) => candidate.name === itemName);
      if (!product || product.is_virtual === true || product.category === "_archived" || parentIds.has(product.id)) {
        plan.push({ name: itemName, source_item_name: itemName, qty: itemQty, skip: true });
        continue;
      }
      const warehouseId = item?.warehouse_id || defaultWarehouseId;
      if (!warehouseId) {
        plan.push({ name: itemName, source_item_name: itemName, qty: itemQty, skip: true });
        continue;
      }
      const current = Number(stocks.find((stock) => stock.product_id === product.id && stock.warehouse_id === warehouseId)?.qty) || 0;
      plan.push({ product_id: product.id, warehouse_id: warehouseId, name: itemName, source_item_name: itemName, qty: itemQty, current, after: current - itemQty });
      continue;
    }
    if (alias.skip === true) {
      plan.push({ name: itemName, source_item_name: itemName, qty: itemQty, skip: true });
      continue;
    }
    const mappedProducts = Array.isArray(alias.products) ? alias.products : [];
    if (!mappedProducts.length) {
      plan.push({ name: itemName, source_item_name: itemName, qty: itemQty, skip: true });
      continue;
    }
    for (const mapped of mappedProducts) {
      const product = products.find((candidate) => candidate.id === mapped.product_id);
      if (!product || product.is_virtual === true || product.category === "_archived" || parentIds.has(product.id)) {
        plan.push({ name: itemName, source_item_name: itemName, qty: 0, skip: true });
        continue;
      }
      const warehouseId = item?.warehouse_id || defaultWarehouseId;
      if (!warehouseId) {
        plan.push({ name: itemName, source_item_name: itemName, qty: 0, skip: true });
        continue;
      }
      const totalDeduct = (Number(mapped.qty) || 1) * itemQty;
      const current = Number(stocks.find((stock) => stock.product_id === product.id && stock.warehouse_id === warehouseId)?.qty) || 0;
      plan.push({ product_id: product.id, warehouse_id: warehouseId, name: `${itemName} -> ${product.name}`, source_item_name: itemName, qty: totalDeduct, current, after: current - totalDeduct });
    }
  }
  return plan;
}

export async function dismissLivePendingDeduction(invoiceId) {
  const { client, currentUser } = await adminContext();
  const current = await client.from("invoices").select("id,notes").eq("id", invoiceId).maybeSingle();
  if (current.error || !current.data) {
    throw inventoryDomainWriteError(current.error?.message || "Invoice not found", "PENDING_INVOICE_NOT_FOUND");
  }
  const marker = `__DEDUCT_DISMISSED__ ${new Date().toISOString().slice(0, 10)}`;
  const updates = {
    legacy_skip_deduct: true,
    notes: current.data.notes ? `${current.data.notes}\n${marker}` : marker
  };
  const updated = await client.from("invoices").update(updates).eq("id", invoiceId);
  if (updated.error) throw inventoryDomainWriteError(updated.error.message, "PENDING_DISMISS_FAILED");
  const audit = await client.from("stock_deduction_audit").insert({
    invoice_id: invoiceId,
    item_name: "__DISMISSED__",
    mapped_product_id: null,
    mapped_qty: 0,
    warehouse_id: null,
    decision: "dismissed",
    audited_by: currentUser?.employeeId || null
  });
  if (audit.error) console.warn("[dismiss audit] insert failed", audit.error.message);
  await invalidateLiveTables(...pendingDeductionTables);
  return { ok: true, invoiceId, auditRecorded: !audit.error };
}

export async function reviewLivePendingDeduction(invoiceId, { allowDuplicate = false } = {}) {
  const { client, currentUser } = await adminContext();
  const [invoiceResult, productsResult, warehousesResult, stocksResult, aliasesResult, movementsResult] = await Promise.all([
    client.from("invoices").select("id,invoice_number,status,items,notes,legacy_skip_deduct").eq("id", invoiceId).maybeSingle(),
    client.from("products").select("id,name,is_virtual,category,parent_product_id"),
    client.from("warehouses").select("id,name,code,sort_order").order("sort_order"),
    client.from("inventory_stock").select("product_id,warehouse_id,qty"),
    client.from("line_item_aliases").select("id,alias_name,skip,products,note,verified"),
    client.from("inventory_movements").select("id,delta").eq("invoice_id", invoiceId).eq("type", "sale")
  ]);
  const failedRead = [invoiceResult, productsResult, warehousesResult, stocksResult, aliasesResult, movementsResult]
    .find((result) => result.error);
  if (failedRead?.error) throw inventoryDomainWriteError(failedRead.error.message, "PENDING_DEDUCTION_READ_FAILED");
  if (!invoiceResult.data) throw inventoryDomainWriteError("Invoice not found", "PENDING_INVOICE_NOT_FOUND");
  const deductedQty = (movementsResult.data || []).reduce((sum, row) => sum + Math.abs(Number(row.delta || 0)), 0);
  if (deductedQty > 0 && !allowDuplicate) {
    throw inventoryDomainWriteError("Invoice already has stock deductions", "PENDING_DEDUCTION_DUPLICATE", { deductedQty });
  }

  const invoice = invoiceResult.data;
  const plan = buildLiveDeductionPlan({
    invoice,
    products: productsResult.data || [],
    warehouses: warehousesResult.data || [],
    stocks: stocksResult.data || [],
    aliases: aliasesResult.data || []
  });
  const deductions = plan.filter((row) => !row.skip && row.qty > 0 && row.product_id && row.warehouse_id);
  for (const deduction of deductions) {
    const stock = await client.from("inventory_stock").upsert({
      product_id: deduction.product_id,
      warehouse_id: deduction.warehouse_id,
      qty: deduction.after,
      updated_at: new Date().toISOString()
    }, { onConflict: "product_id,warehouse_id" });
    if (stock.error) throw inventoryDomainWriteError(stock.error.message, "PENDING_STOCK_DEDUCTION_FAILED");
    const movement = await client.from("inventory_movements").insert({
      product_id: deduction.product_id,
      warehouse_id: deduction.warehouse_id,
      delta: -deduction.qty,
      type: "sale",
      reason: `發票 #${invoice.invoice_number || invoice.id} 補扣庫存`,
      invoice_id: invoice.id
    });
    if (movement.error) throw inventoryDomainWriteError(movement.error.message, "PENDING_MOVEMENT_INSERT_FAILED");
  }

  let auditError = null;
  if (plan.length) {
    const auditRows = plan.map((row) => ({
      invoice_id: invoice.id,
      item_name: row.source_item_name || row.name,
      mapped_product_id: row.product_id || null,
      mapped_qty: row.qty || 0,
      warehouse_id: row.warehouse_id || null,
      decision: row.skip ? "skip" : "confirm",
      audited_by: currentUser?.employeeId || null
    }));
    const audit = await client.from("stock_deduction_audit").insert(auditRows);
    auditError = audit.error || null;
    if (auditError) console.warn("[audit] insert failed", auditError.message);
  }

  const itemQtyByName = new Map(invoiceItems(invoice).map((item) => [item.name, Number(item.qty) || 1]));
  const groups = new Map();
  for (const row of plan) {
    const key = row.source_item_name || row.name;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const aliasUpserts = [];
  for (const [alias_name, rows] of groups) {
    if (rows.every((row) => row.skip)) continue;
    const itemQty = itemQtyByName.get(alias_name) || 1;
    const products = rows.filter((row) => !row.skip && row.product_id).map((row) => ({
      product_id: row.product_id,
      qty: itemQty > 0 ? +((Number(row.qty) || 0) / itemQty).toFixed(2) : (Number(row.qty) || 1)
    }));
    if (products.length) aliasUpserts.push({ alias_name, skip: false, products, verified: true });
  }
  let aliasError = null;
  if (aliasUpserts.length) {
    const aliases = await client.from("line_item_aliases").upsert(aliasUpserts, { onConflict: "alias_name" });
    aliasError = aliases.error || null;
    if (aliasError) console.warn("[alias] upsert failed", aliasError.message);
  }
  await invalidateLiveTables(...pendingDeductionTables);
  return {
    ok: true,
    invoiceId,
    deductions: deductions.length,
    auditRecorded: !auditError,
    aliasesRecorded: !aliasError
  };
}

export function shopifyWriteReady(health) {
  return health?.connected === true && health?.writeReady === true;
}
