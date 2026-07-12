export function renderSegment({
  items,
  active,
  ariaLabel,
  escapeHtml,
  dataAttribute,
  variant = "domain"
}) {
  if (!/^data-[a-z0-9-]+$/.test(dataAttribute)) {
    throw new Error(`Invalid segment data attribute: ${dataAttribute}`);
  }

  const e = escapeHtml;
  return `<div class="app-segment app-segment--${e(variant)}" role="tablist" aria-label="${e(ariaLabel)}">
    ${items.map((item) => {
      const selected = item.key === active;
      const label = item.label ?? item.key;
      const badge = item.badge === null || item.badge === undefined
        ? ""
        : `<span class="app-segment__badge">${e(String(item.badge))}</span>`;
      return `<button type="button" role="tab" aria-selected="${selected}" class="app-segment__button${selected ? " is-active" : ""}" ${dataAttribute}="${e(item.key)}" title="${e(item.title ?? label)}"><span class="app-segment__label">${e(label)}</span>${badge}</button>`;
    }).join("")}
  </div>`;
}
