import React from 'react'
import { useState } from 'react'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'
import { Icon } from '../components/Icon.jsx'
import { fmtInvNum } from '../lib/invoiceHelpers.js'
import { deriveShippingStatus, isShippingTrackable, isProblematicShipping } from '../lib/shippingHelpers.js'

// dashboard-local 統計卡（與 App.jsx 內 StatCard 完全一致）
const StatCard = ({ label, value, sub, accent, icon, onClick }) => (
  <div onClick={onClick} style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", gap: 8, position: "relative", overflow: "hidden", cursor: onClick ? "pointer" : "default", transition: "transform 0.15s" }}
    onMouseEnter={e => { if (onClick) e.currentTarget.style.transform = "translateY(-2px)" }}
    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)" }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: "16px 16px 0 0" }} />
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontSize: 13, color: "#888", fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: "#1a1a2e", lineHeight: 1.2, marginTop: 4 }}>{value}</div>
        {sub && <div style={{ fontSize: 13, color: "#aaa", marginTop: 4 }}>{sub}</div>}
      </div>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: accent + "18", display: "flex", alignItems: "center", justifyContent: "center", color: accent }}>{icon}</div>
    </div>
  </div>
)

// dashboard 用 Badge（與 App.jsx 內 Badge 完全一致）
const Badge = ({ status }) => {
  const map = {
    "In Stock": { bg: "#e8f5e9", color: "#2e7d32", dot: "#4caf50" },
    "Sold": { bg: "#e3f2fd", color: "#1565c0", dot: "#2196f3" },
    "Warranty Expiring": { bg: "#fff3e0", color: "#e65100", dot: "#ff9800" },
    "Expired": { bg: "#fce4ec", color: "#b71c1c", dot: "#f44336" },
    "Paid": { bg: "#e8f5e9", color: "#2e7d32", dot: "#4caf50" },
    "Unpaid": { bg: "#fce4ec", color: "#b71c1c", dot: "#f44336" },
    "Pending": { bg: "#fff3e0", color: "#e65100", dot: "#ff9800" },
    "VIP": { bg: "#f3e5f5", color: "#6a1b9a", dot: "#9c27b0" },
    "Regular": { bg: "#f5f5f5", color: "#424242", dot: "#9e9e9e" },
    "Lead": { bg: "#e3f2fd", color: "#1565c0", dot: "#2196f3" },
  }
  const s = map[status] || { bg: "#f5f5f5", color: "#333", dot: "#999" }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, background: s.bg, color: s.color, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />{status}
    </span>
  )
}

// 物流相關 helper 已抽到 src/lib/shippingHelpers.js（Dashboard + Invoices 共用）

