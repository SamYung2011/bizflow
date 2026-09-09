export const EXPENSE_RECEIPT_BUCKET = "expense-receipts";
export const RECEIPT_SIGN_TTL_SECONDS = 3600;

export function receiptPathFromStored(value) {
  if (typeof value !== "string") return "";
  const stored = value.trim();
  if (!/^http/i.test(stored)) return stored.replace(/^\/+/, "");
  try {
    const url = new URL(stored);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/expense-receipts\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}
