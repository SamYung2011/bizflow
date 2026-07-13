import { escapeHtml } from "../../components/shared.js";
import { INVOICE_PAGE, INVOICE_SHELL_HEAD, INVOICE_SHELL_TAIL } from "./invoice-template.js";
import { RECEIPT_FRAGMENT } from "./receipt-template.js";

function invoiceNumber(order) {
  const raw = String(order?.orderNo ?? order?.id ?? "")
    .trim()
    .replace(/^#/, "")
    .replace(/^DC/i, "");
  return /^\d+$/.test(raw) ? raw.padStart(5, "0") : raw;
}

function moneyValue(value) {
  if (value === null || value === undefined || value === "") return "";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : String(value);
}

function itemRows(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && (item.name || item.quantity !== undefined || item.price !== undefined))
    .map((item) => `<div class="table-row">
      <div>${escapeHtml(item.name ?? "")}</div>
      <div>${escapeHtml(item.quantity ?? item.qty ?? "")}</div>
      <div class="col-price">${escapeHtml(moneyValue(item.price))}</div>
    </div>`)
    .join("");
}

export function toPrintableOrder(source, overrides = {}) {
  const row = source?.order ?? source ?? {};
  const detail = source?.detail ?? row.detail ?? {};
  const customer = typeof row.customer === "object" ? row.customer?.name : row.customer;
  return {
    orderNo: detail.orderNo ?? row.orderNo ?? row.no ?? "",
    date: row.date ?? detail.date ?? "",
    customer: customer ?? row.customerName ?? row.name ?? "",
    phone: row.phone ?? detail.phone ?? "",
    email: detail.email ?? row.email ?? "",
    shippingAddress: detail.shippingAddress ?? row.shippingAddress ?? row.address ?? "",
    carModel: detail.carModel ?? row.carModel ?? "",
    items: detail.items ?? row.items ?? [],
    paymentTotal: detail.paymentTotal ?? row.paymentTotal ?? "",
    ...overrides
  };
}

function replaceTemplate(template, values) {
  return Object.entries(values).reduce(
    (output, [key, value]) => output.replace(key, value),
    template
  );
}

export function buildInvoiceDocument(order, mode = { invoice: true, receipt: true }) {
  if (!mode.invoice && !mode.receipt) return "";

  const subject = escapeHtml(invoiceNumber(order));
  const date = escapeHtml(order?.date ?? "");
  const customer = escapeHtml(order?.customer ?? order?.customerName ?? "");
  const phone = escapeHtml(order?.phone ?? "");
  const email = escapeHtml(order?.email ?? "");
  const address = escapeHtml(order?.shippingAddress ?? order?.address ?? "");
  // 快照只有合并车型字段，按单据约定整串放 make 行，model 行诚实留空。
  const carMake = escapeHtml(order?.carModel ?? "");
  const rows = itemRows(order?.items);
  const total = escapeHtml(moneyValue(order?.paymentTotal));

  const invoicePage = mode.invoice
    ? replaceTemplate(INVOICE_PAGE, {
        "{{subject_line}}": subject,
        "{{date}}": date,
        "{{customer_name}}": customer,
        "{{customer_phone}}": phone,
        "{{customer_email}}": email,
        "{{customer_address}}": address,
        "{{car_make}}": carMake,
        "{{car_model}}": "",
        "{{Total_Sum}}": total,
        "{{invoice_rows}}": rows
      })
    : "";

  const receiptPage = mode.receipt
    ? replaceTemplate(
        RECEIPT_FRAGMENT.replace(
          'class="page receipt-page"',
          `class="${mode.invoice ? "page receipt-page" : "page"}"`
        ),
        {
          "{{r_subject_line}}": subject,
          "{{r_date}}": date,
          "{{r_customer_name}}": customer,
          "{{r_customer_phone}}": phone,
          "{{r_customer_email}}": email,
          "{{r_customer_address}}": address,
          "{{r_car_make}}": carMake,
          "{{r_car_model}}": "",
          "{{r_Total_Sum}}": total,
          "{{r_rows}}": rows
        }
      )
    : "";

  return INVOICE_SHELL_HEAD + invoicePage + receiptPage + INVOICE_SHELL_TAIL;
}

export function printInvoice(order, mode = { invoice: true, receipt: true }) {
  const html = buildInvoiceDocument(order, mode);
  if (!html) return true;

  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;

  printWindow.document.write(html);
  printWindow.document.close();
  try {
    printWindow.document.title = `DC${invoiceNumber(order)}`;
  } catch {}
  setTimeout(() => printWindow.print(), 500);
  return true;
}
