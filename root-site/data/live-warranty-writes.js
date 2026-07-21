import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";
import { invalidateLiveTables } from "./live-snapshot-utils.js";

function validDateInput(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function throwIfError(error) {
  if (error) throw error;
}

async function writeContext() {
  const [client, session, currentUser] = await Promise.all([
    getSupabaseClient(),
    getSession(),
    getCurrentUser()
  ]);
  if (!client || !session?.user || currentUser?.bizflowMainAccess !== true) {
    throw new Error("Warranty renewal permission required");
  }
  return { client };
}

export async function renewLiveWarranty({ invoiceId, productId, months, paidAt }) {
  const normalizedMonths = Number(months);
  if (!invoiceId || !productId) throw new Error("Warranty invoice and product are required");
  if (![12, 24].includes(normalizedMonths)) throw new Error("Warranty renewal months must be 12 or 24");
  if (!validDateInput(paidAt)) throw new Error("Warranty renewal payment date is required");

  const { client } = await writeContext();
  const result = await client.from("warranty_renewals")
    .insert({ invoice_id: invoiceId, product_id: productId, months: normalizedMonths, paid_at: paidAt })
    .select("*")
    .single();
  throwIfError(result.error);
  if (!result.data?.id || !result.data?.new_end) throw new Error("Warranty renewal returned an invalid result");
  // The shared table->snapshot dependency map evicts both warranty.json and
  // home.json from memory and IDB, so the tab, Home card and count rebuild
  // from the same invoice-derived renewal overlay on the next read/navigation.
  await invalidateLiveTables("invoices", "warranty_renewals");
  return result.data;
}
