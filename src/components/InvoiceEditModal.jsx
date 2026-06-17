import React, { useState, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'
import { Icon } from './Icon.jsx'
import { computeCommissionFor } from '../lib/commission.js'
import { appendCustomerImeiCodes, collectImeiCodesFromItems, collectInvalidImeiCodesFromItems, isDcAdaptorProLineItem } from '../lib/imei.js'
import { toastError } from '../lib/toast.js'
import { makeInvoiceItem as mkItem, attachWarrantySnapshot } from '../lib/invoiceItems.js'

/**
 * 編輯發票 Modal —— 可重用組件
 *
 * Props：
 *   invoice  : 要編輯的發票對象，null/undefined 時返回 null（不渲染）
 *   onClose  : 關閉按鈕 / 取消 / 點背景 / 保存成功後都調這個
 *   onSaved  : 可選，保存成功後通知調用方（用於更新自己的列表 UI）
 *
 * 組件內部自管 state；資料層直接從 useAppContext() 拿。
 */
export default function InvoiceEditModal({ invoice, onClose, onSaved }) {
  const { t } = useT()
  const {
    setInvoices,
    customerDevices,
    setCustomerDevices,
    products,
    warehouses,
    employees,
    lineItemAliases,
  } = useAppContext()
  const queryClient = useQueryClient()

  // ── 編輯態 state ──────────────────────────────────────────
  const [editInvItems, setEditInvItems] = useState([])
  const [editInvSalespersonId, setEditInvSalespersonId] = useState("")
  const [editInvTotalOverride, setEditInvTotalOverride] = useState("")
  const [editInvExtras, setEditInvExtras] = useState({
    deposit: { enabled: false, amount: 0 },
    discount: { enabled: false, amount: 0 },
    surcharge: { enabled: false, amount: 0 },
  })

  // invoice prop 變化時用 invoice 內容初始化內部 state
  useEffect(() => {
    if (!invoice) return
    const rawItems = Array.isArray(invoice.items) ? invoice.items : (() => { try { return JSON.parse(invoice.items || "[]") } catch { return [] } })()
    const extras = { deposit: { enabled: false, amount: 0 }, discount: { enabled: false, amount: 0 }, surcharge: { enabled: false, amount: 0 } }
    const normalItems = []
    for (const it of rawItems) {
      const name = (it.name || "").trim()
      const p = Number(it.price) || 0
      if (name === "押金") { extras.deposit = { enabled: true, amount: p }; continue }
      if (name === "優惠") { extras.discount = { enabled: true, amount: Math.abs(p) }; continue }
      if (name === "手續費") { extras.surcharge = { enabled: true, amount: p }; continue }
      normalItems.push({ id: it.id || mkItem().id, name, qty: Number(it.qty) || 1, price: p, warehouse_id: it.warehouse_id || null, imei_code: it.imei_code || "" })
    }
    setEditInvItems(normalItems.length > 0 ? normalItems : [mkItem()])
    setEditInvExtras(extras)
    setEditInvTotalOverride("")
    setEditInvSalespersonId(invoice.salesperson_id || "")
  }, [invoice])

  // ── 保存 ─────────────────────────────────────────────────
  async function handleSaveInvoice() {
    if (!invoice) return
    const cleanItems = attachWarrantySnapshot(editInvItems.filter(it => it.name || it.qty || it.price), products)
    const finalItems = [...cleanItems]
    if (editInvExtras.deposit?.enabled && Number(editInvExtras.deposit.amount)) {
      finalItems.push({ id: mkItem().id, name: "押金", qty: 1, price: Number(editInvExtras.deposit.amount) })
    }
    if (editInvExtras.surcharge?.enabled && Number(editInvExtras.surcharge.amount)) {
      finalItems.push({ id: mkItem().id, name: "手續費", qty: 1, price: Number(editInvExtras.surcharge.amount) })
    }
    if (editInvExtras.discount?.enabled && Number(editInvExtras.discount.amount)) {
      finalItems.push({ id: mkItem().id, name: "優惠", qty: 1, price: -Number(editInvExtras.discount.amount) })
    }
    const invalidImei = collectInvalidImeiCodesFromItems(finalItems, { products, lineItemAliases })
    if (invalidImei.length > 0) {
      alert(`${t("IMEI 格式不正確")}：${invalidImei.slice(0, 3).join(", ")}\n${t("IMEI 必須為 15 位數字")}`)
      return
    }
    const itemsSum = finalItems.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0)
    const finalTotal = editInvTotalOverride === "" ? itemsSum : (Number(editInvTotalOverride) || 0)
    const newSalespersonId = editInvSalespersonId || null
    const updates = { items: finalItems, total: finalTotal, salesperson_id: newSalespersonId }
    const isPaid = (invoice.status || '').trim().toLowerCase() === 'paid'
    if (isPaid) {
      updates.commission_amount = computeCommissionFor({ ...invoice, items: finalItems, salesperson_id: newSalespersonId }, newSalespersonId, { products, lineItemAliases })
    }
    const { error } = await supabase.from("invoices").update(updates).eq("id", invoice.id)
    if (error) { toastError(t("儲存失敗"), { detail: error }); return }
    const oldImeis = collectImeiCodesFromItems(invoice.items || [], { products, lineItemAliases })
    const newImeis = collectImeiCodesFromItems(finalItems, { products, lineItemAliases })
    const removedImeis = oldImeis.filter(i => !newImeis.includes(i))
    const imeiSync = await appendCustomerImeiCodes({
      supabase,
      queryClient,
      customerDevices,
      setCustomerDevices,
      customerId: invoice.customer_id,
      imeiCodes: newImeis,
    })
    if (imeiSync.error) {
      toastError(`${t("儲存修改已完成")}，${t("但 IMEI 未能同步到客戶資料")}`, { detail: imeiSync.error })
    }
    if (Array.isArray(imeiSync.conflicts) && imeiSync.conflicts.length > 0) {
      alert(`${t("以下 IMEI 已歸屬其他客戶，未掛到當前客戶")}：\n${imeiSync.conflicts.map(c => c.imei).join("\n")}`)
    }
    if (removedImeis.length > 0) {
      alert(`${t("以下 IMEI 已從本發票移除")}：\n${removedImeis.join("\n")}\n\n${t("若為 typo 修正而非客戶退貨，請到客戶資料頁手動移除舊 IMEI 設備記錄")}`)
    }
    const updatedInv = { ...invoice, ...updates }
    setInvoices(prev => prev.map(i => i.id === invoice.id ? { ...i, ...updates } : i))
    queryClient.setQueryData(["bf", "invoices"], (old) => Array.isArray(old) ? old.map(i => i.id === invoice.id ? { ...i, ...updates } : i) : old)
    if (typeof onSaved === 'function') onSaved(updatedInv)
    onClose()
  }

  // ── 派生 totals（useMemo 避免不必要重算） ───────────────────
  const editItemsSubtotal = useMemo(
    () => editInvItems.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0),
    [editInvItems]
  )
  const editExtrasTotal = useMemo(() => (
    (editInvExtras.deposit?.enabled ? (Number(editInvExtras.deposit.amount) || 0) : 0) +
    (editInvExtras.surcharge?.enabled ? (Number(editInvExtras.surcharge.amount) || 0) : 0) -
    (editInvExtras.discount?.enabled ? (Number(editInvExtras.discount.amount) || 0) : 0)
  ), [editInvExtras])
  const editItemsSum = editItemsSubtotal + editExtrasTotal
  const editFinalTotal = editInvTotalOverride === "" ? editItemsSum : (Number(editInvTotalOverride) || 0)

  const updateEditInvItem = (idx, patch) => {
    setEditInvItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }

  const addEditInvItem = () => {
    setEditInvItems(prev => [...prev, mkItem(warehouses[0]?.id)])
  }

  const removeEditInvItem = (itemId) => {
    setEditInvItems(prev => {
      const items = prev.filter(i => i.id !== itemId)
      return items.length ? items : [mkItem(warehouses[0]?.id)]
    })
  }

  const updateEditInvExtra = (key, patch) => {
    setEditInvExtras(prev => ({
      ...prev,
      [key]: { ...(prev[key] || { enabled: false, amount: 0 }), ...patch },
    }))
  }

  if (!invoice) return null

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: 32, width: 700, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t("編輯發票")}</h2>
            <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>#{invoice.invoice_number || invoice.id}</div>
          </div>
          <button onClick={onClose} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
        </div>
        {/* 負責銷售下拉 */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>{t("負責銷售")}</label>
          <select value={editInvSalespersonId} onChange={e => setEditInvSalespersonId(e.target.value)}
            style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", background: "#fff", boxSizing: "border-box" }}>
            <option value="">{t("（無）")}</option>
            {employees.filter(e => e.role === '銷售' && e.active !== false).map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          {(invoice.status || '').trim().toLowerCase() === 'paid' && (
            <div style={{ fontSize: 11, color: "#b87500", marginTop: 4 }}>{t("已 Paid 發票儲存後 → 佣金將按當前明細與規則重算")}</div>
          )}
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 8 }}>{t("明細")}</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 56px 90px 72px 36px", gap: 6, fontSize: 11, color: "#888", marginBottom: 6, paddingLeft: 4 }}>
            <div>{t("產品名稱")}</div><div style={{ textAlign: "center" }}>{t("數量")}</div><div>{t("單價 HKD")}</div><div>{t("倉庫")}</div><div></div>
          </div>
          {editInvItems.map((item, idx) => (
            <React.Fragment key={item.id}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 56px 90px 72px 36px", gap: 6, marginBottom: isDcAdaptorProLineItem(item, { products, lineItemAliases }) ? 6 : 8 }}>
                <input value={item.name} onChange={e => updateEditInvItem(idx, { name: e.target.value })} placeholder={t("產品名")} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }} />
                <input type="number" value={item.qty} onChange={e => updateEditInvItem(idx, { qty: parseInt(e.target.value) || 0 })} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", textAlign: "center" }} />
                <input type="number" value={item.price} onChange={e => updateEditInvItem(idx, { price: parseFloat(e.target.value) || 0 })} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }} />
                <select value={item.warehouse_id || ''} onChange={e => updateEditInvItem(idx, { warehouse_id: e.target.value || null })} title={t("扣庫存的倉庫（不顯示在發票/收據上）")} style={{ padding: "9px 6px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", background: "#fff" }}>
                  <option value="">—</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{t(w.name.replace("分部", ""))}</option>)}
                </select>
                <button onClick={() => removeEditInvItem(item.id)} style={{ background: "#fce4ec", border: "none", borderRadius: 8, cursor: "pointer", color: "#e53935" }}><Icon name="x" size={13} /></button>
              </div>
              {isDcAdaptorProLineItem(item, { products, lineItemAliases }) && (
                <input
                  value={item.imei_code || ""}
                  onChange={e => updateEditInvItem(idx, { imei_code: e.target.value })}
                  placeholder={t("IMEI 辨識碼")}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid #d8e0ff", background: "#f8faff", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10 }}
                />
              )}
            </React.Fragment>
          ))}
          <button onClick={addEditInvItem} style={{ fontSize: 13, color: "#6382ff", background: "none", border: "1px dashed #6382ff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", width: "100%", marginTop: 4 }}>+ {t("新增項目")}</button>
        </div>
        <div style={{ marginBottom: 14, padding: "14px 16px", background: "#fafbff", borderRadius: 12, border: "1px solid #eef0fa" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#555", marginBottom: 10 }}>{t("額外費用")}</div>
          {[
            { key: "deposit", label: t("押金"), sign: "+", color: "#6382ff" },
            { key: "discount", label: t("優惠"), sign: "−", color: "#d14343" },
            { key: "surcharge", label: t("手續費"), sign: "+", color: "#f59e0b" },
          ].map(({ key, label, sign, color }) => {
            const v = editInvExtras[key] || { enabled: false, amount: 0 }
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <input type="checkbox" id={`edit-extra-${key}`} checked={v.enabled} onChange={e => updateEditInvExtra(key, { enabled: e.target.checked })} style={{ width: 16, height: 16, cursor: "pointer" }} />
                <label htmlFor={`edit-extra-${key}`} style={{ fontSize: 14, cursor: "pointer", minWidth: 70, fontWeight: 600 }}>
                  <span style={{ color, marginRight: 4 }}>{sign}</span>{label}
                </label>
                {v.enabled && (
                  <input type="number" min="0" value={v.amount || ""} onChange={e => updateEditInvExtra(key, { amount: parseFloat(e.target.value) || 0 })} placeholder={t("金額 HKD")} style={{ flex: 1, padding: "7px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }} />
                )}
              </div>
            )
          })}
        </div>
        <div style={{ background: "#fafbff", borderRadius: 12, padding: "14px 18px", marginBottom: 16, border: "1px solid #eef0fa" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, marginBottom: 8 }}>
            <span style={{ color: "#666" }}>{t("明細合計（含額外費用）")}</span>
            <span style={{ fontWeight: 700 }}>HKD${Math.round(editItemsSum).toLocaleString()}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, color: "#666" }}>{t("發票總額（留空=跟明細）")}</span>
            <input type="number" value={editInvTotalOverride} onChange={e => setEditInvTotalOverride(e.target.value)} placeholder={String(Math.round(editItemsSum))} style={{ width: 160, padding: "8px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", textAlign: "right" }} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", background: "#1a1a2e", borderRadius: 12, marginBottom: 16 }}>
          <span style={{ color: "#aaa", fontSize: 14 }}>{t("最終總額")}</span>
          <span style={{ color: "#fff", fontSize: 22, fontWeight: 800 }}>HKD${Math.round(editFinalTotal).toLocaleString()}</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 12, background: "#f5f5f5", color: "#555", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{t("取消")}</button>
          <button onClick={handleSaveInvoice} style={{ flex: 2, padding: 12, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>{t("儲存修改")}</button>
        </div>
      </div>
    </div>
  )
}
