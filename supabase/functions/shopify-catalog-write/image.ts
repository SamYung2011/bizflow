import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

export const SHOPIFY_IMAGE_BUCKET = "shopify-product-images";
export const SHOPIFY_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

const MIME_EXTENSION = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);
const EXTENSION_MIME = new Map([...MIME_EXTENSION].map(([mime, extension]) => [extension, mime]));
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const MANAGED_PATH_PATTERN = /^sha256\/([0-9a-f]{2})\/([0-9a-f]{64})\.(jpg|png|webp|gif)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function imageError(code: string, message: string): Error & { code?: string } {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function normalizedDigest(value: unknown): string {
  const digest = text(value).toLowerCase();
  if (!DIGEST_PATTERN.test(digest)) {
    throw imageError("SHOPIFY_IMAGE_DIGEST_INVALID", "Invalid product image digest");
  }
  return digest;
}

function normalizedMime(value: unknown): string {
  const mimeType = text(value).toLowerCase();
  if (!MIME_EXTENSION.has(mimeType)) {
    throw imageError("SHOPIFY_IMAGE_TYPE_UNSUPPORTED", "Product image must be JPEG, PNG, WebP, or GIF");
  }
  return mimeType;
}

function normalizedSize(value: unknown): number {
  const size = Number(value);
  if (!Number.isInteger(size) || size <= 0 || size > SHOPIFY_IMAGE_MAX_BYTES) {
    throw imageError("SHOPIFY_IMAGE_SIZE_INVALID", "Product image must be no larger than 20 MB");
  }
  return size;
}

function pathFor(digest: string, mimeType: string): string {
  return `sha256/${digest.slice(0, 2)}/${digest}.${MIME_EXTENSION.get(mimeType)}`;
}

function managedPath(value: unknown): { path: string; digest: string; mimeType: string } {
  const raw = text(value);
  let path = raw;
  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw imageError("SHOPIFY_IMAGE_SOURCE_INVALID", "Invalid product image URL");
    }
    const marker = `/storage/v1/object/public/${SHOPIFY_IMAGE_BUCKET}/`;
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0 || url.search || url.hash) {
      throw imageError("SHOPIFY_IMAGE_SOURCE_INVALID", "Product image is not from the managed image store");
    }
    try {
      path = decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    } catch {
      throw imageError("SHOPIFY_IMAGE_SOURCE_INVALID", "Invalid product image path");
    }
  }
  const match = path.match(MANAGED_PATH_PATTERN);
  if (!match || match[1] !== match[2].slice(0, 2)) {
    throw imageError("SHOPIFY_IMAGE_SOURCE_INVALID", "Invalid managed product image path");
  }
  return { path, digest: match[2], mimeType: EXTENSION_MIME.get(match[3])! };
}

function publicUrl(path: string): string {
  const base = text(Deno.env.get("SUPABASE_PUBLIC_URL")).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw imageError(
      "SHOPIFY_IMAGE_PUBLIC_URL_UNCONFIGURED",
      "Public Supabase URL is not configured for product images",
    );
  }
  const hostname = parsed.hostname.toLowerCase();
  const localHostname = hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "[::1]" || hostname === "::1";
  const kongHostname = hostname === "kong" || hostname.startsWith("kong.") || hostname.endsWith(".kong");
  if (!base || !["http:", "https:"].includes(parsed.protocol) || localHostname || kongHostname ||
    parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) {
    throw imageError(
      "SHOPIFY_IMAGE_PUBLIC_URL_UNCONFIGURED",
      "Public Supabase URL is not configured for product images",
    );
  }
  return `${base}/storage/v1/object/public/${SHOPIFY_IMAGE_BUCKET}/${path}`;
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  for (let offset = 2; offset + 8 < bytes.length;) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array, ascii: (start: number, length: number) => string) {
  const kind = ascii(12, 4);
  if (kind === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }
  if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    };
  }
  return null;
}

