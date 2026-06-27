// 發票相關純函數 helper
// 從 App.jsx 抽出，跨 view 共用（dashboard / Customers / Invoices）

// 包 supabase invoices INSERT：取五位數順序號（當前 < 100000 嘅 max + 1），
// 遇 unique violation (23505) 自動 +1 重試（保留防撞號能力）。配 DB unique index
// invoices_invoice_number_uniq 兜底。
// 2026-06-27 改：舊版用 generateInvoiceNumber 9 位隨機號（為防 Date.now().slice(-6) 撞號），
// 但發票號顯示過長；煊煊要求手動發票號維持五位數，改為五位數順序取號 + 撞號 +1 重試。
// 發票表混入過 9 位大號（舊 9 位隨機 + Shopify），所以限 < 100000 取 max。
// `buildPayload(num)` 由 caller 提供，返回 INSERT row（含 invoice_number）。
// 返回 { data, error, attempts } — data 為新 row 或 null。
export async function insertInvoiceWithRetry(supabase, buildPayload, maxAttempts = 8) {
  // 取五位數段當前最大號（排除混入嘅 6 位+ 大號）
  const { data: maxRow } = await supabase
    .from("invoices")
    .select("invoice_number")
    .not("invoice_number", "is", null)
    .lt("invoice_number", 100000)
    .order("invoice_number", { ascending: false })
    .limit(1)
  const base = (maxRow?.[0]?.invoice_number || 0) + 1
  for (let i = 0; i < maxAttempts; i++) {
    const num = base + i  // 撞號就 +1 再試（並發時別人先佔咗就試下一個）
    if (num >= 100000) {
      return { data: null, error: { code: "OUT_OF_RANGE", message: "five-digit invoice number space exhausted" }, attempts: i + 1 }
    }
    const payload = buildPayload(num)
    const { data, error } = await supabase.from("invoices").insert([payload]).select()
    if (!error && data) return { data, error: null, attempts: i + 1 }
    // 23505 = unique_violation；只在這條才重試（+1 換號），其他錯誤直接返回
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
