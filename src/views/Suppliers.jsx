import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'
import { Icon } from '../components/Icon.jsx'
import { toastError } from '../lib/toast.js'

export default function SuppliersView() {
  const { t } = useT()
  const { suppliers, setSuppliers } = useAppContext()
  const queryClient = useQueryClient()

  const [showAddSupplier, setShowAddSupplier] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [supplierSearch, setSupplierSearch] = useState("")
  const [supplierCategoryFilter, setSupplierCategoryFilter] = useState("all")
  const [newSupplier, setNewSupplier] = useState({ name: "", contact_url: "", contact_person: "", category: "", note: "" })

  async function handleSaveSupplier() {
    if (!newSupplier.name?.trim()) return
    const payload = {
      name: newSupplier.name.trim(),
      contact_url: newSupplier.contact_url?.trim() || null,
      contact_person: newSupplier.contact_person?.trim() || null,
      category: newSupplier.category?.trim() || null,
      note: newSupplier.note?.trim() || null,
    }
    const { data, error } = await supabase.from("suppliers").insert(payload).select().single()
    if (error) { toastError(t("新增失敗"), { detail: error }); return }
    setSuppliers(prev => [data, ...prev])
    queryClient.setQueryData(["bf", "suppliers"], (old) => Array.isArray(old) ? [data, ...old] : [data])
    setNewSupplier({ name: "", contact_url: "", contact_person: "", category: "", note: "" })
    setShowAddSupplier(false)
  }
  async function handleUpdateSupplier(id, patch) {
    const finalPatch = { ...patch, updated_at: new Date().toISOString() }
    const { error } = await supabase.from("suppliers").update(finalPatch).eq("id", id)
    if (error) { toastError(t("更新失敗"), { detail: error }); return }
    setSuppliers(prev => prev.map(s => s.id === id ? { ...s, ...finalPatch } : s))
    queryClient.setQueryData(["bf", "suppliers"], (old) => Array.isArray(old) ? old.map(s => s.id === id ? { ...s, ...finalPatch } : s) : old)
  }
  async function handleDeleteSupplier(id) {
    if (!window.confirm(t("確定刪除此供應商？"))) return
    const { error } = await supabase.from("suppliers").delete().eq("id", id)
    if (error) { toastError(t("刪除失敗"), { detail: error }); return }
    setSuppliers(prev => prev.filter(s => s.id !== id))
    queryClient.setQueryData(["bf", "suppliers"], (old) => Array.isArray(old) ? old.filter(s => s.id !== id) : old)
    setEditingSupplier(null)
  }

  const cats = Array.from(new Set(suppliers.map(s => s.category).filter(Boolean))).sort()
  const q = supplierSearch.trim().toLowerCase()
  const filtered = suppliers.filter(s => {
    if (supplierCategoryFilter !== "all" && (s.category || "") !== supplierCategoryFilter) return false
    if (q) {
      const hit = (s.name || "").toLowerCase().includes(q)
        || (s.contact_person || "").toLowerCase().includes(q)
        || (s.category || "").toLowerCase().includes(q)
        || (s.note || "").toLowerCase().includes(q)
      if (!hit) return false
    }
    return true
  })

  return (
    <>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{t("供應商")}</h1>
            <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>{t("共")} {filtered.length} {t("家供應商")}</p>
          </div>
          <button onClick={() => setShowAddSupplier(true)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
            <Icon name="plus" size={16} /> {t("新增供應商")}
          </button>
        </div>

        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="search" size={15} />
          <input placeholder={t("搜尋供應商...")} value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
        </div>

        {cats.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#888", marginRight: 4 }}>{t("分類")}：</span>
            <button onClick={() => setSupplierCategoryFilter("all")} style={{ padding: "6px 14px", borderRadius: 20, border: supplierCategoryFilter === "all" ? "1px solid #6382ff" : "1px solid #e0e0e0", background: supplierCategoryFilter === "all" ? "#f0f4ff" : "#fff", color: supplierCategoryFilter === "all" ? "#6382ff" : "#666", fontSize: 13, fontWeight: 600, lineHeight: "20px", cursor: "pointer" }}>{t("全部")}</button>
            {cats.map(c => (
              <button key={c} onClick={() => setSupplierCategoryFilter(c)} style={{ padding: "6px 14px", borderRadius: 20, border: supplierCategoryFilter === c ? "1px solid #6382ff" : "1px solid #e0e0e0", background: supplierCategoryFilter === c ? "#f0f4ff" : "#fff", color: supplierCategoryFilter === c ? "#6382ff" : "#666", fontSize: 13, fontWeight: 600, lineHeight: "20px", cursor: "pointer" }}>{c}</button>
            ))}
          </div>
        )}

        {filtered.length === 0 ? (
          <div style={{ background: "#fff", border: "1px dashed #e0e0e0", borderRadius: 12, padding: 60, textAlign: "center", color: "#aaa" }}>
            {suppliers.length === 0 ? t("尚無供應商，點右上「新增供應商」開始") : t("沒有匹配結果")}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
            {filtered.map(s => (
              <div key={s.id} style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#222" }}>{s.name}</div>
                  {s.category && <span style={{ fontSize: 11, color: "#6382ff", background: "#eef2ff", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>{s.category}</span>}
                </div>
                {s.contact_person && <div style={{ fontSize: 12, color: "#666" }}>👤 {s.contact_person}</div>}
                {s.contact_url && (
                  <a href={s.contact_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#3b58d4", textDecoration: "none", padding: "6px 10px", background: "#eef2ff", borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "flex-start", fontWeight: 600 }}>
                    🔗 {t("打開聯繫")}
                  </a>
                )}
                {s.note && <div style={{ fontSize: 12, color: "#888", marginTop: 2, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{s.note}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 6, borderTop: "1px dashed #f0f0f0" }}>
                  <button onClick={() => setEditingSupplier({ ...s })} style={{ flex: 1, padding: "5px 10px", background: "#f5f5f5", color: "#666", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>✏ {t("編輯")}</button>
                  <button onClick={() => handleDeleteSupplier(s.id)} style={{ padding: "5px 10px", background: "#fce4ec", color: "#e53935", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 供應商：新增 + 編輯 modal */}
      {(showAddSupplier || editingSupplier) && (() => {
        const isEdit = !!editingSupplier
        const v = isEdit ? editingSupplier : newSupplier
        const setV = isEdit ? (patch) => setEditingSupplier({ ...editingSupplier, ...patch }) : (patch) => setNewSupplier({ ...newSupplier, ...patch })
        const close = () => { if (isEdit) setEditingSupplier(null); else { setShowAddSupplier(false); setNewSupplier({ name: "", contact_url: "", contact_person: "", category: "", note: "" }) } }
        const submit = async () => {
          if (!v.name?.trim()) { alert(t("名稱必填")); return }
          if (isEdit) {
            await handleUpdateSupplier(editingSupplier.id, {
              name: v.name.trim(),
              contact_url: v.contact_url?.trim() || null,
              contact_person: v.contact_person?.trim() || null,
              category: v.category?.trim() || null,
              note: v.note?.trim() || null,
            })
            setEditingSupplier(null)
          } else {
            await handleSaveSupplier()
          }
        }
        const inp = (label, key, type = "text") => (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#666", fontWeight: 600, marginBottom: 12 }}>
            {label}
            {type === "textarea" ? (
              <textarea value={v[key] || ""} onChange={e => setV({ [key]: e.target.value })} rows={3} style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", fontFamily: "inherit", resize: "vertical" }} />
            ) : (
              <input value={v[key] || ""} onChange={e => setV({ [key]: e.target.value })} style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none" }} />
            )}
          </label>
        )
        return (
          <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 18 }}>{isEdit ? t("編輯供應商") : t("新增供應商")}</div>
              {inp(t("名稱") + " *", "name")}
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#666", fontWeight: 600, marginBottom: 12 }}>
                {t("聯繫鏈接")}
                <input value={v.contact_url || ""} onChange={e => setV({ contact_url: e.target.value })} placeholder="https://wa.me/85296... 或 wxwork://message?username=xxx 或 mailto:..." style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", fontFamily: "monospace" }} />
                <span style={{ fontSize: 10, color: "#aaa", fontWeight: 400 }}>{t("企業微信內部同事用 wxwork://message?username=xxx；外部公司建議用 WhatsApp / 電話 / 郵箱")}</span>
              </label>
              {inp(t("對接人"), "contact_person")}
              {inp(t("分類"), "category")}
              {inp(t("備註"), "note", "textarea")}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={close} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#666" }}>{t("取消")}</button>
                <button onClick={submit} style={{ background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t("保存")}</button>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )
}