function imageInfo(bytes: Uint8Array): { mimeType: string; width: number; height: number } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const dimensions = jpegDimensions(bytes);
    return dimensions ? { mimeType: "image/jpeg", ...dimensions } : null;
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    if (bytes.length < 24) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { mimeType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (bytes.length >= 10 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) {
    return { mimeType: "image/gif", width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
  }
  if (bytes.length >= 25 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const dimensions = webpDimensions(bytes, ascii);
    return dimensions ? { mimeType: "image/webp", ...dimensions } : null;
  }
  return null;
}

function validateDimensions(width: number, height: number) {
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || !shortSide ||
    width > 4472 || height > 4472 || (width * height) > 20_000_000 || (longSide / shortSide) > 100) {
    throw imageError("SHOPIFY_IMAGE_DIMENSIONS_INVALID", "Product image dimensions are not supported");
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function exactObjectExists(admin: SupabaseClient, path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const listed = await admin.storage.from(SHOPIFY_IMAGE_BUCKET).list(folder, {
    limit: 2,
    search: name,
  });
  if (listed.error) throw imageError("SHOPIFY_IMAGE_STORAGE_FAILED", "Unable to inspect product image storage");
  return (listed.data || []).some((row) => row.name === name);
}

export async function verifyCatalogImage(admin: SupabaseClient, value: unknown) {
  const managed = managedPath(value);
  if (/^https?:\/\//i.test(text(value)) && text(value) !== publicUrl(managed.path)) {
    throw imageError("SHOPIFY_IMAGE_SOURCE_INVALID", "Product image is not from the managed image store");
  }
  const downloaded = await admin.storage.from(SHOPIFY_IMAGE_BUCKET).download(managed.path);
  if (downloaded.error || !downloaded.data) {
    throw imageError("SHOPIFY_IMAGE_NOT_FOUND", "Uploaded product image was not found");
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  normalizedSize(bytes.byteLength);
  const info = imageInfo(bytes);
  if (!info || info.mimeType !== managed.mimeType) {
    throw imageError("SHOPIFY_IMAGE_CONTENT_INVALID", "Product image content does not match its file type");
  }
  validateDimensions(info.width, info.height);
  const actualDigest = await sha256(bytes);
  if (actualDigest !== managed.digest) {
    throw imageError("SHOPIFY_IMAGE_DIGEST_MISMATCH", "Product image content verification failed");
  }
  return {
    bucket: SHOPIFY_IMAGE_BUCKET,
    path: managed.path,
    publicUrl: publicUrl(managed.path),
    digest: managed.digest,
    contentType: managed.mimeType,
    size: bytes.byteLength,
    width: info.width,
    height: info.height,
  };
}

export async function prepareCatalogImageUpload(admin: SupabaseClient, body: JsonRecord) {
  const digest = normalizedDigest(body.digest);
  const contentType = normalizedMime(body.contentType);
  const size = normalizedSize(body.size);
  const path = pathFor(digest, contentType);
  if (await exactObjectExists(admin, path)) {
    try {
      const image = await verifyCatalogImage(admin, path);
      return { ok: true, image: { ...image, existing: true, token: "" } };
    } catch (error) {
      const code = (error as Error & { code?: string }).code || "";
      if (!["SHOPIFY_IMAGE_SIZE_INVALID", "SHOPIFY_IMAGE_CONTENT_INVALID", "SHOPIFY_IMAGE_DIMENSIONS_INVALID", "SHOPIFY_IMAGE_DIGEST_MISMATCH"].includes(code)) {
        throw error;
      }
      const removed = await admin.storage.from(SHOPIFY_IMAGE_BUCKET).remove([path]);
      if (removed.error) throw imageError("SHOPIFY_IMAGE_CLEANUP_FAILED", "Unable to replace invalid product image");
    }
  }
  const signed = await admin.storage.from(SHOPIFY_IMAGE_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (signed.error || !signed.data?.token) {
    throw imageError("SHOPIFY_IMAGE_SIGN_FAILED", "Unable to prepare product image upload");
  }
  return {
    ok: true,
    image: {
      bucket: SHOPIFY_IMAGE_BUCKET,
      path,
      publicUrl: publicUrl(path),
      digest,
      contentType,
      size,
      existing: false,
      token: signed.data.token,
    },
  };
}

async function imageIsReferenced(admin: SupabaseClient, url: string): Promise<boolean> {
  const products = await admin.from("products").select("id").eq("image_url", url).limit(1);
  if (products.error) throw imageError("SHOPIFY_IMAGE_REFERENCE_CHECK_FAILED", "Unable to check product image references");
  if ((products.data || []).length) return true;

  const jobs = await admin.from("shopify_catalog_jobs")
    .select("id")
    .in("status", ["pending", "running", "shopify_applied_pending_db"])
    .contains("request_payload", { product: { imageUrl: url } })
    .limit(1);
  if (jobs.error) throw imageError("SHOPIFY_IMAGE_REFERENCE_CHECK_FAILED", "Unable to check pending image writes");
  return (jobs.data || []).length > 0;
}

export async function cleanupCatalogImage(admin: SupabaseClient, value: unknown) {
  const managed = managedPath(value);
  const url = publicUrl(managed.path);
  if (await imageIsReferenced(admin, url)) {
    return { ok: true, removed: false, retained: true, path: managed.path };
  }
  const removed = await admin.storage.from(SHOPIFY_IMAGE_BUCKET).remove([managed.path]);
  if (removed.error) throw imageError("SHOPIFY_IMAGE_CLEANUP_FAILED", "Unable to remove unused product image");
  return { ok: true, removed: true, retained: false, path: managed.path };
}

export async function ensureCatalogImageForWrite(
  admin: SupabaseClient,
  action: "create" | "update",
  body: JsonRecord,
) {
  const product = body.product as JsonRecord | undefined;
  const imageUrl = text(product?.imageUrl);
  if (action === "update") {
    const productId = text(product?.id);
    if (!UUID_PATTERN.test(productId)) throw imageError("SHOPIFY_IMAGE_PRODUCT_INVALID", "Invalid product image owner");
    const current = await admin.from("products").select("image_url").eq("id", productId).maybeSingle();
    if (current.error) throw imageError("SHOPIFY_IMAGE_REFERENCE_CHECK_FAILED", "Unable to load current product image");
    if (text(current.data?.image_url) === imageUrl) return;
  }
  if (imageUrl) await verifyCatalogImage(admin, imageUrl);
}

export async function catalogMediaChanged(
  admin: SupabaseClient,
  action: "create" | "update",
  productId: string,
  imageUrl: string,
): Promise<boolean> {
  if (action === "create") return true;
  const current = await admin.from("products").select("image_url").eq("id", productId).maybeSingle();
  if (current.error) throw new Error(`Image baseline lookup failed: ${current.error.message}`);
  return text(current.data?.image_url) !== text(imageUrl);
}
