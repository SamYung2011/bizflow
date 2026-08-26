import { SUPABASE_URL } from "../config.local.js";

const storageOrigin = String(SUPABASE_URL || "").trim().replace(/\/+$/, "");
const publicObjectPrefix = `${storageOrigin}/storage/v1/object/public/`;
const publicRenderPath = "/storage/v1/render/image/public/";

export function thumbUrl(url, width) {
  const source = String(url || "").trim();
  const targetWidth = Math.round(Number(width));
  if (!source || !storageOrigin || !source.startsWith(publicObjectPrefix) || !Number.isFinite(targetWidth) || targetWidth <= 0) {
    return source;
  }
  try {
    const rendered = new URL(source);
    rendered.pathname = `${publicRenderPath}${rendered.pathname.slice("/storage/v1/object/public/".length)}`;
    rendered.searchParams.set("width", String(targetWidth));
    rendered.searchParams.set("quality", "75");
    return rendered.toString();
  } catch {
    return source;
  }
}

export function thumbImageAttrs(url, width, escapeHtml) {
  const original = String(url || "").trim();
  const thumbnail = thumbUrl(original, width);
  const fallback = thumbnail !== original
    ? ` data-original-src="${escapeHtml(original)}" onerror="this.onerror=null;this.src=this.dataset.originalSrc"`
    : "";
  return `src="${escapeHtml(thumbnail)}"${fallback}`;
}
