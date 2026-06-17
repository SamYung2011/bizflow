import { isNonWarrantyItem } from './warranty.js'

// Blank invoice line item. Keep ids stable for React keys while editing rows.
export function makeInvoiceItem(warehouseId = null) {
  const id = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return { id, name: "", qty: 1, price: 0, warehouse_id: warehouseId, imei_code: "" }
}

export function attachWarrantySnapshot(items, products) {
  if (!Array.isArray(products)) {
    throw new Error("attachWarrantySnapshot requires a products array")
  }
  return items.map(it => {
    if (it == null) return it
    if (it.warranty_months != null) return it
    if (isNonWarrantyItem(it.name)) return it
    const prod = products.find(p => p.name === it.name)
    if (!prod || !prod.warranty_months) return it
    return { ...it, warranty_months: Number(prod.warranty_months) }
  })
}
