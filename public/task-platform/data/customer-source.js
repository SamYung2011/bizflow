// Mirrors bizflow_samyung/src/views/Customers.jsx:522-550.

function dateTime(value) {
  const match = String(value || "").match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? time
    : null;
}

function rawInvoiceSource(invoice) {
  const notes = String(invoice?.notes || "");
  if (notes.includes("__FORMS_BUY__")) return "framer";
  if (notes.includes("__BROADWAY__")) return "other";
  if (invoice?.invoice_number != null && /^\d+$/.test(String(invoice.invoice_number))) return "shopify";
  return "other";
}

function normalizedOrderSource(order) {
  if (order?.source === "Framer") return "framer";
  if (order?.source === "Online Store") return "shopify";
  return "other";
}

export function customerSourceFromInvoices(invoices, { normalized = false } = {}) {
  if (!Array.isArray(invoices) || invoices.length === 0) return "other";
  const dated = invoices
    .map((invoice) => ({ invoice, time: dateTime(invoice?.date) }))
    .filter(({ time }) => time !== null)
    .sort((left, right) => left.time - right.time);
  const earliest = dated[0]?.invoice ?? invoices[0];
  return normalized ? normalizedOrderSource(earliest) : rawInvoiceSource(earliest);
}