export default function Dashboard({
  // 跨 view 狀態（App.jsx 留著的）
  setSelectedCustomer,
  setSearch,
}) {
  const { t, lang } = useT()
  const {
    invoices,
    products,
    customers,
    stocks,
    setTab,
    customerGroups,
    warrantyItems,
    lowStockSkus,
    allWarrantyItems,
  } = useAppContext()

  // dashboard 專用 local state（純 dashboard 內用）
  const [dashSearch, setDashSearch] = useState("")

  const getCustomer = (id) => customers.find(c => c.id === id)

  // 月營收（當月）
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const monthlyRevenue = invoices
    .filter(i => (i.date || "").startsWith(currentMonth) && (i.status || "").trim().toLowerCase() === "paid")
    .reduce((s, i) => s + (i.total || 0), 0)

  // 庫存統計：活 SKU + 非歸檔 + 非停售，合計 > 0 才算
  const stockSummary = (() => {
    const byProd = {}
    for (const s of stocks) byProd[s.product_id] = (byProd[s.product_id] || 0) + (s.qty || 0)
    const activeIds = new Set(products.filter(p => p.category !== '_archived' && (p.status || 'active') !== 'discontinued').map(p => p.id))
    let skuCount = 0, totalQty = 0
    for (const [pid, qty] of Object.entries(byProd)) {
      if (qty > 0 && activeIds.has(pid)) { skuCount++; totalQty += qty }
    }
    return { skuCount, totalQty }
  })()
  const inStock = stockSummary.skuCount

  // warrantyAlerts 即 allWarrantyItems（dashboard 卡片用）
  const warrantyAlerts = allWarrantyItems

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>{t("早安 👋")}</h1>
        <p style={{ color: "#888", margin: "4px 0 0", fontSize: 15 }}>{t("以下是 Honnmono 今日的業務概況。")}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
        <StatCard label={t("本月營收")} value={`HKD$${monthlyRevenue.toLocaleString()}`} sub={lang === "en" ? `${now.toLocaleString("en", { month: "long", year: "numeric" })}` : lang === "fr" ? `${now.toLocaleString("fr", { month: "long", year: "numeric" })}` : `${now.getFullYear()}年${now.getMonth() + 1}月`} accent="#6382ff" icon={<Icon name="trend_up" size={20} />} onClick={() => setTab("revenue")} />
        <StatCard label={t("庫存數量")} value={inStock} sub={lowStockSkus.length > 0 ? `${t("共")} ${stockSummary.totalQty} ${t("件")} · ⚠ ${lowStockSkus.length} ${t("件低庫存")}` : `${t("共")} ${stockSummary.totalQty} ${t("件")}`} accent={lowStockSkus.length > 0 ? "#f59e0b" : "#22c55e"} icon={<Icon name="inventory" size={20} />} onClick={() => setTab("products")} />
        <StatCard label={t("客戶數")} value={customerGroups.virtualCustomers.filter(c => c.allEmails.length > 0 || c.allPhones.length > 0).length} sub={t("累計")} accent="#f59e0b" icon={<Icon name="customer" size={20} />} onClick={() => { setTab("customers"); setSelectedCustomer(null) }} />
        <StatCard label={t("保修提醒")} value={warrantyAlerts.length} sub={t("需跟進")} accent="#ef4444" icon={<Icon name="warning" size={20} />} onClick={() => setTab("warranty")} />
      </div>
      {/* 物流 3 卡（dashboard 第二行） */}
      {(() => {
        const paidInvoices = invoices.filter(i => (i.status || "").trim().toLowerCase() === "paid")
        // 待發貨 dashboard 卡：跟列表 filter 對齊，只算啟用日期之後的（避免 4500+ 張歷史 NULL 全進來）
        const pending = paidInvoices.filter(i => deriveShippingStatus(i) === '待發貨' && isShippingTrackable(i)).length
        const inTransit = paidInvoices.filter(i => ['已發貨','在途','派送中'].includes(deriveShippingStatus(i))).length
        // 異常 = shipping_status='異常' OR 已發貨但 > 14 天未簽（lib/shippingHelpers）
        const overdue = paidInvoices.filter(isProblematicShipping).length
        const goShipping = (k) => {
          sessionStorage.setItem('invoices.initialShippingFilter', k)
          setTab("invoices")
          setSelectedCustomer(null)
          setSearch("")
        }
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
            <StatCard label={t("待發貨")} value={pending} sub={t("已付款待出庫")} accent="#888" icon={<Icon name="inventory" size={20} />} onClick={() => goShipping("pending")} />
            <StatCard label={t("運送中")} value={inTransit} sub={t("已發貨待簽收")} accent="#6382ff" icon={<Icon name="trend_up" size={20} />} onClick={() => goShipping("in_transit")} />
            <StatCard label={t("超期未簽")} value={overdue} sub={`> 14 ${t("天未簽收")}`} accent="#ef4444" icon={<Icon name="warning" size={20} />} onClick={() => goShipping("exception")} />
          </div>
        )
      })()}
      <div style={{ position: "relative", marginBottom: 20 }}>
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="search" size={15} />
          <input placeholder={t("搜尋發票、客戶、產品...")} value={dashSearch} onChange={e => setDashSearch(e.target.value)} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
          {dashSearch && (
            <button onClick={() => setDashSearch("")} style={{ background: "#f5f5f5", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 12, color: "#666" }}>×</button>
          )}
        </div>
        {dashSearch.trim() && (() => {
          const q = dashSearch.trim().toLowerCase()
          const custMatches = customerGroups.virtualCustomers.filter(c =>
            c.allNames.some(n => n.toLowerCase().includes(q))
            || c.allPhones.some(p => p.toLowerCase().includes(q))
            || c.allEmails.some(e => e.toLowerCase().includes(q))
            || (c.car_make || "").toLowerCase().includes(q)
            || (c.car_model || "").toLowerCase().includes(q)
          ).slice(0, 5)
          const prodMatches = products.filter(p => (p.name || "").toLowerCase().includes(q)).slice(0, 5)
          const invMatches = invoices.filter(inv => {
            const c = getCustomer(inv.customer_id)
            return String(inv.invoice_number || "").toLowerCase().includes(q)
              || (c?.name || "").toLowerCase().includes(q)
              || (inv.notes || "").toLowerCase().includes(q)
          }).slice(0, 5)
          const total = custMatches.length + prodMatches.length + invMatches.length
          const panelStyle = { position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #e0e0e0", borderRadius: 12, marginTop: 4, boxShadow: "0 8px 28px rgba(0,0,0,0.1)", zIndex: 20, maxHeight: 500, overflowY: "auto" }
          const hdrStyle = { padding: "10px 16px 4px", fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em", textTransform: "uppercase", background: "#fafbff" }
          const rowStyle = { padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #f5f5f5" }
          if (total === 0) return (<div style={{ ...panelStyle, padding: 20, textAlign: "center", color: "#999", fontSize: 13 }}>{t("沒有符合的結果")}</div>)
          return (
            <div style={panelStyle}>
              {custMatches.length > 0 && <>
                <div style={hdrStyle}>{t("客戶")}（{custMatches.length}）</div>
                {custMatches.map(c => (
                  <div key={"c" + c.id} onClick={() => { setTab("customers"); setSelectedCustomer(c); setDashSearch("") }} style={rowStyle} onMouseEnter={e => e.currentTarget.style.background = "#f7f8fc"} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#6382ff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{(c.name || "?")[0]}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[c.phone, c.email].filter(Boolean).join(" · ")}{c.car_make ? ` · 🚗 ${c.car_make} ${c.car_model || ""}` : ""}</div>
                    </div>
                  </div>
                ))}
              </>}
              {prodMatches.length > 0 && <>
                <div style={hdrStyle}>{t("產品")}（{prodMatches.length}）</div>
                {prodMatches.map(p => (
                  <div key={"p" + p.id} onClick={() => { setTab("products"); setDashSearch("") }} style={rowStyle} onMouseEnter={e => e.currentTarget.style.background = "#f7f8fc"} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                    <div style={{ fontSize: 20, width: 32, textAlign: "center" }}>📦</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "#888" }}>HKD${p.price} · {t("保修")} {p.warranty_months || "—"} {t("月")}</div>
                    </div>
                  </div>
                ))}
              </>}
              {invMatches.length > 0 && <>
                <div style={hdrStyle}>{t("發票")}（{invMatches.length}）</div>
                {invMatches.map(inv => {
                  const c = getCustomer(inv.customer_id)
                  return (
                    <div key={"i" + inv.id} onClick={() => { setTab("invoices"); setSearch(String(inv.invoice_number || inv.id).replace(/^DC/i, "")); setDashSearch("") }} style={rowStyle} onMouseEnter={e => e.currentTarget.style.background = "#f7f8fc"} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                      <div style={{ fontSize: 20, width: 32, textAlign: "center" }}>📄</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{fmtInvNum(inv)}</div>
                        <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c?.name || "—"} · {inv.date || "?"} · HKD${inv.total}</div>
                      </div>
                      <Badge status={inv.status} />
                    </div>
                  )
                })}
              </>}
            </div>
          )
        })()}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t("最近發票")}</h2>
            <button onClick={() => setTab("invoices")} style={{ fontSize: 13, color: "#6382ff", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>{t("查看全部 →")}</button>
          </div>
          {invoices.slice(0, 5).map(inv => {
            const c = getCustomer(inv.customer_id)
            return (
              <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #f5f5f5" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{fmtInvNum(inv)}</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{(c?.phone || c?.phone_mainland) ? `${c.phone || c.phone_mainland} · ` : ""}{c?.name || "—"} · {inv.date || t("日期未知")}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>HKD${inv.total}</span>
                  <Badge status={inv.status} />
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t("🔔 保修提醒")}</h2>
            <Badge status="Warranty Expiring" />
          </div>
          {warrantyItems.length === 0 ? (
            <div style={{ color: "#aaa", fontSize: 14, textAlign: "center", paddingTop: 20 }}>{t("目前沒有提醒 ✓")}</div>
          ) : <>{warrantyItems.slice(0, 5).map((item, idx) => (
              <div key={idx} onClick={() => { if (item.customer) { setTab("customers"); setSelectedCustomer(item.customer) } }} style={{ background: "#fff8f0", border: "1px solid #ffe0b2", borderRadius: 12, padding: "12px 16px", marginBottom: 10, cursor: item.customer ? "pointer" : "default", transition: "all 0.15s" }}
                onMouseEnter={e => { if (item.customer) { e.currentTarget.style.borderColor = "#ff9800"; e.currentTarget.style.background = "#fff3e0" } }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#ffe0b2"; e.currentTarget.style.background = "#fff8f0" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{item.productName}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 3 }}>{item.customerName} · {item.invoiceNum}</div>
                <div style={{ fontSize: 12, color: "#e65100", marginTop: 4, fontWeight: 600 }}>{t("保修到期")}：{item.warrantyEnd}（{t("剩餘")} {item.daysLeft} {t("天")}）</div>
              </div>
          ))}
          {warrantyItems.length > 5 && (
            <button onClick={() => setTab("warranty")} style={{ display: "block", margin: "8px auto 0", padding: "8px 20px", background: "#fff3e0", color: "#ff9800", border: "1px solid #ffe0b2", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
              {t("查看全部保修記錄 →")}
            </button>
          )}</>}
        </div>
      </div>
    </div>
  )
}
