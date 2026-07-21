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
  return { client };
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

export async function updateLiveInventoryProduct(product, expectedShopifyUpdatedAt = "", expectedShopifyStructureHash = "") {
  const result = await invokeCatalog("update", {
    requestId: requestId(), product, expectedShopifyUpdatedAt, expectedShopifyStructureHash
  });
  await invalidateLiveTables("products", "inventory_stock", "shopify_variant_links", "shopify_catalog_bindings", "shopify_catalog_jobs");
  return result;
}

export async function deleteLiveInventoryProduct(bizflowParentProductId) {
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
