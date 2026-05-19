// 發票相關純函數 helper
// 從 App.jsx 抽出，跨 view 共用（dashboard / Customers / Invoices）

// 將發票編號格式化為 DCxxxxx 形式：純數字 → 補齊到 5 位；UUID fallback 不動
export const fmtInvNum = (inv) => {
  const raw = String(inv.invoice_number || inv.id)
  const stripped = raw.replace(/^DC/i, "")
  const formatted = /^\d+$/.test(stripped) ? stripped.padStart(5, "0") : stripped
  return `DC${formatted}`
}
