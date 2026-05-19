// 物流狀態派生 + 異常判斷（Dashboard / Invoices view 共用）

// 物流追蹤啟用日期，之前的發票沒走物流（avoid 4500+ 張歷史 null 全進待發貨）
export const SHIPPING_TRACKING_SINCE = '2026-05-05'

// 物流狀態派生：沒填單號 → 待發貨；否則用 shipping_status（保底）
export function deriveShippingStatus(inv) {
  if (inv.shipping_status) return inv.shipping_status
  return inv.tracking_number ? '已發貨' : '待發貨'
}

export function isShippingTrackable(inv) {
  return (inv?.date || '') >= SHIPPING_TRACKING_SINCE
}

// 是否「有問題」=（手動標的）異常 OR （已發貨但 > 14 天還沒簽收）
// Dashboard 的「超期未簽」卡 + Invoices 的「異常」filter 都用這個統一邏輯
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000
export function isProblematicShipping(inv) {
  const ss = deriveShippingStatus(inv)
  if (ss === '異常') return true
  if (['已發貨', '在途', '派送中'].includes(ss)) {
    if (!inv.shipped_at) return false
    return new Date(inv.shipped_at).getTime() < (Date.now() - FOURTEEN_DAYS_MS)
  }
  return false
}
