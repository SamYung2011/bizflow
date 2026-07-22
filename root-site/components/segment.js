export function renderSegment({
  items,
  active,
  ariaLabel,
  escapeHtml,
  dataAttribute,
  variant = "domain",
  sliding = true
}) {
  if (!/^data-[a-z0-9-]+$/.test(dataAttribute)) {
    throw new Error(`Invalid segment data attribute: ${dataAttribute}`);
  }

  const e = escapeHtml;
  const itemCount = Math.max(items.length, 1);
  const selectedIndex = Math.max(items.findIndex((item) => item.key === active), 0);
  const motionClass = sliding ? " app-segment--sliding" : " app-segment--parallel";
  return `<div class="app-segment app-segment--${e(variant)}${motionClass}" role="tablist" aria-label="${e(ariaLabel)}" data-active-index="${selectedIndex}" style="--app-segment-count:${itemCount};--app-segment-active-index:${selectedIndex}">
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
