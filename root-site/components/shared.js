const iconsUrl = "../assets/icons/icons.svg";

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function icon(id, className = "icon", label = "") {
  const safeId = escapeHtml(id);
  const safeClass = escapeHtml(className);
  const aria = label
    ? `role="img" aria-label="${escapeHtml(label)}"`
    : 'aria-hidden="true"';
  const href = document.getElementById("tp-icon-sprite") ? `#${safeId}` : `${iconsUrl}#${safeId}`;
  return `<svg class="${safeClass}" ${aria}><use href="${href}"></use></svg>`;
}

export function styleVars(variant) {
  const rules = [];
  if (variant.width) rules.push(`--component-width:${Number(variant.width)}px`);
  if (variant.height) rules.push(`--component-height:${Number(variant.height)}px`);
  if (variant.minHeight) rules.push(`--component-min-height:${Number(variant.minHeight)}px`);
  return rules.length ? ` style="${rules.join(";")}"` : "";
}

export function classNames(...parts) {
  return parts
    .flat()
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join(" ");
}

export function titleAttr(text) {
  return ` title="${escapeHtml(text)}"`;
}

export function pill(text, tone = "neutral") {
  return `<span class="tp-pill tp-pill--${escapeHtml(tone)}"${titleAttr(text)}>${escapeHtml(text)}</span>`;
}

export function redDot() {
  return '<span class="tp-dot" aria-hidden="true"></span>';
}
