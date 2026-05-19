import React, { useState } from 'react'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'

export default function RevenueView() {
  const { t } = useT()
  const { invoices, products, lineItemAliases, customerGroups } = useAppContext()

  const [revenueRange, setRevenueRange] = useState("12m")

  const paidInvoices = invoices.filter(i => (i.status || "").trim().toLowerCase() === "paid")
  const today = new Date()
  const rangeStart = (() => {
    const d = new Date(today)
    if (revenueRange === "thisMonth") return new Date(today.getFullYear(), today.getMonth(), 1)
    if (revenueRange === "lastMonth") return new Date(today.getFullYear(), today.getMonth() - 1, 1)
    if (revenueRange === "3m") { d.setMonth(d.getMonth() - 3); return d }
    if (revenueRange === "12m") { d.setMonth(d.getMonth() - 12); return d }
    if (revenueRange === "year") return new Date(today.getFullYear(), 0, 1)
    return new Date(2000, 0, 1)
  })()
  const rangeEnd = (() => {
    if (revenueRange === "lastMonth") return new Date(today.getFullYear(), today.getMonth(), 1)
    return today
  })()
  const inRange = paidInvoices.filter(i => {
    if (!i.date) return false
    const d = new Date(i.date)
    return d >= rangeStart && d < rangeEnd
  })
  const totalRevenue = inRange.reduce((s, i) => s + (i.total || 0), 0)
  const invCount = inRange.length
  const avgValue = invCount > 0 ? Math.round(totalRevenue / invCount) : 0
  const allInRange = invoices.filter(i => {
    if (!i.date) return false
    const d = new Date(i.date)
    return d >= rangeStart && d < rangeEnd
  })
  const unpaidCount = allInRange.filter(i => (i.status || "").trim().toLowerCase() !== "paid").length
  const unpaidAmount = allInRange.filter(i => (i.status || "").trim().toLowerCase() !== "paid").reduce((s, i) => s + (i.total || 0), 0)
  const monthMap = {}
  inRange.forEach(i => {
    const m = (i.date || "").slice(0, 7)
    if (!m) return
    monthMap[m] = (monthMap[m] || 0) + (i.total || 0)
  })
  const monthKeys = Object.keys(monthMap).sort()
  const maxMonth = Math.max(1, ...Object.values(monthMap))
  // 產品銷售聚合：走 line_item_aliases 映射歸到 product UUID（套裝按 qty multiplier 比例分配營收）
  const normN = (s) => (s || "").toLowerCase().trim()
  const trendAliasByName = new Map(lineItemAliases.map(a => [normN(a.alias_name), a]))
  const productByName = new Map(products.map(pp => [pp.name, pp]))
  const productSalesMap = new Map()
  for (const inv of inRange) {
    if (!Array.isArray(inv.items)) continue
    for (const it of inv.items) {
      if (!it || !it.name) continue
      const itemQty = Number(it.qty) || 0
      if (itemQty <= 0) continue
      const itemPrice = Number(it.price) || 0
      const lineValue = itemPrice * itemQty
      const alias = trendAliasByName.get(normN(it.name))
      let resolved = []
      if (alias && alias.skip !== true && Array.isArray(alias.products) && alias.products.length > 0) {
        const totalMult = alias.products.reduce((s, ap) => s + (Number(ap.qty) || 1), 0)
        for (const ap of alias.products) {
          const m = Number(ap.qty) || 1
          resolved.push({ product_id: ap.product_id, qty: m * itemQty, share: m / totalMult })
        }
      } else if (!alias) {
        const directProd = productByName.get(it.name)
        if (directProd) resolved.push({ product_id: directProd.id, qty: itemQty, share: 1 })
      }
      for (const r of resolved) {
        const cur = productSalesMap.get(r.product_id) || { qty: 0, revenue: 0 }
        cur.qty += r.qty
        cur.revenue += lineValue * r.share
        productSalesMap.set(r.product_id, cur)
      }
    }
  }
  // 按產品名合併同名 UUID + 過濾虛擬條目
  const namedSalesMap = new Map()
  for (const [pid, v] of productSalesMap) {
    const p = products.find(x => x.id === pid)
    if (!p) continue
    if (p.is_virtual === true) continue
    const name = p.name || `(${t("未命名")})`
    const cur = namedSalesMap.get(name) || { qty: 0, revenue: 0 }
    cur.qty += v.qty
    cur.revenue += v.revenue
    namedSalesMap.set(name, cur)
  }
  const prodMap = {}
  for (const [name, v] of namedSalesMap) prodMap[name] = v.revenue
  const prodTop = Object.entries(prodMap).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const maxProd = Math.max(1, ...prodTop.map(p => p[1]))
  // 客戶 Top 10：依 customerGroups 合併
  const custMap = {}
  inRange.forEach(i => {
    if (!i.customer_id) return
    const groupId = customerGroups.idToGroup.get(i.customer_id)
    const info = groupId ? customerGroups.groupInfo.get(groupId) : null
    const names = info ? Array.from(info.names) : []
    const phones = info ? Array.from(info.phones) : []
    const emails = info ? Array.from(info.emails) : []
    let key
    if (names.length > 0) {
      key = "G:" + groupId
    } else {
      key = "UNNAMED"
    }
    if (!custMap[key]) {
      custMap[key] = {
        name: names.length > 0 ? names.join(" / ") : t("(無名客戶)"),
        phone: phones.join(", "),
        email: emails.join(", "),
        amt: 0,
      }
    }
    custMap[key].amt += i.total || 0
  })
  const custTop = Object.values(custMap).sort((a, b) => b.amt - a.amt).slice(0, 10)
  const maxCust = Math.max(1, ...custTop.map(c => c.amt))
  const ranges = [
    { k: "thisMonth", label: t("本月") },
    { k: "lastMonth", label: t("上月") },
    { k: "3m", label: t("近 3 月") },
    { k: "12m", label: t("近 12 月") },
    { k: "year", label: t("本年度") },
    { k: "all", label: t("全部") },
  ]
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{t("營收")}</h1>
        <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>{t("僅統計已付款（Paid）發票")}</p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {ranges.map(r => (
          <button key={r.k} onClick={() => setRevenueRange(r.k)} style={{ padding: "8px 16px", borderRadius: 20, border: revenueRange === r.k ? "2px solid #6382ff" : "1px solid #e0e0e0", background: revenueRange === r.k ? "#eef2ff" : "#fff", color: revenueRange === r.k ? "#6382ff" : "#555", fontSize: 13, fontWeight: revenueRange === r.k ? 700 : 500, cursor: "pointer" }}>{r.label}</button>
        ))}
      </div>
      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
        <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #f0f0f0" }}>
          <div style={{ fontSize: 12, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>{t("總營收")}</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#6382ff", marginTop: 4 }}>HKD${Math.round(totalRevenue).toLocaleString()}</div>
        </div>
        <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #f0f0f0" }}>
          <div style={{ fontSize: 12, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>{t("已付發票數")}</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#22c55e", marginTop: 4 }}>{invCount}</div>
        </div>
        <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #f0f0f0" }}>
          <div style={{ fontSize: 12, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>{t("平均單據")}</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#f59e0b", marginTop: 4 }}>HKD${avgValue.toLocaleString()}</div>
        </div>
        <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #f0f0f0" }}>
          <div style={{ fontSize: 12, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>{t("未付款")}</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#d14343", marginTop: 4 }}>{unpaidCount}</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>HKD${unpaidAmount.toLocaleString()}</div>
        </div>
      </div>
      {/* 月度柱狀圖（多月）/ 產品佔比餅圖（單月） */}
      {monthKeys.length > 1 ? (
        <div style={{ background: "#fff", borderRadius: 14, padding: 24, border: "1px solid #f0f0f0", marginBottom: 20 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>{t("月度營收趨勢")}</h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 220, overflowX: "auto", paddingBottom: 6 }}>
            {monthKeys.map(m => {
              const v = monthMap[m]
              const h = Math.max(4, (v / maxMonth) * 180)
              return (
                <div key={m} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 50, flex: "1 0 50px" }}>
                  <div style={{ fontSize: 10, color: "#888", fontWeight: 600 }}>{v >= 10000 ? `${Math.round(v/1000)}k` : v}</div>
                  <div style={{ width: "100%", height: h, background: "linear-gradient(180deg,#6382ff,#a78bfa)", borderRadius: "6px 6px 0 0" }} title={`${m}: HKD$${v.toLocaleString()}`} />
                  <div style={{ fontSize: 10, color: "#888" }}>{m.slice(2)}</div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (() => {
        const sortedProds = Object.entries(prodMap).sort((a, b) => b[1] - a[1])
        const top6 = sortedProds.slice(0, 6)
        const restSum = sortedProds.slice(6).reduce((s, [, v]) => s + v, 0)
        const pieData = [
          ...top6.map(([n, v]) => ({ name: n, value: v })),
          ...(restSum > 0 ? [{ name: t("其他"), value: restSum }] : []),
        ]
        const pieTotal = pieData.reduce((s, d) => s + d.value, 0)
        const colors = ["#6382ff", "#a78bfa", "#f59e0b", "#22c55e", "#ef4444", "#ea580c", "#14b8a6"]
        if (pieTotal === 0) return null
        let offset = -Math.PI / 2
        return (
          <div style={{ background: "#fff", borderRadius: 14, padding: 24, border: "1px solid #f0f0f0", marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>{t("產品銷售佔比")}</h3>
            <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
              <svg viewBox="0 0 100 100" style={{ width: 240, height: 240, flexShrink: 0 }}>
                {pieData.length === 1 ? (
                  <circle cx="50" cy="50" r="40" fill={colors[0]} />
                ) : pieData.map((d, i) => {
                  const angle = (d.value / pieTotal) * 2 * Math.PI
                  const x1 = 50 + 40 * Math.cos(offset)
                  const y1 = 50 + 40 * Math.sin(offset)
                  offset += angle
                  const x2 = 50 + 40 * Math.cos(offset)
                  const y2 = 50 + 40 * Math.sin(offset)
                  const large = angle > Math.PI ? 1 : 0
                  return <path key={i} d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${large} 1 ${x2} ${y2} Z`} fill={colors[i % colors.length]} stroke="#fff" strokeWidth="0.5" />
                })}
              </svg>
              <div style={{ flexShrink: 0, maxWidth: 480 }}>
                {pieData.map((d, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "14px 1fr auto auto", alignItems: "center", gap: 10, marginBottom: 8, fontSize: 13 }}>
                    <div style={{ width: 14, height: 14, background: colors[i % colors.length], borderRadius: 3 }} />
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#333", minWidth: 150, maxWidth: 260 }}>{d.name}</div>
                    <div style={{ fontWeight: 700, color: "#666", minWidth: 40, textAlign: "right" }}>{Math.round(d.value / pieTotal * 100)}%</div>
                    <div style={{ fontSize: 11, color: "#888", minWidth: 90, textAlign: "right" }}>HKD${Math.round(d.value).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}
      {/* 產品 Top 10 + 客戶 Top 10 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "#fff", borderRadius: 14, padding: 24, border: "1px solid #f0f0f0" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>{t("熱銷產品 Top 10")}</h3>
          {prodTop.length === 0 ? <div style={{ color: "#aaa", fontSize: 13 }}>{t("沒有數據")}</div> : prodTop.map(([name, amt]) => (
            <div key={name} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "70%" }}>{name}</span>
                <span style={{ fontWeight: 700, color: "#6382ff" }}>HKD${Math.round(amt).toLocaleString()}</span>
              </div>
              <div style={{ height: 6, background: "#f0f4ff", borderRadius: 3 }}>
                <div style={{ height: "100%", width: `${(amt/maxProd)*100}%`, background: "linear-gradient(90deg,#6382ff,#a78bfa)", borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ background: "#fff", borderRadius: 14, padding: 24, border: "1px solid #f0f0f0" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>{t("大客戶 Top 10")}</h3>
          {custTop.length === 0 ? <div style={{ color: "#aaa", fontSize: 13 }}>{t("沒有數據")}</div> : custTop.map((c, idx) => (
            <div key={idx} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: "#333" }}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</span>
                <span style={{ fontWeight: 700, color: "#22c55e" }}>HKD${Math.round(c.amt).toLocaleString()}</span>
              </div>
              <div style={{ height: 6, background: "#f0fdf4", borderRadius: 3 }}>
                <div style={{ height: "100%", width: `${(c.amt/maxCust)*100}%`, background: "linear-gradient(90deg,#22c55e,#84cc16)", borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* 銷售佣金月結 UI 已遷至 team subapp，bizflow 端不再顯示 */}
    </div>
  )
}
