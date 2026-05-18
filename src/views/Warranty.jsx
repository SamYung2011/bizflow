import React, { useState } from 'react'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'
import { Icon } from '../components/Icon.jsx'

export default function WarrantyView({ allWarrantyItems, setSelectedCustomer }) {
  const { t } = useT()
  const { setTab } = useAppContext()

  const [visibleWarranty, setVisibleWarranty] = useState(50)
  const [warrantySearch, setWarrantySearch] = useState("")
  const [warrantyBucket, setWarrantyBucket] = useState("all")

  const counts = {
    all: allWarrantyItems.length,
    expired: allWarrantyItems.filter(w => w.bucket === "expired").length,
    week: allWarrantyItems.filter(w => w.bucket === "week").length,
    soon: allWarrantyItems.filter(w => w.bucket === "soon").length,
    near: allWarrantyItems.filter(w => w.bucket === "near").length,
    far: allWarrantyItems.filter(w => w.bucket === "far").length,
  }
  const q = warrantySearch.toLowerCase().trim()
  const filtered = allWarrantyItems.filter(w => {
    if (warrantyBucket !== "all" && w.bucket !== warrantyBucket) return false
    if (!q) return true
    return (w.customerName || "").toLowerCase().includes(q)
      || (w.customerPhone || "").toLowerCase().includes(q)
      || (w.productName || "").toLowerCase().includes(q)
      || (w.invoiceNum || "").toLowerCase().includes(q)
  })
  const bucketColor = (b) => b === "expired" ? "#d14343" : b === "week" ? "#ea580c" : b === "soon" ? "#f59e0b" : b === "near" ? "#6382ff" : "#22c55e"
  const bucketLabel = (b) => b === "expired" ? t("已過期") : b === "week" ? t("一週內") : b === "soon" ? t("30 天內") : b === "near" ? t("90 天內") : t("一年內")
  const filterBtns = [
    { k: "all", label: `${t("全部")} (${counts.all})`, color: "#555" },
    { k: "expired", label: `${t("已過期")} (${counts.expired})`, color: "#d14343" },
    { k: "week", label: `${t("一週內")} (${counts.week})`, color: "#ea580c" },
    { k: "soon", label: `${t("30 天內")} (${counts.soon})`, color: "#f59e0b" },
    { k: "near", label: `${t("90 天內")} (${counts.near})`, color: "#6382ff" },
    { k: "far", label: `${t("一年內")} (${counts.far})`, color: "#22c55e" },
  ]
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{t("保修")}</h1>
        <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>{t("共")} {counts.all} {t("件需跟進（過期 30 天內 + 未來 365 天內到期，僅顯示有聯繫方式的客戶）")}</p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {filterBtns.map(b => (
          <button key={b.k} onClick={() => { setWarrantyBucket(b.k); setVisibleWarranty(50); }} style={{ padding: "8px 16px", borderRadius: 20, border: warrantyBucket === b.k ? `2px solid ${b.color}` : "1px solid #e0e0e0", background: warrantyBucket === b.k ? b.color + "18" : "#fff", color: warrantyBucket === b.k ? b.color : "#555", fontSize: 13, fontWeight: warrantyBucket === b.k ? 700 : 500, cursor: "pointer" }}>{b.label}</button>
        ))}
      </div>
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="search" size={15} />
        <input placeholder={t("搜尋客戶名 / 電話 / 產品 / 發票號...")} value={warrantySearch} onChange={e => { setWarrantySearch(e.target.value); setVisibleWarranty(50); }} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#999" }}>{t("沒有符合條件的保修記錄")}</div>
        ) : filtered.slice(0, visibleWarranty).map((w, idx) => (
          <div key={w.invoiceId + "-" + idx} onClick={() => { if (w.customer) { setTab("customers"); setSelectedCustomer(w.customer); } }} style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", border: "1px solid #f0f0f0", boxShadow: "0 2px 6px rgba(0,0,0,0.02)", display: "flex", alignItems: "center", gap: 14, cursor: w.customer ? "pointer" : "default", transition: "border-color 0.15s" }}
            onMouseEnter={e => { if (w.customer) e.currentTarget.style.borderColor = "#6382ff"; }}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#f0f0f0"}>
            <div style={{ width: 6, alignSelf: "stretch", background: bucketColor(w.bucket), borderRadius: 3 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <span style={{ fontWeight: 800, fontSize: 15 }}>{w.customerName}</span>
                {w.customerPhone && <span style={{ fontSize: 12, color: "#888" }}>· {w.customerPhone}</span>}
                <span style={{ fontSize: 11, color: bucketColor(w.bucket), fontWeight: 700, padding: "2px 8px", background: bucketColor(w.bucket) + "18", borderRadius: 8 }}>{bucketLabel(w.bucket)}</span>
              </div>
              <div style={{ fontSize: 13, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.productName} · {w.invoiceNum} · {t("購買")} {w.invoiceDate}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: bucketColor(w.bucket) }}>{w.warrantyEnd}</div>
              <div style={{ fontSize: 12, color: "#888" }}>{w.daysLeft < 0 ? `${t("已過")} ${-w.daysLeft} ${t("天")}` : `${t("剩餘")} ${w.daysLeft} ${t("天")}`}</div>
            </div>
          </div>
        ))}
        {visibleWarranty < filtered.length && (
          <button onClick={() => setVisibleWarranty(v => v + 50)} style={{ display: "block", margin: "12px auto", padding: "10px 28px", background: "#f0f4ff", color: "#6382ff", border: "1px solid #e0e8ff", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
            {t("載入更多")}（{filtered.length - visibleWarranty} {t("項待載入")}）
          </button>
        )}
      </div>
    </div>
  )
}
