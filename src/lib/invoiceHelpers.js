// 發票相關純函數 helper
// 從 App.jsx 抽出，跨 view 共用（dashboard / Customers / Invoices）

// 生成 9 位純數字 invoice_number（保持「來源 Shopify」判定 `/^\d+$/` 兼容）。
// 後 9 位毫秒戳 + 同毫秒並發加 9-bit random fanout。`Date.now() % 10^9` 約 11.5 天循環、
// 加 DB unique index `invoices_invoice_number_uniq` 兜底，配合 insertInvoiceWithRetry 撞號自動換號。
export const generateInvoiceNumber = () => {
  const ts = Number(`${Date.now()}`.slice(-9))
  const rand = Math.floor(Math.random() * 512)  // 0-511
  return String((ts * 1000 + rand) % 1_000_000_000).padStart(9, "0")
}

// 包 supabase invoices INSERT，遇 unique violation (23505) 自動換 invoice_number 重試。
// `buildPayload(num)` 由 caller 提供，返回 INSERT row（含 invoice_number）。
// 返回 { data, error, attempts } — data 為新 row 或 null。
export async function insertInvoiceWithRetry(supabase, buildPayload, maxAttempts = 5) {
  for (let i = 0; i < maxAttempts; i++) {
    const num = generateInvoiceNumber()
    const payload = buildPayload(num)
    const { data, error } = await supabase.from("invoices").insert([payload]).select()
    if (!error && data) return { data, error: null, attempts: i + 1 }
    // 23505 = unique_violation；只在這條才重試，其他錯誤直接返回
    if (error?.code !== "23505") return { data: null, error, attempts: i + 1 }
  }
  return { data: null, error: { code: "23505", message: "invoice_number conflict after retries" }, attempts: maxAttempts }
}

// 將發票編號格式化為 DCxxxxx 形式：純數字 → 補齊到 5 位；UUID fallback 不動
export const fmtInvNum = (inv) => {
  const raw = String(inv.invoice_number || inv.id)
  const stripped = raw.replace(/^DC/i, "")
  const formatted = /^\d+$/.test(stripped) ? stripped.padStart(5, "0") : stripped
  return `DC${formatted}`
}

// 把 notes 裡的內部 marker 隱藏（__FORMS_BUY__ / __PENDING_MERGE__:xxx 等），UTC timestamp 轉 HK 時間
export const formatNotes = (notes) => {
  if (!notes) return ""
  // 隱藏內部 marker：__FORMS_BUY__ / __PENDING_MERGE__:cid 等（雙下劃線包圍的全大寫詞，可帶 :id 後綴）
  let out = notes.replace(/__[A-Z_]+__(?::[\w-]+)?\s*/g, "")
  out = out.replace(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z/g, (_, y, mo, d, h, mi) => {
    const utc = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi))
    const hk = new Date(utc.getTime() + 8 * 60 * 60 * 1000)
    const pad = (n) => String(n).padStart(2, "0")
    return `${hk.getUTCFullYear()}-${pad(hk.getUTCMonth() + 1)}-${pad(hk.getUTCDate())} ${pad(hk.getUTCHours())}:${pad(hk.getUTCMinutes())}`
  })
  return out.trim()
}

// 推斷發票來源（Shopify 直接訂單 / Framer 表單 / 百老匯 / 手動）
// 回 { key, color, bg }；view 自己 t(key) 顯示文案
export const invoiceSource = (inv) => {
  const notes = inv?.notes || ""
  if (notes.includes("__BROADWAY__")) return { key: "百老匯", color: "#dc2626", bg: "#fee2e2" }
  if (notes.includes("__FORMS_BUY__")) return { key: "Framer", color: "#6382ff", bg: "#eef2ff" }
  // notes 空 + invoice_number 純數字 → 大概率 Shopify 同步進來的
  if (inv?.invoice_number && /^\d+$/.test(String(inv.invoice_number))) {
    return { key: "Shopify", color: "#16a34a", bg: "#dcfce7" }
  }
  return { key: "手動", color: "#888", bg: "#f5f5f5" }
}
