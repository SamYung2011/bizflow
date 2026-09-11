import { getSession, getSupabaseClient } from "./auth.js";

export async function searchOrderCustomers(search, { offset = 0, signal } = {}) {
  const term = String(search || "").trim();
  if (!term) return { rows: [], hasMore: false };
  const [client, session] = await Promise.all([getSupabaseClient(), getSession()]);
  if (!client || !session?.user?.id) {
    const { getCustomersPageData } = await import("./provider.js");
    const page = await getCustomersPageData();
    const rows = page.customers.filter((row) => [row.name, row.phone, row.detail?.email]
      .some((value) => String(value || "").toLocaleLowerCase().includes(term.toLocaleLowerCase())));
    return { rows: rows.slice(offset, offset + 20), hasMore: rows.length > offset + 20 };
  }
  let request = client.rpc("bizflow_order_customer_candidates", { p_search: term, p_offset: offset });
  if (signal) request = request.abortSignal(signal);
  const result = await request;
  if (result.error) throw result.error;
  if (!Array.isArray(result.data?.rows)) throw new Error("Invalid customer candidate payload");
  return { rows: result.data.rows, hasMore: result.data.hasMore === true };
}
