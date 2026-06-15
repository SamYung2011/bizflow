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

function uniqueValidImeis(values) {
  const seen = new Set()
  const out = []
  for (const code of values.flatMap(v => splitImeiCodes(v, { validOnly: true }))) {
    const key = compactCode(code)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

export function customerDeviceRowsFor(customerDevices = [], customerOrIds) {
  const ids = Array.isArray(customerOrIds)
    ? customerOrIds
    : (customerOrIds?.allCids || customerOrIds?.groupCids || (customerOrIds?.id ? [customerOrIds.id] : []))
  const idSet = new Set(ids.filter(Boolean).map(String))
  if (idSet.size === 0) return []
  return (customerDevices || [])
    .filter(row => row?.customer_id && idSet.has(String(row.customer_id)))
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
}

export function customerDeviceImeisFor(customerDevices = [], customerOrIds) {
  const seen = new Set()
  const out = []
  for (const row of customerDeviceRowsFor(customerDevices, customerOrIds)) {
    const imei = compactCode(row.imei)
    if (!imei || seen.has(imei)) continue
    seen.add(imei)
    out.push(imei)
  }
  return out
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
  customerDevices = [],
  setCustomerDevices,
  customerId,
  imeiCodes,
}) {
  const additions = uniqueValidImeis(imeiCodes)
  if (!customerId || additions.length === 0) return { updated: false, conflicts: [] }

  const { data: existing, error: lookupErr } = await supabase
    .from("customer_devices")
    .select("imei, customer_id")
    .in("imei", additions)
  if (lookupErr) return { updated: false, error: lookupErr, conflicts: [] }

  const conflicts = []
  const safeToInsert = []
  const existingByImei = new Map((existing || []).map(r => [compactCode(r.imei), r]))
  for (const imei of additions) {
    const owner = existingByImei.get(imei)
    if (!owner) { safeToInsert.push(imei); continue }
    if (String(owner.customer_id) === String(customerId)) continue
    conflicts.push({ imei, owner_customer_id: owner.customer_id })
  }

  if (safeToInsert.length === 0) {
    return { updated: false, imei_codes: [], conflicts }
  }

  const rows = safeToInsert.map(imei => ({
    customer_id: customerId,
    imei,
    device_type: "adapter_pro",
  }))
  const { data: insertedData, error } = await supabase
    .from("customer_devices")
    .insert(rows)
    .select()
  if (error) return { updated: false, error, conflicts }

  const savedRows = insertedData || rows
  const savedImeis = new Set(safeToInsert)
  const mergeRows = old => (
    Array.isArray(old)
      ? [...old.filter(r => !savedImeis.has(compactCode(r.imei))), ...savedRows]
      : savedRows
  )
  setCustomerDevices?.(mergeRows)
  queryClient?.setQueryData?.(["bf", "customer_devices"], mergeRows)
  return { updated: true, imei_codes: safeToInsert, conflicts }
}

export async function replaceCustomerDeviceImeis({
  supabase,
  queryClient,
  customerDevices = [],
  setCustomerDevices,
  customerId,
  imeiCodes,
  deviceType = "adapter_pro",
}) {
  if (!customerId) return { updated: false, conflicts: [] }
  const nextImeis = uniqueValidImeis(imeiCodes)
  const existing = (customerDevices || []).filter(row => (
    String(row?.customer_id || "") === String(customerId) && (row.device_type || "adapter_pro") === deviceType
  ))
  const nextSet = new Set(nextImeis)
  const existingImeis = new Set(existing.map(row => compactCode(row.imei)).filter(Boolean))
  const staleImeis = [...existingImeis].filter(imei => !nextSet.has(imei))
  const candidateInserts = nextImeis.filter(imei => !existingImeis.has(imei))

  const conflicts = []
  let safeToInsert = candidateInserts
  if (candidateInserts.length > 0) {
    const { data: ownership, error: lookupErr } = await supabase
      .from("customer_devices")
      .select("imei, customer_id")
      .in("imei", candidateInserts)
    if (lookupErr) return { updated: false, error: lookupErr, conflicts: [] }
    const ownByImei = new Map((ownership || []).map(r => [compactCode(r.imei), r]))
    safeToInsert = []
    for (const imei of candidateInserts) {
      const owner = ownByImei.get(imei)
      if (!owner) { safeToInsert.push(imei); continue }
      if (String(owner.customer_id) === String(customerId)) continue
      conflicts.push({ imei, owner_customer_id: owner.customer_id })
    }
  }

  if (staleImeis.length > 0) {
    const { error } = await supabase
      .from("customer_devices")
      .delete()
      .eq("customer_id", customerId)
      .in("imei", staleImeis)
    if (error) return { updated: false, error, conflicts }
  }

  let savedRows = []
  if (safeToInsert.length > 0) {
    const rows = safeToInsert.map(imei => ({
      customer_id: customerId,
      imei,
      device_type: deviceType,
    }))
    const { data, error } = await supabase
      .from("customer_devices")
      .insert(rows)
      .select()
    if (error) return { updated: false, error, conflicts }
    savedRows = data || rows
  }

  const removeImeis = new Set([...staleImeis, ...safeToInsert])
  const mergeRows = old => (
    Array.isArray(old)
      ? [...old.filter(r => !removeImeis.has(compactCode(r.imei))), ...savedRows]
      : savedRows
  )
  setCustomerDevices?.(mergeRows)
  queryClient?.setQueryData?.(["bf", "customer_devices"], mergeRows)
  return { updated: true, imei_codes: [...existingImeis].filter(i => nextSet.has(i)).concat(safeToInsert), conflicts }
}
