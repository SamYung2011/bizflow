function normText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ")
}

function compactCode(value) {
  return String(value || "").replace(/[\s-]+/g, "")
}

export function isValidImeiCode(value) {
  return /^\d{15}$/.test(compactCode(value))
}

export function splitImeiCodes(value, { validOnly = false } = {}) {
  return String(value || "")
    .split(/[\n,，;；]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => compactCode(s))
    .filter(code => !validOnly || isValidImeiCode(code))
}

export function mergeImeiCodes(existing, additions) {
  const seen = new Set()
  const merged = []
  for (const code of [...splitImeiCodes(existing), ...additions.flatMap(v => splitImeiCodes(v, { validOnly: true }))]) {
    const key = compactCode(code).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(compactCode(code))
  }
  return merged.join("\n") || null
}

export function isDcAdaptorProProduct(product) {
  const raw = normText([product?.name, product?.internal_code, product?.code, product?.category].filter(Boolean).join(" "))
  if (!raw) return false
  const hasDc = /\bdc\b/.test(raw) || raw.includes("直流")
  const hasPro = /\bpro\b/.test(raw) || raw.includes("專業")
  const hasAdaptor = raw.includes("adaptor") || raw.includes("adapter") || raw.includes("轉接") || raw.includes("轉插")
  return hasDc && hasPro && hasAdaptor
}

export function resolveLineItemProducts(name, { products = [], lineItemAliases = [] } = {}) {
  const key = normText(name)
  if (!key) return []

  const productById = new Map((products || []).map(p => [String(p.id), p]))
  const alias = (lineItemAliases || []).find(a => normText(a.alias_name) === key)
  if (alias) {
    if (alias.skip === true) return []
    return (Array.isArray(alias.products) ? alias.products : [])
      .map(ap => productById.get(String(ap.product_id)))
      .filter(Boolean)
  }

  return (products || []).filter(p => (
    normText(p.name) === key
    || (!!p.internal_code && normText(p.internal_code) === key)
    || (!!p.code && normText(p.code) === key)
  ))
}

export function isDcAdaptorProLineItem(itemOrName, options = {}) {
  const name = typeof itemOrName === "string" ? itemOrName : itemOrName?.name
  const hasCatalog = Array.isArray(options.products) && options.products.length > 0
  const hasAliases = Array.isArray(options.lineItemAliases) && options.lineItemAliases.length > 0
  const resolved = resolveLineItemProducts(name, options)
  if (resolved.length > 0) return resolved.some(isDcAdaptorProProduct)
  if (hasCatalog || hasAliases) return false
  return isDcAdaptorProProduct({ name })
}

export function isDcAdaptorProItemName(name, options = {}) {
  return isDcAdaptorProLineItem(name, options)
}

export function collectImeiCodesFromItems(items, options = {}) {
  if (!Array.isArray(items)) return []
  return items
    .filter(item => isDcAdaptorProLineItem(item, options))
    .flatMap(item => splitImeiCodes(item?.imei_code, { validOnly: true }))
}

export function collectInvalidImeiCodesFromItems(items, options = {}) {
  if (!Array.isArray(items)) return []
  return items
    .filter(item => isDcAdaptorProLineItem(item, options))
    .flatMap(item => splitImeiCodes(item?.imei_code))
    .filter(code => !isValidImeiCode(code))
}

export async function appendCustomerImeiCodes({
  supabase,
  queryClient,
  customers,
  setCustomers,
  customerId,
  imeiCodes,
}) {
  const additions = imeiCodes.flatMap(v => splitImeiCodes(v, { validOnly: true }))
  if (!customerId || additions.length === 0) return { updated: false }
  const current = customers.find(c => c.id === customerId)
  if (!current) return { updated: false }

  const nextImei = mergeImeiCodes(current.imei_code, additions)
  if ((current.imei_code || null) === nextImei) return { updated: false }

  const { error } = await supabase
    .from("customers")
    .update({ imei_code: nextImei })
    .eq("id", customerId)
  if (error) return { updated: false, error }

  setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, imei_code: nextImei } : c))
  queryClient?.setQueryData?.(["bf", "customers"], (old) => (
    Array.isArray(old)
      ? old.map(c => c.id === customerId ? { ...c, imei_code: nextImei } : c)
      : old
  ))
  return { updated: true, imei_code: nextImei }
}
