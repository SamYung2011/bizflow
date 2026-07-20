export const DEFAULT_TABLE_PAGE_SIZE = 1000;

function pageQuery(client, table, columns, from, pageSize, orderCol, ascending, secondaryOrder, count = null) {
  let query = client.from(table).select(columns, count ? { count } : undefined)
    .range(from, from + pageSize - 1);
  if (orderCol) query = query.order(orderCol, { ascending });
  if (secondaryOrder) query = query.order(secondaryOrder, { ascending: true });
  return query;
}

function appendUniqueRows(target, seen, data) {
  for (const row of data ?? []) {
    if (row?.id != null) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
    }
    target.push(row);
  }
}

function tableError(table, response, operation = "") {
  const error = response?.error;
  const label = operation ? `${table} ${operation}` : table;
  return new Error(`${label}: ${error?.message || error || "request failed"}`);
}

// Fetch the first page with an ordinary GET and reuse its exact count to fan
// out the remaining pages. This avoids the authenticated HEAD path that is
// unreliable on the self-hosted PostgREST stack while preserving parallel
// pagination for large tables.
export async function fetchAllTablePages({
  client,
  table,
  orderCol,
  ascending = true,
  secondaryOrder = "id",
  columns = "*",
  pageSize = DEFAULT_TABLE_PAGE_SIZE
}) {
  if (!client || typeof client.from !== "function") throw new TypeError("A Supabase client is required.");
  if (!table) throw new TypeError("A table name is required.");
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new TypeError("pageSize must be a positive integer.");

  let first = await pageQuery(client, table, columns, 0, pageSize, orderCol, ascending, secondaryOrder, "exact");
  if (first.error) {
    // Count failures must not make otherwise-readable tables unavailable.
    // The no-count fallback stays GET-only and walks until the final short page.
    first = await pageQuery(client, table, columns, 0, pageSize, orderCol, ascending, secondaryOrder);
  }
  if (first.error) throw tableError(table, first);

  const rows = [];
  const seen = new Set();
  appendUniqueRows(rows, seen, first.data);

  const exactCount = Number.isInteger(first.count) && first.count >= 0 ? first.count : null;
  if (exactCount !== null) {
    const pageCount = Math.max(1, Math.ceil(exactCount / pageSize));
    const responses = await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => {
      const from = (index + 1) * pageSize;
      return pageQuery(client, table, columns, from, pageSize, orderCol, ascending, secondaryOrder);
    }));
    for (const response of responses) {
      if (response.error) throw tableError(table, response);
      appendUniqueRows(rows, seen, response.data);
    }
    return rows;
  }

  let page = first.data ?? [];
  for (let from = pageSize; page.length === pageSize; from += pageSize) {
    const response = await pageQuery(client, table, columns, from, pageSize, orderCol, ascending, secondaryOrder);
    if (response.error) throw tableError(table, response);
    page = response.data ?? [];
    appendUniqueRows(rows, seen, page);
  }
  return rows;
}
