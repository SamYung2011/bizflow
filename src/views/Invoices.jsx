import React, { useState, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { isNonWarrantyItem } from '../lib/warranty.js'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'
import { Icon } from '../components/Icon.jsx'
import InvoiceEditModal from '../components/InvoiceEditModal.jsx'
import { fmtInvNum, invoiceSource, formatNotes } from '../lib/invoiceHelpers.js'
import { deriveShippingStatus, isShippingTrackable, isProblematicShipping } from '../lib/shippingHelpers.js'
import { appendCustomerImeiCodes, collectImeiCodesFromItems, collectInvalidImeiCodesFromItems, isDcAdaptorProLineItem } from '../lib/imei.js'

// 多值字段拆分（與 App.jsx 內定義同步）
const splitMulti = v => String(v || "").split(/\n+/).map(s => s.trim()).filter(Boolean)

// 發票明細行的空白模板 —— id 用 randomUUID 確保 React key 穩定
function mkItem(warehouseId = null) {
  const id = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return { id, name: "", qty: 1, price: 0, warehouse_id: warehouseId }
}

export default function InvoicesView({
  // 共享數據 / 派生
  search, setSearch,
  // App.jsx 留著的工具與 handler
  getCustomer,
  getPossibleDupId,
  handleMarkPaid,
  openPrintChooser,
  enterPrintFlow,
  handleUpgradePhysical,
  Badge,
}) {
  const { t } = useT()
  const {
    invoices, setInvoices,
    customers,
    customerDevices,
    setCustomerDevices,
    products,
    lineItemAliases,
    inventory, setInventory,
    warehouses,
    employees,
    canShip,
    customerGroups,
  } = useAppContext()
  const queryClient = useQueryClient()

  // ── view-local state（從 App.jsx 搬入）──────────────────────
  const [showNewInvoice, setShowNewInvoice] = useState(false)
  const [invoiceGenerated, setInvoiceGenerated] = useState(false)
  const [saving, setSaving] = useState(false)

  // 物流發貨 modal
  const [shippingInvoice, setShippingInvoice] = useState(null)
  const [shippingNumber, setShippingNumber] = useState("")
  const [shippingMethod, setShippingMethod] = useState("sf")
  const [shippingBusy, setShippingBusy] = useState(false)

  // 物流軌跡查看 modal
  const [trackingInvoice, setTrackingInvoice] = useState(null)
  const [trackingEvents, setTrackingEvents] = useState([])
  const [trackingRefreshing, setTrackingRefreshing] = useState(false)

  const [shippingFilter, setShippingFilter] = useState("all")
  const [visibleInvoices, setVisibleInvoices] = useState(30)

  const [editingInvoice, setEditingInvoice] = useState(null)

  // 新建發票 modal
  const [newInvoice, setNewInvoice] = useState({
    customerId: "", salespersonId: "", items: [mkItem()], notes: "", warranty: false,
    deposit: { enabled: false, amount: 0 },
    discount: { enabled: false, amount: 0 },
    surcharge: { enabled: false, amount: 0 },
    fieldOverrides: {},
  })
  const [customerQuery, setCustomerQuery] = useState("")
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const [productPickerOpenId, setProductPickerOpenId] = useState(null)

  // mount 時消費 sessionStorage 中轉的初始 filter（從 dashboard goShipping 來）
  useEffect(() => {
    const k = sessionStorage.getItem('invoices.initialShippingFilter')
    if (k) {
      setShippingFilter(k)
      sessionStorage.removeItem('invoices.initialShippingFilter')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // PRINT_FIELD_DEFS（與 App.jsx 同步）
  const PRINT_FIELD_DEFS = [
    { key: "name", label: t("姓名"), arr: "allNames" },
    { key: "phone", label: t("香港電話"), arr: "allPhones" },
    { key: "phone_mainland", label: t("內地電話"), arr: "allPhoneMainlands" },
    { key: "email", label: t("郵箱"), arr: "allEmails" },
    { key: "address", label: t("地址"), arr: "allAddresses" },
    { key: "car_make", label: t("車品牌"), arr: "allCarMakes" },
    { key: "car_model", label: t("車型"), arr: "allCarModels" },
  ]

  // 發票頁過濾：按搜索關鍵字 (發票號 / 客戶名 / 備註 / 順豐單號)
  const filteredInvoices = useMemo(() => {
    const q = (search || "").toLowerCase()
    let base = !q ? invoices : invoices.filter(inv => {
      const c = customers.find(x => x.id === inv.customer_id)
      return String(inv.invoice_number || "").toLowerCase().includes(q)
        || (c?.name || "").toLowerCase().includes(q)
        || (inv.notes || "").toLowerCase().includes(q)
        || (inv.tracking_number || "").toLowerCase().includes(q)
    })
    if (shippingFilter !== "all") {
      base = base.filter(inv => {
        const ss = deriveShippingStatus(inv)
        if (shippingFilter === "pending")    return ss === '待發貨' && isShippingTrackable(inv)
        if (shippingFilter === "in_transit") return ['已發貨','在途','派送中'].includes(ss)
        if (shippingFilter === "exception")  return isProblematicShipping(inv) // 異常 OR 超期未簽（>14 天）
        if (shippingFilter === "delivered")  return ss === '已簽收'
        return true
      })
    }
    return [...base].sort((a, b) => {
      const da = a.date || "", db = b.date || ""
      if (da !== db) return db.localeCompare(da)
      return String(b.created_at || "").localeCompare(String(a.created_at || ""))
    })
  }, [invoices, customers, search, shippingFilter])

  // 寫 invoice items 前把當前 product.warranty_months 快照進每條 item
  function attachWarrantySnapshot(items) {
    return items.map(it => {
      if (it == null) return it
      if (it.warranty_months != null) return it
      if (isNonWarrantyItem(it.name)) return it
      const prod = products.find(p => p.name === it.name)
      if (!prod || !prod.warranty_months) return it
      return { ...it, warranty_months: Number(prod.warranty_months) }
    })
  }

  // 額外費用合計（新建發票用）
  const extrasTotal =
    (newInvoice.deposit?.enabled ? (Number(newInvoice.deposit.amount) || 0) : 0) +
    (newInvoice.surcharge?.enabled ? (Number(newInvoice.surcharge.amount) || 0) : 0) -
    (newInvoice.discount?.enabled ? (Number(newInvoice.discount.amount) || 0) : 0)
  const invoiceTotal = newInvoice.items.reduce((sum, item) => sum + (item.price * item.qty || 0), 0) + extrasTotal

  // 關閉新建發票彈窗 → 一次清掉所有殘留
  function closeNewInvoice() {
    setShowNewInvoice(false)
    setNewInvoice({
      customerId: "", salespersonId: "", items: [mkItem()], notes: "", warranty: false,
      deposit: { enabled: false, amount: 0 },
      discount: { enabled: false, amount: 0 },
      surcharge: { enabled: false, amount: 0 },
      fieldOverrides: {},
    })
    setCustomerQuery("")
    setCustomerDropdownOpen(false)
    setProductPickerOpenId(null)
  }

  async function handleGenerateInvoice() {
    setSaving(true)
    const invNumber = `${Date.now()}`.slice(-6)
    const finalItems = attachWarrantySnapshot([...newInvoice.items])
    if (newInvoice.deposit?.enabled && Number(newInvoice.deposit.amount)) {
      finalItems.push({ id: mkItem().id, name: "押金", qty: 1, price: Number(newInvoice.deposit.amount) })
    }
    if (newInvoice.surcharge?.enabled && Number(newInvoice.surcharge.amount)) {
      finalItems.push({ id: mkItem().id, name: "手續費", qty: 1, price: Number(newInvoice.surcharge.amount) })
    }
    if (newInvoice.discount?.enabled && Number(newInvoice.discount.amount)) {
      finalItems.push({ id: mkItem().id, name: "優惠", qty: 1, price: -Number(newInvoice.discount.amount) })
    }
    const invalidImei = collectInvalidImeiCodesFromItems(finalItems, { products, lineItemAliases })
    if (invalidImei.length > 0) {
      alert(`${t("IMEI 格式不正確")}：${invalidImei.slice(0, 3).join(", ")}\n${t("IMEI 必須為 15 位數字")}`)
      setSaving(false)
      return
    }
    const { data, error } = await supabase.from("invoices").insert([{
      invoice_number: invNumber,
      customer_id: newInvoice.customerId || null,
      salesperson_id: newInvoice.salespersonId || null,
      date: new Date().toISOString().slice(0, 10),
      items: finalItems,
      total: invoiceTotal,
      status: "Unpaid",
      notes: newInvoice.notes,
    }]).select()
    if (!error && data) {
      setInvoices(prev => [data[0], ...prev])
      queryClient.setQueryData(["bf", "invoices"], (old) => Array.isArray(old) ? [data[0], ...old] : [data[0]])
      setInvoiceGenerated(true)
      const customer = getCustomer(newInvoice.customerId)
      const gid = customerGroups.idToGroup.get(newInvoice.customerId)
      const virtual = gid ? customerGroups.virtualCustomers.find(v => v.id === gid) : null
      const effective = { ...(virtual || customer), ...(newInvoice.fieldOverrides || {}) }
      enterPrintFlow(data[0], effective, finalItems, products)

      const imeiSync = await appendCustomerImeiCodes({
        supabase,
        queryClient,
        customerDevices,
        setCustomerDevices,
        customerId: newInvoice.customerId,
        imeiCodes: collectImeiCodesFromItems(finalItems, { products, lineItemAliases }),
      })
      if (imeiSync.error) {
        alert(`${t("發票已生成")} (#${data[0].invoice_number})，${t("但 IMEI 未能同步到客戶資料")}：${imeiSync.error.message}`)
      }
      if (Array.isArray(imeiSync.conflicts) && imeiSync.conflicts.length > 0) {
        alert(`${t("以下 IMEI 已歸屬其他客戶，未掛到當前客戶")}：\n${imeiSync.conflicts.map(c => c.imei).join("\n")}`)
      }

      // Auto-create warranty: update inventory items with warranty_end dates
      const invoiceDate = new Date()
      for (const item of newInvoice.items) {
        const matchedProduct = products.find(p => p.name === item.name)
        if (matchedProduct && matchedProduct.warranty_months) {
          const warrantyEnd = new Date(invoiceDate)
          warrantyEnd.setMonth(warrantyEnd.getMonth() + matchedProduct.warranty_months)
          const warrantyEndStr = warrantyEnd.toISOString().slice(0, 10)
          const matchingInventory = inventory.filter(
            inv => inv.product_id === matchedProduct.id && inv.status === "In Stock"
          )
          for (const invItem of matchingInventory.slice(0, item.qty)) {
            const { error: invErr } = await supabase.from("inventory").update({
              status: "Sold",
              customer_id: newInvoice.customerId || null,
              sold_date: invoiceDate.toISOString().slice(0, 10),
              warranty_end: warrantyEndStr,
              invoice_id: data[0].id,
            }).eq("id", invItem.id)
            if (invErr) {
              console.error(`庫存更新失敗 (item ${invItem.id}):`, invErr)
              alert(`${t("發票已生成")} (#${data[0].invoice_number})，${t("但部分庫存更新失敗")}：${invErr.message}\n${t("請在庫存頁手動核對。")}`)
              continue
            }
            setInventory(prev => prev.map(i =>
              i.id === invItem.id ? { ...i, status: "Sold", customer_id: newInvoice.customerId || null, sold_date: invoiceDate.toISOString().slice(0, 10), warranty_end: warrantyEndStr, invoice_id: data[0].id } : i
            ))
          }
        }
      }

      setTimeout(() => {
        setInvoiceGenerated(false)
        closeNewInvoice()
      }, 2000)
    } else if (error) {
      alert(`${t("發票生成失敗")}：${error.message}`)
    }
    setSaving(false)
  }

  // 打開編輯發票 modal（modal 內部會根據 invoice prop 自己初始化編輯態）
  function openEditInvoice(inv) {
    setEditingInvoice(inv)
  }

  // ── 物流發貨 handlers ─────────────────────────────────────
  function openShippingModal(inv) {
    if (!canShip) { alert(t("您沒有發貨權限。請聯繫管理員。")); return }
    setShippingInvoice(inv)
    setShippingNumber(inv.tracking_number || "")
    setShippingMethod(inv.carrier === "self_pickup" ? "self_pickup" : "sf")
  }
  async function submitShipping() {
    if (!shippingInvoice) return
    setShippingBusy(true)
    try {
      let updates
      if (shippingMethod === "self_pickup") {
        const now = new Date().toISOString()
        updates = {
          carrier: "self_pickup",
          tracking_number: null,
          shipping_status: "已簽收",
          shipped_at: now,
          delivered_at: now,
        }
      } else {
        const num = (shippingNumber || "").trim()
        if (!num) { alert(t("請填寫順豐單號")); setShippingBusy(false); return }
        if (!/^[A-Za-z0-9]{6,}$/.test(num)) {
          if (!window.confirm(t("單號格式可能異常，仍要保存嗎？"))) { setShippingBusy(false); return }
        }
        updates = {
          tracking_number: num,
          carrier: "SF HK",
        }
      }
      const { error } = await supabase.from("invoices").update(updates).eq("id", shippingInvoice.id)
      if (error) { alert(`${t("發貨保存失敗")}：${error.message}`); return }
      const { data: fresh } = await supabase.from("invoices").select("*").eq("id", shippingInvoice.id).maybeSingle()
      const merged = (i) => ({ ...i, ...(fresh || updates) })
      setInvoices(prev => prev.map(i => i.id === shippingInvoice.id ? merged(i) : i))
      queryClient.setQueryData(["bf", "invoices"], (old) => Array.isArray(old) ? old.map(i => i.id === shippingInvoice.id ? merged(i) : i) : old)
      setShippingInvoice(null)
      setShippingNumber("")
    } finally {
      setShippingBusy(false)
    }
  }
  async function openTrackingModal(inv) {
    setTrackingInvoice(inv)
    setTrackingEvents([])
    const { data, error } = await supabase
      .from("shipment_events")
      .select("*")
      .eq("invoice_id", inv.id)
      .order("event_at", { ascending: false })
    if (!error) setTrackingEvents(data || [])
  }
  async function refreshTracking() {
    if (!trackingInvoice) return
    setTrackingRefreshing(true)
    try {
      const { data: { session: s } } = await supabase.auth.getSession()
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/track-shipments`
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${s?.access_token}` },
        body: JSON.stringify({ invoice_id: trackingInvoice.id }),
      })
      if (!resp.ok) {
        alert(`${t("刷新失敗")}：${resp.status}（${t("可能順豐 API 還未配置")}）`)
        return
      }
      const { data: events } = await supabase.from("shipment_events").select("*").eq("invoice_id", trackingInvoice.id).order("event_at", { ascending: false })
      setTrackingEvents(events || [])
      const { data: inv } = await supabase.from("invoices").select("*").eq("id", trackingInvoice.id).maybeSingle()
      if (inv) {
        setTrackingInvoice(inv)
        setInvoices(prev => prev.map(i => i.id === inv.id ? inv : i))
        queryClient.setQueryData(["bf", "invoices"], (old) => Array.isArray(old) ? old.map(i => i.id === inv.id ? inv : i) : old)
      }
    } catch (e) {
      alert(`${t("刷新失敗")}：${e.message}`)
    } finally {
      setTrackingRefreshing(false)
    }
  }
  async function handleMarkShippingException() {
    if (!trackingInvoice) return
    if (!window.confirm(t("標為「異常」？"))) return
    const { error } = await supabase.from("invoices").update({ shipping_status: "異常" }).eq("id", trackingInvoice.id)
    if (error) { alert(`${t("操作失敗")}：${error.message}`); return }
    setInvoices(prev => prev.map(i => i.id === trackingInvoice.id ? { ...i, shipping_status: "異常" } : i))
    queryClient.setQueryData(["bf", "invoices"], (old) => Array.isArray(old) ? old.map(i => i.id === trackingInvoice.id ? { ...i, shipping_status: "異常" } : i) : old)
    setTrackingInvoice(prev => prev ? { ...prev, shipping_status: "異常" } : prev)
  }

  async function handleDeleteInvoice(inv) {
    const cust = customers.find(c => c.id === inv.customer_id)
    const custLine = cust ? (cust.name || t("(無名)")) + (cust.phone ? ` · ${cust.phone}` : "") : t("(無客戶)")
    let itemsArr = inv.items
    if (typeof itemsArr === "string") { try { itemsArr = JSON.parse(itemsArr) } catch { itemsArr = [] } }
    if (!Array.isArray(itemsArr)) itemsArr = []
    const itemsLine = itemsArr.length > 0
      ? itemsArr.map(it => `  • ${it.name || t("(未命名)")} × ${it.qty || 1}`).join("\n")
      : "  " + t("(無明細)")

    // 1. 查 SKU 庫存扣減記錄（新庫存系統：inventory_movements.type='sale'）
    //    delta 為負數，取絕對值聚合後 upsert 回 inventory_stock
    const { data: saleMovs, error: movFetchErr } = await supabase
      .from("inventory_movements")
      .select("id, product_id, warehouse_id, delta")
      .eq("invoice_id", inv.id)
      .eq("type", "sale")
    if (movFetchErr) { alert(`${t("查詢扣庫存記錄失敗")}：${movFetchErr.message}`); return }
    const stockReturns = new Map() // key: `${product_id}|${warehouse_id}` → qty
    if (Array.isArray(saleMovs)) {
      for (const m of saleMovs) {
        if (!m.product_id || !m.warehouse_id) continue
        const returnQty = -Number(m.delta || 0)
        if (returnQty <= 0) continue
        const k = `${m.product_id}|${m.warehouse_id}`
        stockReturns.set(k, (stockReturns.get(k) || 0) + returnQty)
      }
    }

    // 2. 查老 inventory（IMEI 序號制）
    const { data: relatedInv, error: fetchErr } = await supabase
      .from("inventory").select("id").eq("invoice_id", inv.id)
    if (fetchErr) { alert(`${t("查詢關聯庫存失敗")}：${fetchErr.message}`); return }

    // 3. 拼 confirm 文案：根據實際涉及哪些庫存動態顯示
    const stockMsgParts = []
    if (stockReturns.size > 0) stockMsgParts.push(`${t("將返還 SKU 庫存")} ${stockReturns.size} ${t("項")}`)
    if (relatedInv && relatedInv.length > 0) stockMsgParts.push(`${t("將還原序號庫存")} ${relatedInv.length} ${t("件")}`)
    const stockMsg = stockMsgParts.length > 0
      ? `\n${stockMsgParts.join(t("、"))}，${t("不可撤銷。")}`
      : `\n${t("此發票未關聯庫存記錄，可直接刪除。")}`

    const msg =
      `⚠️ ${t("確認刪除以下發票？")}\n\n` +
      `${t("發票號")}：DC${String(inv.invoice_number || inv.id).replace(/^DC/i, "")}\n` +
      `${t("客戶")}：${custLine}\n` +
      `${t("日期")}：${inv.date || "-"}\n` +
      `${t("金額")}：HKD$${inv.total || 0}\n` +
      `${t("狀態")}：${inv.status || "-"}\n` +
      `${t("明細")}：\n${itemsLine}\n` +
      stockMsg
    const confirmed = window.confirm(msg)
    if (!confirmed) return

    // 4. 返還 SKU 庫存：先 upsert inventory_stock，再寫一筆 sale_reverse movement 留痕
    for (const [k, qty] of stockReturns) {
      const [product_id, warehouse_id] = k.split("|")
      const { data: stockRow, error: stockErr } = await supabase
        .from("inventory_stock")
        .select("qty")
        .eq("product_id", product_id)
        .eq("warehouse_id", warehouse_id)
        .maybeSingle()
      if (stockErr) { alert(`${t("返還 SKU 庫存失敗")}：${stockErr.message}`); return }
      const current = Number(stockRow?.qty || 0)
      const { error: upsertErr } = await supabase.from("inventory_stock").upsert({
        product_id,
        warehouse_id,
        qty: current + qty,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'product_id,warehouse_id' })
      if (upsertErr) { alert(`${t("返還 SKU 庫存失敗")}：${upsertErr.message}`); return }
      await supabase.from("inventory_movements").insert({
        product_id,
        warehouse_id,
        delta: qty,
        type: 'sale_reverse',
        reason: `${t("發票")} #${inv.invoice_number || inv.id} ${t("刪除返還")}`,
        invoice_id: inv.id,
      })
    }

    // 5. 還原老 inventory（IMEI 序號制）
    if (relatedInv && relatedInv.length > 0) {
      const { error: restoreErr } = await supabase.from("inventory")
        .update({ status: "In Stock", customer_id: null, sold_date: null, warranty_end: null, invoice_id: null })
        .eq("invoice_id", inv.id)
      if (restoreErr) { alert(`${t("還原庫存失敗")}：${restoreErr.message}`); return }
    }

    // 6. 刪發票（FK：inventory_movements.invoice_id SET NULL / stock_deduction_audit CASCADE）
    const { error: delErr } = await supabase.from("invoices").delete().eq("id", inv.id)
    if (delErr) { alert(`${t("刪除發票失敗")}：${delErr.message}`); return }

    // 7. 更新 local state
    setInvoices(prev => prev.filter(i => i.id !== inv.id))
    if (relatedInv && relatedInv.length > 0) {
      const ids = new Set(relatedInv.map(r => r.id))
      setInventory(prev => prev.map(i => ids.has(i.id)
        ? { ...i, status: "In Stock", customer_id: null, sold_date: null, warranty_end: null, invoice_id: null }
        : i))
    }
  }

  return (
    <>
      {/* INVOICES LIST */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{t("發票")}</h1>
            <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>{t("共")} {invoices.length} {t("張發票")}</p>
          </div>
          <button onClick={() => setShowNewInvoice(true)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
            <Icon name="plus" size={16} /> {t("新建發票")}
          </button>
        </div>

        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="search" size={15} />
          <input placeholder={t("搜尋發票 / 順豐單號...")} value={search} onChange={e => { setSearch(e.target.value); setVisibleInvoices(30); }} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
        </div>

        {/* 物流狀態 filter */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            { k: "all",        label: t("全部"),       color: "#555" },
            { k: "pending",    label: t("待發貨"),     color: "#888" },
            { k: "in_transit", label: t("運送中"),     color: "#6382ff" },
            { k: "exception",  label: t("異常"),       color: "#d14343" },
            { k: "delivered",  label: t("已簽收"),     color: "#22c55e" },
          ].map(b => (
            <button key={b.k} onClick={() => { setShippingFilter(b.k); setVisibleInvoices(30); }}
              style={{ padding: "6px 14px", borderRadius: 18, border: shippingFilter === b.k ? `2px solid ${b.color}` : "1px solid #e0e0e0", background: shippingFilter === b.k ? b.color + "18" : "#fff", color: shippingFilter === b.k ? b.color : "#555", fontSize: 12, fontWeight: shippingFilter === b.k ? 700 : 500, cursor: "pointer" }}>
              {b.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filteredInvoices.slice(0, visibleInvoices).map(inv => {
            const c = getCustomer(inv.customer_id)
            return (
              <div key={inv.id} style={{ background: "#fff", borderRadius: 14, padding: "18px 22px", border: "1px solid #f0f0f0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", alignItems: "center", gap: 18 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {fmtInvNum(inv)}
                    {(() => { const s = invoiceSource(inv); return <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: "2px 7px", borderRadius: 6 }}>{t(s.key)}</span>; })()}
                    {inv.salesperson_id && (() => {
                      const sp = employees.find(e => e.id === inv.salesperson_id)
                      if (!sp) return null
                      return <span title={t("負責銷售")} style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", background: "#ede9fe", padding: "2px 7px", borderRadius: 6 }}>{t("銷售")}: {sp.name}</span>
                    })()}
                    {getPossibleDupId(inv) && (
                      <span title={t("此發票疑似與另一張發票重複（2 天內 / 同 email / 同 phone / 同產品），標 Paid 前請核對")} style={{ fontSize: 10, fontWeight: 700, color: "#b91c1c", background: "#fee2e2", padding: "2px 7px", borderRadius: 6 }}>⚠ {t("疑似重複")}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{(c?.phone || c?.phone_mainland) ? `${c.phone || c.phone_mainland} · ` : ""}{c?.name || "—"} · {inv.date || t("日期未知")} · {formatNotes(inv.notes)}</div>
                  {Array.isArray(inv.items) && inv.items.slice(0, 2).map((item, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#999" }}>{item.name} ×{item.qty}</div>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  {(inv.status || "").trim().toLowerCase() !== "paid" && (
                    <button onClick={() => handleMarkPaid(inv)} title={t("標記已付款")} style={{ fontSize: 12, background: "#e8f5e9", color: "#22c55e", border: "1px solid #c8e6c9", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                      ✓ {t("標記已付款")}
                    </button>
                  )}
                  <div style={{ fontSize: 18, fontWeight: 800 }}>HKD${inv.total}</div>
                  <Badge status={inv.status} />
                  {(() => {
                    const ss = deriveShippingStatus(inv)
                    const isSelfPickup = inv.carrier === "self_pickup"
                    const map = {
                      '待發貨': { color: '#888',    bg: '#f5f5f5', label: t('待發貨') },
                      '已發貨': { color: '#6382ff', bg: '#eef2ff', label: t('已發貨') },
                      '在途':   { color: '#b45309', bg: '#fef3c7', label: t('在途') },
                      '派送中': { color: '#c2410c', bg: '#ffedd5', label: t('派送中') },
                      '已簽收': { color: '#16a34a', bg: '#dcfce7', label: t('已簽收') },
                      '異常':   { color: '#b91c1c', bg: '#fee2e2', label: t('異常') },
                    }
                    const selfPickupTag = { color: '#16a34a', bg: '#dcfce7', label: t('已自提') }
                    const m = isSelfPickup ? selfPickupTag : (map[ss] || map['待發貨'])
                    const isPending = ss === '待發貨' && !isSelfPickup
                    const onClick = isPending
                      ? (canShip ? () => openShippingModal(inv) : null)
                      : () => openTrackingModal(inv)
                    const title = isPending
                      ? (canShip ? t("點擊發貨") : t("待發貨（無發貨權限）"))
                      : (isSelfPickup ? t("店面自提") : `${t("順豐")} ${inv.tracking_number || ""}`)
                    return (
                      <button onClick={onClick} disabled={!onClick} title={title}
                        style={{ background: m.bg, color: m.color, border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: onClick ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}>
                        {m.label}
                      </button>
                    )
                  })()}
                  <button onClick={() => openEditInvoice(inv)} title={t("編輯發票")} style={{ fontSize: 12, background: "#fff8e1", color: "#f59e0b", border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontWeight: 700 }}>
                    ✏️
                  </button>
                  <button onClick={() => openPrintChooser(inv, c, inv.items || [], products)} style={{ fontSize: 12, background: "#f0f4ff", color: "#6382ff", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                    <Icon name="print" size={13} /> {t("列印")}
                  </button>
                  <button onClick={() => handleDeleteInvoice(inv)} title={t("刪除發票")} style={{ fontSize: 12, background: "#fff0f0", color: "#d14343", border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                    🗑️
                  </button>
                </div>
              </div>
            )
          })}
          {visibleInvoices < filteredInvoices.length && (
            <button onClick={() => setVisibleInvoices(v => v + 30)} style={{ display: "block", margin: "12px auto", padding: "10px 28px", background: "#f0f4ff", color: "#6382ff", border: "1px solid #e0e8ff", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
              {t("載入更多")}（{filteredInvoices.length - visibleInvoices} {t("項待載入")}）
            </button>
          )}
        </div>
      </div>

      {/* EDIT INVOICE MODAL —— 抽出為獨立組件，可被任何 view 直接調用 */}
      <InvoiceEditModal
        invoice={editingInvoice}
        onClose={() => setEditingInvoice(null)}
      />

      {/* NEW INVOICE MODAL */}
      {showNewInvoice && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: 560, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            {invoiceGenerated ? (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#e8f5e9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "#22c55e" }}><Icon name="check" size={36} /></div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{t("發票已生成！")}</div>
                <div style={{ color: "#888", marginTop: 8, fontSize: 14 }}>{t("PDF 已列印並儲存到資料庫")}</div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t("新建發票")}</h2>
                  <button onClick={closeNewInvoice} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>{t("客戶")}</label>
                  <div style={{ position: "relative" }}>
                    <input
                      value={customerQuery}
                      onChange={e => {
                        setCustomerQuery(e.target.value)
                        if (newInvoice.customerId) setNewInvoice({...newInvoice, customerId: "", fieldOverrides: {}})
                        setCustomerDropdownOpen(true)
                      }}
                      onFocus={() => setCustomerDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 150)}
                      placeholder={t("輸入客戶姓名 / 電話 / 郵箱 / 車型搜索...")}
                      style={{ width: "100%", padding: "10px 14px", paddingRight: newInvoice.customerId ? 38 : 14, borderRadius: 10, border: newInvoice.customerId ? "1px solid #6382ff" : "1px solid #e0e0e0", fontSize: 14, outline: "none", background: "#fff", boxSizing: "border-box" }}
                    />
                    {newInvoice.customerId && (
                      <button
                        onClick={() => { setNewInvoice({...newInvoice, customerId: "", fieldOverrides: {}}); setCustomerQuery(""); }}
                        style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "#f0f0f0", border: "none", borderRadius: "50%", width: 22, height: 22, cursor: "pointer", fontSize: 12, color: "#666", lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                      >×</button>
                    )}
                    {customerDropdownOpen && (() => {
                      const q = customerQuery.toLowerCase().trim()
                      const matched = customerGroups.virtualCustomers.filter(v => {
                        if ((!v.allNames || v.allNames.length === 0) && (!v.allPhones || v.allPhones.length === 0) && (!v.allEmails || v.allEmails.length === 0)) return false
                        if (!q) return true
                        const hit = (arr) => (arr || []).some(x => String(x).toLowerCase().includes(q))
                        return hit(v.allNames) || hit(v.allPhones) || hit(v.allEmails)
                          || splitMulti(v.car_make).some(x => x.toLowerCase().includes(q))
                          || splitMulti(v.car_model).some(x => x.toLowerCase().includes(q))
                      })
                      const top = matched.slice(0, 20)
                      return (
                        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, maxHeight: 260, overflowY: "auto", background: "#fff", border: "1px solid #e0e0e0", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.08)", zIndex: 100 }}>
                          {top.length === 0 ? (
                            <div style={{ padding: "12px 14px", fontSize: 13, color: "#999" }}>{t("沒有符合的客戶，檢查拼寫或去「客戶」頁新增")}</div>
                          ) : (
                            <>
                              {top.map(v => {
                                const merged = v.groupCids && v.groupCids.length > 1
                                const preview = [v.phone, v.email, splitMulti(v.car_make)[0], splitMulti(v.car_model)[0]].filter(Boolean).join(" · ")
                                return (
                                  <div
                                    key={v.id}
                                    onMouseDown={() => {
                                      const overrides = {}
                                      for (const def of PRINT_FIELD_DEFS) {
                                        const arrVals = def.arr && v[def.arr] ? v[def.arr] : []
                                        const singleVal = v[def.key]
                                        const sources = arrVals.length > 0 ? arrVals : (singleVal ? [singleVal] : [])
                                        const vals = [...new Set(sources.flatMap(s => splitMulti(s)))]
                                        if (vals.length > 0) overrides[def.key] = vals[0]
                                      }
                                      setNewInvoice({ ...newInvoice, customerId: v.id, fieldOverrides: overrides })
                                      setCustomerQuery([v.name, v.phone].filter(Boolean).join(" · "))
                                      setCustomerDropdownOpen(false)
                                    }}
                                    style={{ padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid #f5f5f5" }}
                                    onMouseEnter={e => e.currentTarget.style.background = "#f8f9ff"}
                                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                  >
                                    <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                                      {v.name || t("(未命名客戶)")}
                                      {merged && <span style={{ fontSize: 10, color: "#6382ff", background: "#eef2ff", borderRadius: 20, padding: "1px 8px", fontWeight: 700 }}>{t("已合併")} {v.groupCids.length}</span>}
                                    </div>
                                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{preview || "—"}</div>
                                  </div>
                                )
                              })}
                              {matched.length > 20 && (
                                <div style={{ padding: "8px 14px", fontSize: 11, color: "#999", background: "#fafafa", textAlign: "center" }}>
                                  {t("還有")} {matched.length - 20} {t("位客戶，繼續輸入縮小範圍")}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                </div>
                {/* 負責銷售下拉（可空 = 無歸屬不算佣金） */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>{t("負責銷售")}</label>
                  <select value={newInvoice.salespersonId || ""} onChange={e => setNewInvoice({ ...newInvoice, salespersonId: e.target.value })}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", background: "#fff", boxSizing: "border-box" }}>
                    <option value="">{t("（無）")}</option>
                    {employees.filter(e => e.role === '銷售' && e.active !== false).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </div>
                {newInvoice.customerId && (() => {
                  const gid = customerGroups.idToGroup.get(newInvoice.customerId)
                  const virtual = gid ? customerGroups.virtualCustomers.find(v => v.id === gid) : null
                  if (!virtual) return null
                  const upgradeable = (virtual.groupCids || []).filter(id => id !== virtual.id).length
                  if (upgradeable === 0) return null
                  return (
                    <div style={{ marginBottom: 14, padding: "12px 14px", background: "#eef4ff", borderRadius: 10, border: "1px solid #c7d7ff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <div style={{ fontSize: 13, color: "#2b4eb5", lineHeight: 1.4 }}>
                        <div style={{ fontWeight: 700, marginBottom: 2 }}>{t("偵測到")} {upgradeable} {t("條疑似重複客戶")}</div>
                        <div style={{ fontSize: 11, color: "#5b75b8" }}>{t("虛擬合併中（資料命中 3+ 字段），可一鍵物理合併到主記錄")}</div>
                      </div>
                      <button
                        onClick={() => handleUpgradePhysical(virtual)}
                        style={{ background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
                      >{t("合併並繼續")}</button>
                    </div>
                  )
                })()}
                {newInvoice.customerId && (() => {
                  const gid = customerGroups.idToGroup.get(newInvoice.customerId)
                  const virtual = gid ? customerGroups.virtualCustomers.find(v => v.id === gid) : null
                  if (!virtual) return null
                  const multi = {}
                  for (const def of PRINT_FIELD_DEFS) {
                    const arrVals = def.arr && virtual[def.arr] ? virtual[def.arr] : []
                    const singleVal = virtual[def.key]
                    const sources = arrVals.length > 0 ? arrVals : (singleVal ? [singleVal] : [])
                    const vals = [...new Set(sources.flatMap(s => splitMulti(s)))]
                    if (vals.length > 1) multi[def.key] = vals
                  }
                  if (Object.keys(multi).length === 0) return null
                  const labels = Object.fromEntries(PRINT_FIELD_DEFS.map(d => [d.key, d.label]))
                  return (
                    <div style={{ marginBottom: 14, padding: "14px 16px", background: "#fff9ec", borderRadius: 12, border: "1px solid #f4dca4" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#8a6900", marginBottom: 10 }}>{t("此客戶有多個資料，請選擇本次發票使用的")}</div>
                      {Object.keys(multi).map(field => (
                        <div key={field} style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 6 }}>{labels[field] || field}</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {multi[field].map((v, idx) => {
                              const checked = (newInvoice.fieldOverrides || {})[field] === v
                              return (
                                <label key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 10px", border: "1px solid " + (checked ? "#6382ff" : "#e8dfb6"), background: checked ? "#f0f4ff" : "#fff", borderRadius: 8, cursor: "pointer" }}>
                                  <input type="radio" name={"inv-fc-"+field} checked={checked} onChange={() => setNewInvoice(prev => ({ ...prev, fieldOverrides: { ...(prev.fieldOverrides || {}), [field]: v } }))} style={{ marginTop: 2 }} />
                                  <span style={{ fontSize: 13, color: "#111", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{v}</span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 8 }}>{t("商品項目")}</label>
                  {newInvoice.items.map((item, idx) => (
                    <React.Fragment key={item.id}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 56px 82px 72px auto", gap: 6, marginBottom: isDcAdaptorProLineItem(item, { products, lineItemAliases }) ? 6 : 8, alignItems: "start" }}>
                        <div style={{ position: "relative" }}>
                          <input
                            value={item.name}
                            onChange={e => { const items = [...newInvoice.items]; items[idx] = {...item, name: e.target.value}; setNewInvoice({...newInvoice, items}); }}
                            onFocus={() => setProductPickerOpenId(item.id)}
                            onBlur={() => setTimeout(() => setProductPickerOpenId(cur => cur === item.id ? null : cur), 150)}
                            placeholder={t("產品 / 服務（輸入關鍵字）")}
                            style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" }}
                          />
                          {productPickerOpenId === item.id && (() => {
                            const q = (item.name || "").toLowerCase().trim()
                            const parentIds = new Set(products.filter(x => x.parent_product_id).map(x => x.parent_product_id))
                            const matched = products.filter(p => {
                              if (!p.name) return false
                              if (p.category === '_archived') return false
                              if (parentIds.has(p.id)) return false
                              if (!q) return true
                              return p.name.toLowerCase().includes(q) || (p.code || "").toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q)
                            })
                            const top = matched.slice(0, 10)
                            if (top.length === 0) return null
                            return (
                              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 360, maxWidth: "calc(100vw - 80px)", maxHeight: 240, overflowY: "auto", background: "#fff", border: "1px solid #e0e0e0", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.08)", zIndex: 100 }}>
                                {top.map(p => (
                                  <div
                                    key={p.id}
                                    onMouseDown={() => {
                                      const items = [...newInvoice.items]
                                      items[idx] = {...item, name: p.name, price: Number(p.price) || item.price}
                                      setNewInvoice({...newInvoice, items})
                                      setProductPickerOpenId(null)
                                    }}
                                    style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f5f5f5" }}
                                    onMouseEnter={e => e.currentTarget.style.background = "#f8f9ff"}
                                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                  >
                                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                                      HK${p.price ?? "—"}{p.category ? ` · ${p.category}` : ""}{p.stock != null ? ` · ${t("庫存")} ${p.stock}` : ""}
                                    </div>
                                  </div>
                                ))}
                                {matched.length > 10 && (
                                  <div style={{ padding: "6px 12px", fontSize: 10, color: "#999", background: "#fafafa", textAlign: "center" }}>
                                    {t("還有")} {matched.length - 10} {t("個產品，繼續輸入縮小範圍")}
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                        <input type="number" min="1" value={item.qty} onChange={e => { const items = [...newInvoice.items]; items[idx].qty = parseInt(e.target.value) || 1; setNewInvoice({...newInvoice, items}); }} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", textAlign: "center" }} />
                        <input type="number" value={item.price} onChange={e => { const items = [...newInvoice.items]; items[idx].price = parseFloat(e.target.value) || 0; setNewInvoice({...newInvoice, items}); }} placeholder={t("價格")} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }} />
                        <select value={item.warehouse_id || ''} onChange={e => { const items = [...newInvoice.items]; items[idx] = {...item, warehouse_id: e.target.value || null}; setNewInvoice({...newInvoice, items}); }} title={t("扣庫存的倉庫（不顯示在發票/收據上）")} style={{ padding: "9px 6px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", background: "#fff" }}>
                          {warehouses.map(w => <option key={w.id} value={w.id}>{t(w.name.replace("分部", ""))}</option>)}
                        </select>
                        <button onClick={() => { const items = newInvoice.items.filter(i => i.id !== item.id); setNewInvoice({...newInvoice, items: items.length ? items : [mkItem(warehouses[0]?.id)]}); }} style={{ background: "#fce4ec", border: "none", borderRadius: 8, padding: "9px 10px", cursor: "pointer", color: "#e53935" }}><Icon name="x" size={13} /></button>
                      </div>
                      {isDcAdaptorProLineItem(item, { products, lineItemAliases }) && (
                        <div style={{ margin: "0 0 10px 0", paddingLeft: 0 }}>
                          <input
                            value={item.imei_code || ""}
                            onChange={e => { const items = [...newInvoice.items]; items[idx] = { ...item, imei_code: e.target.value }; setNewInvoice({ ...newInvoice, items }); }}
                            placeholder={t("IMEI 辨識碼")}
                            style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid #d8e0ff", background: "#f8faff", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                          />
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                  <button onClick={() => setNewInvoice({...newInvoice, items: [...newInvoice.items, mkItem(warehouses[0]?.id)]})} style={{ fontSize: 13, color: "#6382ff", background: "none", border: "1px dashed #6382ff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", width: "100%" }}>+ {t("新增項目")}</button>
                </div>
                <div style={{ marginBottom: 14, padding: "14px 16px", background: "#fafbff", borderRadius: 12, border: "1px solid #eef0fa" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#555", marginBottom: 10 }}>{t("額外費用（可選）")}</div>
                  {[
                    { key: "deposit", label: t("押金"), sign: "+", color: "#6382ff" },
                    { key: "discount", label: t("優惠"), sign: "−", color: "#d14343" },
                    { key: "surcharge", label: t("手續費"), sign: "+", color: "#f59e0b" },
                  ].map(({ key, label, sign, color }) => {
                    const v = newInvoice[key] || { enabled: false, amount: 0 }
                    return (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <input type="checkbox" id={`extra-${key}`} checked={v.enabled} onChange={e => setNewInvoice({ ...newInvoice, [key]: { ...v, enabled: e.target.checked } })} style={{ width: 16, height: 16, cursor: "pointer" }} />
                        <label htmlFor={`extra-${key}`} style={{ fontSize: 14, cursor: "pointer", minWidth: 70, fontWeight: 600 }}>
                          <span style={{ color, marginRight: 4 }}>{sign}</span>{label}
                        </label>
                        {v.enabled && (
                          <input type="number" min="0" value={v.amount || ""} onChange={e => setNewInvoice({ ...newInvoice, [key]: { ...v, amount: parseFloat(e.target.value) || 0 } })} placeholder={t("金額 HKD")} style={{ flex: 1, padding: "7px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }} />
                        )}
                      </div>
                    )
                  })}
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>{t("備註")}</label>
                  <input value={newInvoice.notes} onChange={e => setNewInvoice({...newInvoice, notes: e.target.value})} placeholder={t("例如 Shopify 訂單 #1055、WhatsApp 訂單...")} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#f0f4ff", borderRadius: 12, marginBottom: 20 }}>
                  <input type="checkbox" id="warranty" checked={newInvoice.warranty} onChange={e => setNewInvoice({...newInvoice, warranty: e.target.checked})} style={{ width: 16, height: 16, cursor: "pointer" }} />
                  <label htmlFor="warranty" style={{ fontSize: 14, cursor: "pointer", fontWeight: 600 }}>{t("客戶需要延長保修（+1 年）")}</label>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", background: "#1a1a2e", borderRadius: 12, marginBottom: 16 }}>
                  <span style={{ color: "#aaa", fontSize: 14 }}>{t("合計")}</span>
                  <span style={{ color: "#fff", fontSize: 24, fontWeight: 800 }}>HKD${invoiceTotal.toLocaleString()}</span>
                </div>
                <button onClick={handleGenerateInvoice} disabled={invoiceTotal === 0 || !newInvoice.customerId || saving} style={{ width: "100%", padding: 14, background: (invoiceTotal > 0 && newInvoice.customerId) ? "#6382ff" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 800, cursor: (invoiceTotal > 0 && newInvoice.customerId) ? "pointer" : "not-allowed" }}>
                  {saving ? t("生成中...") : !newInvoice.customerId ? t("請先選擇客戶") : t("生成發票並列印 PDF")}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* SHIPPING MODAL */}
      {shippingInvoice && (
        <div onClick={() => !shippingBusy && setShippingInvoice(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, width: 460, maxWidth: "90vw" }}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>{t("發貨")}</div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>{t("發票")} #{fmtInvNum(shippingInvoice)} · {getCustomer(shippingInvoice.customer_id)?.name || "—"}</div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 8, fontWeight: 600 }}>{t("發貨方式")}</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  { k: "sf",          label: t("順豐快遞") },
                  { k: "self_pickup", label: t("店面自提") },
                ].map(opt => {
                  const active = shippingMethod === opt.k
                  return (
                    <button key={opt.k} onClick={() => setShippingMethod(opt.k)}
                      style={{ flex: 1, padding: "10px 12px", border: active ? "2px solid #6382ff" : "1px solid #d0d0d0", background: active ? "#eef2ff" : "#fff", color: active ? "#6382ff" : "#666", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: active ? 700 : 500 }}>
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {shippingMethod === "sf" ? (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6, fontWeight: 600 }}>{t("順豐單號")}</div>
                <input
                  autoFocus
                  value={shippingNumber}
                  onChange={e => setShippingNumber(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !shippingBusy) submitShipping(); }}
                  placeholder={t("例如 SF1234567890")}
                  style={{ width: "100%", padding: "10px 14px", border: "1px solid #d0d0d0", borderRadius: 8, fontSize: 15, outline: "none", boxSizing: "border-box", letterSpacing: 1 }}
                />
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}>{t("保存後系統每 6 小時自動拉取軌跡更新狀態")}</div>
              </div>
            ) : (
              <div style={{ marginBottom: 20, padding: "14px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: "#666" }}>{t("客人當場取貨，保存後直接標為「已簽收」")}</div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShippingInvoice(null)} disabled={shippingBusy} style={{ flex: 1, padding: 11, background: "#f5f5f5", color: "#666", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: shippingBusy ? "not-allowed" : "pointer" }}>{t("取消")}</button>
              <button onClick={submitShipping} disabled={shippingBusy || (shippingMethod === "sf" && !shippingNumber.trim())} style={{ flex: 2, padding: 11, background: shippingBusy ? "#a8b8e8" : "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: (shippingBusy || (shippingMethod === "sf" && !shippingNumber.trim())) ? "not-allowed" : "pointer" }}>
                {shippingBusy ? t("保存中...") : (shippingMethod === "self_pickup" ? t("確認自提") : t("確認發貨"))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TRACKING MODAL */}
      {trackingInvoice && (() => {
        const isSelfPickup = trackingInvoice.carrier === "self_pickup"
        return (
        <div onClick={() => setTrackingInvoice(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, width: 560, maxWidth: "92vw", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>{isSelfPickup ? t("店面自提") : t("物流軌跡")}</div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 18 }}>{t("發票")} #{fmtInvNum(trackingInvoice)} · {getCustomer(trackingInvoice.customer_id)?.name || "—"}</div>

            {isSelfPickup ? (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#16a34a", marginBottom: 6 }}>{t("客人已當場簽收")}</div>
                {trackingInvoice.delivered_at && (
                  <div style={{ fontSize: 12, color: "#666" }}>{t("簽收時間")}：{new Date(trackingInvoice.delivered_at).toLocaleString()}</div>
                )}
              </div>
            ) : (
              <div style={{ background: "#f7f8fc", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ fontSize: 13, color: "#666" }}>{t("香港順豐")}</div>
                  <div style={{ fontSize: 12, color: "#888" }}>
                    {trackingInvoice.shipping_last_synced_at ? `${t("上次同步")}：${new Date(trackingInvoice.shipping_last_synced_at).toLocaleString()}` : t("尚未同步")}
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", letterSpacing: 1, display: "flex", alignItems: "center", gap: 8 }}>
                  {trackingInvoice.tracking_number}
                  <button onClick={() => navigator.clipboard.writeText(trackingInvoice.tracking_number)} style={{ background: "none", border: "1px solid #d0d0d0", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 11, color: "#666" }}>{t("複製")}</button>
                  <a href={`https://htm.sf-express.com/hk/tc/dynamic_function/waybill/#search/bill-number/${trackingInvoice.tracking_number}`} target="_blank" rel="noopener noreferrer" style={{ background: "none", border: "1px solid #d0d0d0", borderRadius: 6, padding: "2px 8px", textDecoration: "none", fontSize: 11, color: "#666" }}>{t("順豐網站")}</a>
                </div>
                <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700 }}>{t("狀態")}：{t(deriveShippingStatus(trackingInvoice))}</div>
              </div>
            )}

            {!isSelfPickup && (
              <div style={{ flex: 1, overflowY: "auto", borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
                {trackingEvents.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 30, color: "#999", fontSize: 13 }}>
                    {t("暫無軌跡，順豐 API 還未配置或單號剛填寫，6 小時內自動拉取")}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {trackingEvents.map((ev, idx) => (
                      <div key={ev.id} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                        <div style={{ flexShrink: 0, marginTop: 4 }}>
                          <div style={{ width: 10, height: 10, borderRadius: "50%", background: idx === 0 ? "#22c55e" : "#d0d0d0" }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: idx === 0 ? "#16a34a" : "#333" }}>{ev.description}</div>
                          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{ev.location || "—"}</div>
                          <div style={{ fontSize: 11, color: "#aaa", marginTop: 1 }}>{new Date(ev.event_at).toLocaleString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 16, paddingTop: 12, borderTop: "1px solid #f0f0f0" }}>
              <button onClick={() => setTrackingInvoice(null)} style={{ flex: 1, padding: 11, background: "#f5f5f5", color: "#666", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{t("關閉")}</button>
              {canShip && !isSelfPickup && (
                <>
                  <button onClick={handleMarkShippingException} style={{ padding: "11px 14px", background: "#fff0f0", color: "#d14343", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    {t("標為異常")}
                  </button>
                  <button onClick={() => { openShippingModal(trackingInvoice); setTrackingInvoice(null); }} style={{ padding: "11px 14px", background: "#fff8e1", color: "#f59e0b", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    {t("修改單號")}
                  </button>
                </>
              )}
              {canShip && isSelfPickup && (
                <button onClick={() => { openShippingModal(trackingInvoice); setTrackingInvoice(null); }} style={{ padding: "11px 14px", background: "#fff8e1", color: "#f59e0b", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  {t("改為快遞發貨")}
                </button>
              )}
              {!isSelfPickup && (
                <button onClick={refreshTracking} disabled={trackingRefreshing} style={{ flex: 1, padding: 11, background: trackingRefreshing ? "#a8b8e8" : "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: trackingRefreshing ? "not-allowed" : "pointer" }}>
                  {trackingRefreshing ? t("刷新中...") : t("立即刷新")}
                </button>
              )}
            </div>
          </div>
        </div>
        )
      })()}
    </>
  )
}
