export function renderBarChart({
  items,
  maxHeight,
  escapeHtml,
  columnClass,
  valueClass,
  barClass,
  labelClass,
  formatValue = (value) => String(value),
  formatTitle = ({ label, value }) => `${label} ${value}`.trim()
}) {
  const max = Math.max(...items.map((item) => Number(item.value) || 0), 1);
  return items.map((item) => {
    const value = Number(item.value) || 0;
    const label = item.label || "";
    return `<div class="${columnClass}" title="${escapeHtml(formatTitle({ label, value }))}">
      <span class="${valueClass}">${escapeHtml(formatValue(value))}</span>
      <span class="${barClass}" style="height:${Math.round((value / max) * maxHeight)}px"></span>
      ${label ? `<span class="${labelClass}">${escapeHtml(label)}</span>` : ""}
    </div>`;
  }).join("");
}
