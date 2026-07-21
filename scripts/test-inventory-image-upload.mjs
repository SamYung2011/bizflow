import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const [migration, edge, imageEdge, catalog, writes, inventory, detail, css] = await Promise.all([
  read("migrations/095_shopify_product_images.sql"),
  read("supabase/functions/shopify-catalog-write/index.ts"),
  read("supabase/functions/shopify-catalog-write/image.ts"),
  read("supabase/functions/shopify-catalog-write/catalog.ts"),
  read("root-site/data/live-inventory-writes.js"),
  read("root-site/bizflow/inventory.js"),
  read("root-site/bizflow/inventory-detail.js"),
  read("root-site/bizflow/inventory.css"),
]);

assert.match(migration, /INSERT INTO storage\.buckets[\s\S]*'shopify-product-images'[\s\S]*true[\s\S]*20971520/,
  "the dedicated public bucket and 20 MB storage limit must be migration-owned");
for (const mime of ["image/jpeg", "image/png", "image/webp", "image/gif"]) assert.match(migration, new RegExp(mime));
assert.match(migration, /CREATE POLICY "shopify-product-images-public-read"[\s\S]*FOR SELECT TO public/);
assert.doesNotMatch(migration, /CREATE POLICY[^;]*(?:INSERT|UPDATE|DELETE)[^;]*shopify-product-images/,
  "browser roles must never receive direct mutation policies on the Shopify image bucket");

for (const action of ["prepare-image-upload", "verify-image-upload", "cleanup-image-upload"]) {
  assert.match(edge, new RegExp(`"${action}"`), `${action} must be routed through the catalog Edge function`);
}
const imageRoute = edge.indexOf('body.action === "prepare-image-upload"');
const imageWriteGate = edge.indexOf("requireShopifyWriteReady(health)", imageRoute);
const imagePrepare = edge.indexOf("prepareCatalogImageUpload", imageRoute);
assert.ok(imageRoute > 0 && imageWriteGate > imageRoute && imagePrepare > imageWriteGate,
  "signed image actions must run after the existing admin auth and Shopify write-ready gates");
assert.match(edge, /body\.action !== "delete"[\s\S]*ensureCatalogImageForWrite[\s\S]*executeCatalogWrite/,
  "catalog create/update must verify changed image bytes before the Shopify job starts");

assert.match(imageEdge, /SHOPIFY_IMAGE_BUCKET = "shopify-product-images"/);
assert.match(imageEdge, /Deno\.env\.get\("SUPABASE_PUBLIC_URL"\)[\s\S]*SHOPIFY_IMAGE_PUBLIC_URL_UNCONFIGURED[\s\S]*storage\/v1\/object\/public/,
  "managed image URLs must be derived from the configured public Supabase origin and fail closed when it is unusable");
assert.doesNotMatch(imageEdge, /getPublicUrl\(/,
  "managed image URLs must never fall back to the Edge container's internal Supabase client origin");
assert.match(imageEdge, /MANAGED_PATH_PATTERN[\s\S]*sha256\//,
  "storage paths must be derived from the SHA-256 content address");
assert.match(imageEdge, /createSignedUploadUrl\(path, \{ upsert: false \}\)/,
  "the Edge function must issue a single immutable path upload token");
assert.match(imageEdge, /download\(managed\.path\)[\s\S]*imageInfo\(bytes\)[\s\S]*validateDimensions\(info\.width, info\.height\)[\s\S]*sha256\(bytes\)[\s\S]*actualDigest !== managed\.digest/,
  "the second validation layer must verify actual bytes, magic type, dimensions and digest server-side");
assert.match(imageEdge, /from\("products"\)[\s\S]*\.eq\("image_url", url\)/,
  "cleanup must retain content-addressed objects still referenced by any product");
assert.match(imageEdge, /shopify_catalog_jobs[\s\S]*shopify_applied_pending_db[\s\S]*\.contains\("request_payload", \{ product: \{ imageUrl: url \} \}\)/,
  "cleanup must not race a Shopify-successful job awaiting DB finalization");
assert.match(imageEdge, /action === "update"[\s\S]*current\.data\?\.image_url\) === imageUrl\) return/,
  "unchanged legacy image URLs must remain valid without being forced into the new bucket");

assert.match(writes, /SHOPIFY_PRODUCT_IMAGE_ACCEPT = "image\/jpeg,image\/png,image\/webp,image\/gif"/);
assert.match(writes, /file\.size > SHOPIFY_PRODUCT_IMAGE_MAX_BYTES/);
assert.match(writes, /width > 4472[\s\S]*height > 4472[\s\S]*20_000_000[\s\S]*longSide \/ shortSide/,
  "the browser layer must enforce Shopify dimensions, megapixels and aspect ratio before upload");
