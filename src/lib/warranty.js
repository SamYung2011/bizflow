// 非保修項黑名單：運費 / 配件 / 費用類 不進保修提醒
const NON_WARRANTY_REGEX = /運費|郵費|shipping|freight|防水盒|防水袋|押金|手續費/i

export function isNonWarrantyItem(name) {
  if (!name) return true
  return NON_WARRANTY_REGEX.test(String(name).toLowerCase())
}

// 保修月數讀取優先級：item snapshot > 當前 product
// snapshot 防止改產品時追溯歷史單
export function itemWarrantyMonths(item, prod) {
  if (item?.warranty_months != null) return Number(item.warranty_months) || 0
  return prod?.warranty_months || 0
}
