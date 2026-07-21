import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";
import { invalidateLiveTables } from "./live-snapshot-utils.js";

let healthPromise = null;

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
  return { client };
}

async function functionErrorPayload(error) {
  try {
    if (error?.context && typeof error.context.json === "function") return await error.context.json();
  } catch {
    // Preserve the original safe client error when the relay body is unavailable.
  }
  return null;
}

async function invokeCatalog(action, payload = {}) {
  const { client } = await adminContext();
  const result = await client.functions.invoke("shopify-catalog-write", { body: { action, ...payload } });
  if (result.error) {
    const detail = await functionErrorPayload(result.error);
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

export async function createLiveInventoryProduct(product) {
  const result = await invokeCatalog("create", { requestId: requestId(), product });
  await invalidateLiveTables("products", "inventory_stock", "shopify_variant_links", "shopify_catalog_bindings", "shopify_catalog_jobs");
  return result;
}

export async function updateLiveInventoryProduct(product, expectedShopifyUpdatedAt = "", expectedShopifyStructureHash = "") {
  const result = await invokeCatalog("update", {
    requestId: requestId(), product, expectedShopifyUpdatedAt, expectedShopifyStructureHash
  });
  await invalidateLiveTables("products", "inventory_stock", "shopify_variant_links", "shopify_catalog_bindings", "shopify_catalog_jobs");
  return result;
}

export async function deleteLiveInventoryProduct(
  bizflowParentProductId, expectedShopifyUpdatedAt = "", expectedShopifyStructureHash = ""
) {
  const result = await invokeCatalog("delete", {
    requestId: requestId(), bizflowParentProductId, expectedShopifyUpdatedAt, expectedShopifyStructureHash
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

export async function saveLiveShopifyResourceMapping({ kind, bizflowKey, shopifyResourceId, shopifyName = "" }) {
  const result = await invokeCatalog("save-resource-mapping", {
    kind, bizflowKey, shopifyResourceId, shopifyName
  });
  await invalidateLiveTables("shopify_resource_mappings");
  return result;
}

export function shopifyWriteReady(health) {
  return health?.connected === true && health?.writeReady === true;
}
