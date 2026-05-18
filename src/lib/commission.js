// 銷售佣金規則
// 每件 HKD，product.category 命中才算。改規則改這裡。
export const COMMISSION_RULES = {
  '轉插': 600,
}

// 此日期之前的發票不算佣金（歷史不追溯）
export const COMMISSION_CUTOFF = '2026-05-09'

// 計算發票佣金（snapshot at Paid time）
// 規則：date >= COMMISSION_CUTOFF + 有 salesperson_id + 非百老匯，按 line items 走 alias 解析到 product，
//       product.category 命中 COMMISSION_RULES 則 per_unit × qty 累加
export function computeCommissionFor(inv, salespersonId, { products, lineItemAliases }) {
  if (!salespersonId) return 0
  if (!inv.date || inv.date < COMMISSION_CUTOFF) return 0
  if ((inv.notes || '').includes('__BROADWAY__')) return 0
  let itemsArr = inv.items
  if (typeof itemsArr === 'string') { try { itemsArr = JSON.parse(itemsArr) } catch { itemsArr = [] } }
  if (!Array.isArray(itemsArr)) return 0
  const norm = (s) => (s || '').toLowerCase().trim()
  const aliasByName = new Map(lineItemAliases.map(a => [norm(a.alias_name), a]))
  let total = 0
  for (const it of itemsArr) {
    const itemQty = Number(it.qty) || 0
    if (itemQty <= 0) continue
    const alias = aliasByName.get(norm(it.name))
    let resolved = []
    if (alias && alias.skip !== true && Array.isArray(alias.products)) {
      for (const ap of alias.products) {
        resolved.push({ product_id: ap.product_id, qty: (Number(ap.qty) || 1) * itemQty })
      }
    } else if (!alias) {
      const directProd = products.find(p => p.name === it.name)
      if (directProd) resolved.push({ product_id: directProd.id, qty: itemQty })
    }
    for (const r of resolved) {
      const p = products.find(x => x.id === r.product_id)
      if (!p) continue
      const rate = COMMISSION_RULES[p.category]
      if (!rate) continue
      total += rate * r.qty
    }
  }
  return total
}
