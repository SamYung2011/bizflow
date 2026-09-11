import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { SUPABASE_URL } from "../root-site/config.local.js";
import { storageImageCorsAttrs, thumbImageAttrs, thumbUrl } from "../root-site/components/storage-image.js";

const read = (path) => readFile(new URL(`../root-site/${path}`, import.meta.url), "utf8");
const [home, css, inventory, detail] = await Promise.all([
  read("bizflow/home.js"), read("bizflow/home.css"), read("bizflow/inventory.js"), read("bizflow/inventory-detail.js")
]);
const original = `${SUPABASE_URL}/storage/v1/object/public/product-images/PRD-0001/1778140257480.png`;
const width = Number(home.match(/const HOME_STOCK_IMAGE_WIDTH = (\d+)/)[1]);
const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;");

test("home slot requests 2x width, quality 75, anonymous CORS and original fallback", () => {
  const slot = Number(css.match(/\.home-thumb\s*\{\s*width: (\d+)px/)[1]);
  assert.equal(width, Math.round(slot * 2));
  const render = vm.runInNewContext(`${home.slice(home.indexOf("  const stockRow ="), home.indexOf("  const memberCell ="))}; stockRow`, {
    thumbImageAttrs, HOME_STOCK_IMAGE_WIDTH: width, e: escapeHtml
  });
  const html = render({ image: original, product: "Adapter", itemsId: "PRD-0001", count: 1 });
  assert.match(html, /crossorigin="anonymous"/);
  assert.ok(html.includes(escapeHtml(thumbUrl(original, width))));
  assert.match(html, /width=80&amp;quality=75/);
  assert.ok(html.includes(`data-original-src="${original}"`));
  assert.doesNotMatch(render({ product: "No image", itemsId: "empty", count: 0 }), /<img/);
});

test("render fallback retries original only once and retains CORS", () => {
  const attrs = thumbImageAttrs(original, width, escapeHtml);
  const image = { src: thumbUrl(original, width), crossOrigin: "anonymous", dataset: { originalSrc: original } };
  image.onerror = new Function(attrs.match(/onerror="([^"]+)"/)[1]);
  image.onerror.call(image);
  assert.equal(image.onerror, null);
  assert.equal(image.src, original);
  assert.equal(image.crossOrigin, "anonymous");
});

test("preloader uses the same thumbnail and CORS mode before its first request", () => {
  const requests = [];
  const images = [];
  class Image {
    constructor() { images.push(this); }
    set src(url) { requests.push({ url, cors: this.crossOrigin, referrer: this.referrerPolicy }); }
  }
  vm.runInNewContext(`${home.slice(home.indexOf("function preloadHomeStockImages()"), home.indexOf("function isHomeRefreshBlocked()"))}; preloadHomeStockImages()`, {
    data: { stock: [{ image: original }] }, Image, thumbUrl, storageImageCorsAttrs, HOME_STOCK_IMAGE_WIDTH: width
  });
  assert.deepEqual(requests, [{ url: thumbUrl(original, width), cors: "anonymous", referrer: "no-referrer" }]);
  images[0].onerror();
  assert.equal(requests[1].url, original);
  assert.equal(requests[1].cors, "anonymous");
  assert.equal(images[0].onerror, null);
});

test("local public and rendered storage URLs use anonymous; external and upload previews keep their mode", () => {
  for (const url of [original, thumbUrl(original, 120), `${SUPABASE_URL}/storage/v1/object/public/shopify/item.png`]) {
    assert.equal(storageImageCorsAttrs(url), 'crossorigin="anonymous" ');
    assert.match(thumbImageAttrs(url, 120, escapeHtml), /crossorigin="anonymous"/);
  }
  for (const url of ["", "blob:https://example.net/id", "data:image/png;base64,eA==", "https://cdn.shopify.com/a.png", "https://other.example/storage/v1/object/public/a.png"]) {
    assert.equal(storageImageCorsAttrs(url), "");
    assert.doesNotMatch(thumbImageAttrs(url, 120, escapeHtml), /crossorigin/);
  }
});

test("every home and inventory img routes storage through shared CORS attributes", () => {
  for (const [name, source] of [["home", home], ["inventory", inventory], ["detail", detail]]) {
    const tags = source.match(/<img\b[^>]*>/g) ?? [];
    assert.equal(tags.length, name === "home" ? 1 : 2, `${name}: inspect any newly introduced image`);
    for (const tag of tags) assert.match(tag, /thumbImageAttrs|storageImageCorsAttrs/, name);
  }
  assert.match(inventory, /thumbImageAttrs\(product.imageUrl, 120, escapeHtml\)/);
  assert.match(detail, /thumbImageAttrs\(imageUrl, 640, escapeHtml\)/);
  assert.match(detail, /thumbImageAttrs\(item.imageUrl, 120, escapeHtml\)/);
});
