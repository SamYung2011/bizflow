import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { SUPABASE_URL } from "../root-site/config.local.js";
import { thumbImageAttrs, thumbUrl } from "../root-site/components/storage-image.js";

const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/product-images/item/photo.png`;
assert.equal(
  thumbUrl(publicUrl, 120),
  `${SUPABASE_URL}/storage/v1/render/image/public/product-images/item/photo.png?width=120&quality=75`,
  "a local public object must use the Supabase render endpoint",
);
assert.equal(
  thumbUrl(`${publicUrl}?version=2`, 640),
  `${SUPABASE_URL}/storage/v1/render/image/public/product-images/item/photo.png?version=2&width=640&quality=75`,
  "existing query parameters must survive the render rewrite",
);
for (const source of [
  "blob:https://bizflow.honnmono.top/local-preview",
  "https://cdn.shopify.com/product.png",
  "https://other-project.supabase.co/storage/v1/object/public/product-images/photo.png",
  `${SUPABASE_URL}/storage/v1/render/image/public/product-images/photo.png?width=120&quality=75`,
]) {
  assert.equal(thumbUrl(source, 120), source, `non-local public object URL must remain unchanged: ${source}`);
}
assert.equal(thumbUrl(publicUrl, 0), publicUrl, "invalid widths must not rewrite the original URL");

const attrs = thumbImageAttrs(publicUrl, 120, (value) => String(value));
assert.match(attrs, /render\/image\/public\/product-images\/item\/photo\.png\?width=120&quality=75/);
assert.match(attrs, /data-original-src="https:\/\/bizflow\.honnmono\.top\/storage\/v1\/object\/public\/product-images\/item\/photo\.png"/);
assert.match(attrs, /onerror="this\.onerror=null;this\.src=this\.dataset\.originalSrc"/,
  "a failed render request must retry the original object exactly once");

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [inventory, detail, css] = await Promise.all([
  read("root-site/bizflow/inventory.js"),
  read("root-site/bizflow/inventory-detail.js"),
  read("root-site/bizflow/inventory.css"),
]);

assert.match(inventory, /class="inventory-thumb" \$\{thumbImageAttrs\(product\.imageUrl, 120, escapeHtml\)\}/,
  "40px product rows must request a 120px thumbnail");
const addPreview = inventory.slice(
  inventory.indexOf("function renderAddImageUpload"),
  inventory.indexOf("function renderAddProductModal"),
);
assert.match(addPreview, /src="\$\{escapeHtml\(imageUrl\)\}"/);
assert.doesNotMatch(addPreview, /thumb(?:Url|ImageAttrs)/,
  "the upload preview must keep its local/original URL path");

assert.match(detail, /class="inventory-detail-image" \$\{thumbImageAttrs\(imageUrl, 640, escapeHtml\)\}/,
  "the 160px detail image must request the 640px tier");
assert.match(detail, /class="inventory-subitem-image" \$\{thumbImageAttrs\(item\.imageUrl, 120, escapeHtml\)\}/,
  "40px variant rows must request a 120px thumbnail");
assert.match(css, /img\.inventory-subitem-image[\s\S]*?background: var\(--white\)/);
assert.match(css, /\.inventory-subitem-image\s*\{[\s\S]*?object-fit: contain/);

const catalogPayload = detail.slice(detail.indexOf("function catalogPayload"), detail.indexOf("async function cleanupUnsavedDetailImage"));
assert.match(catalogPayload, /imageUrl: item\.imageUrl \|\| ""/);
assert.match(catalogPayload, /imageUrl: String\(detail\.product\.imageUrl \|\| ""\)\.trim\(\)/);
assert.doesNotMatch(catalogPayload, /thumb(?:Url|ImageAttrs)/,
  "catalog writes must continue persisting original image URLs");

console.log("inventory thumbnail contracts: PASS (render rewrite, fallback, 120/640 tiers, original write URLs)");
