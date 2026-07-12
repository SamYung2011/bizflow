const SINGLE_COLUMN_QUERY = "(max-width: 1560px)";
export const MANAGEMENT_ROWS_PER_COLUMN = 9;

export function managementColumnCount() {
  return window.matchMedia(SINGLE_COLUMN_QUERY).matches ? 1 : 2;
}

export function managementPageSize() {
  return MANAGEMENT_ROWS_PER_COLUMN * managementColumnCount();
}

export function renderManagementPager({
  page,
  pages,
  visible = true,
  icon,
  escapeHtml,
  previousLabel,
  nextLabel
}) {
  if (!visible) return "";
  return `<div class="management-list__pager">
    <div class="management-list__pager-control">
      <button type="button" class="management-list__pager-btn" data-management-page="prev" aria-label="${escapeHtml(previousLabel)}"${page <= 1 ? " disabled" : ""}>
        ${icon("icon-arrow-left", "icon")}
      </button>
      <span class="management-list__pager-label" aria-live="polite">${escapeHtml(`${page}/${pages}`)}</span>
      <button type="button" class="management-list__pager-btn" data-management-page="next" aria-label="${escapeHtml(nextLabel)}"${page >= pages ? " disabled" : ""}>
        ${icon("icon-arrow-right", "icon")}
      </button>
    </div>
  </div>`;
}

export function renderManagementList({ content, pager = "", paged = false }) {
  return `<section class="management-list${paged ? " management-list--paged" : ""}">
    <div class="management-list__grid">${content}</div>
    ${pager}
  </section>`;
}