assert.match(writes, /crypto\.subtle\.digest\("SHA-256", bytes\)/);
assert.match(writes, /invokeCatalog\("prepare-image-upload"[\s\S]*uploadToSignedUrl[\s\S]*invokeCatalog\("verify-image-upload"/,
  "signed upload must be followed by Edge byte verification");
assert.match(writes, /verify-image-upload[\s\S]*catch \(error\)[\s\S]*cleanup-image-upload[\s\S]*throw error/,
  "a newly uploaded object that fails Edge verification must not be left orphaned");
assert.match(writes, /parallel identical upload[\s\S]*verify-image-upload/,
  "a same-digest concurrent upload must converge instead of failing or duplicating");
assert.match(writes, /image\.existing\)[\s\S]*uploadedByThisDraft: false[\s\S]*uploadedByThisDraft: true/,
  "draft cleanup ownership must distinguish reused content from a newly uploaded object");

assert.match(catalog, /function variantSetInput\([\s\S]*includeFiles: boolean/);
assert.match(catalog, /if \(includeFiles\)[\s\S]*input\.files = product\.imageUrl[\s\S]*duplicateResolutionMode: "REPLACE"[\s\S]*: \[\]/,
  "changed media must use one content-addressed Shopify file, while removal sends the list-empty contract");
assert.match(catalog, /catalogMediaChanged\(admin, action, product!\.id, product!\.imageUrl\)[\s\S]*createOrUpdateShopifyProduct/,
  "unrelated price or stock saves must omit files instead of recreating Shopify media from a CDN URL mismatch");

for (const source of [inventory, detail]) {
  assert.match(source, /type="file"[\s\S]*SHOPIFY_PRODUCT_IMAGE_ACCEPT/);
  assert.match(source, /uploadLiveInventoryImage/);
  assert.match(source, /cleanupLiveInventoryImage/);
  assert.doesNotMatch(source, /name="imageUrl"|data-detail-field="imageUrl"|商品圖片 URL|Product image URL|URL de l'image produit/,
    "the raw image URL editor must be gone in all three languages");
  for (const copy of ["20MB", "20 MB", "20 Mo"]) assert.match(source, new RegExp(copy.replace(" ", "\\s")));
}
const addModal = inventory.slice(
  inventory.indexOf("function renderAddProductModal"),
  inventory.indexOf("function renderWriteStatus"),
);
assert.match(addModal, /renderAddImageUpload\(helpers\)/,
  "the create-product modal must render the managed file-upload control");
assert.doesNotMatch(addModal, /type="url"|name="imageUrl"|addModal\.imageUrl/,
  "the create-product modal must not retain a parallel raw image URL field");
assert.match(inventory, /state\.addImage\?\.publicUrl[\s\S]*createLiveInventoryProduct/,
  "new products must submit only the verified upload URL");
assert.match(inventory, /async function closeAddProductModal[\s\S]*cleanupAddProductImage\(\)[\s\S]*resetAddProductDraft/,
  "cancelling a create draft must clean the new object before the modal state is discarded");
assert.match(inventory, /uploadedByThisDraft !== true[\s\S]*state\.addImage = null/,
  "cancelling one draft must never delete content-addressed bytes reused from another draft or product");
assert.match(detail, /SHOPIFY_UPDATED_AT_CONFLICT[\s\S]*confirmInPage[\s\S]*expectedStructureHash = currentStructureHash/,
  "image drafts must preserve the existing explicit 409 recovery loop");
assert.doesNotMatch(detail.match(/while \(true\) \{[\s\S]*?\n    \}/)?.[0] || "", /cleanupLiveInventoryImage/,
  "a 409 or cancelled overwrite must not delete the retryable image draft");
assert.match(detail, /detailCommitted = true;[\s\S]*originalImageUrl !== committedImageUrl[\s\S]*cleanupCommittedDetailImages/,
  "the old object may be cleaned only after Shopify and BizFlow commit successfully");
assert.match(detail, /deleteLiveInventoryProduct[\s\S]*detailCommitted = true;[\s\S]*cleanupCommittedDetailImages/,
  "true product deletion must clean managed images only after the delete succeeds");
assert.match(detail, /scope\.listen\(document, "change", onInventoryDetailInput\)/);

assert.match(css, /\.inventory-image-upload__preview/);
assert.match(css, /\.inventory-detail-image-editor[\s\S]*align-items: stretch/);
assert.match(css, /@media \(max-width: 768px\)[\s\S]*inventory-detail-image-editor[\s\S]*width: 100%/,
  "the image editor needs an explicit narrow-screen layout");

console.log("inventory image upload contract: PASS");
