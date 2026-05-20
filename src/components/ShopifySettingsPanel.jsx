import React, { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'

// Shopify 集成設置面板（產品 tab → Shopify API 子 tab）
// access_token 由 Edge Function `shopify-settings` 加密讀寫；migration 059 column-level lock 攔 anon/authenticated 直拉
// 解鎖密碼複用 wa_settings.admin_password（同一個 admin 密碼、UI 體驗一致）

async function callEdge(fnName, payload) {
  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
    body: JSON.stringify(payload),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  return d
}

function normalizeDomain(s) {
  return (s || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
}

export default function ShopifySettingsPanel() {
  const { t } = useT()
  const { shopifySettings, setShopifySettings, isBfAdmin, products, setProducts } = useAppContext()
  const queryClient = useQueryClient()

  const [unlocked, setUnlocked] = useState(false)
  const [pwd, setPwd] = useState('')
  const [showPwdInput, setShowPwdInput] = useState(false)
  const [domainDraft, setDomainDraft] = useState('')
  const [tokenDraft, setTokenDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    if (shopifySettings && !unlocked) setDomainDraft(shopifySettings.shop_domain || '')
  }, [shopifySettings, unlocked])

  async function handleUnlock() {
    if (!pwd) { alert(t('請輸入密碼')); return }
    setBusy(true)
    try {
      const d = await callEdge('shopify-settings', { action: 'unlock', pwd })
      setDomainDraft(d.shop_domain || '')
      setTokenDraft(d.access_token || '')
      setUnlocked(true)
      setShowPwdInput(false)
    } catch (e) {
      alert(`${t('解鎖失敗')}：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    if (!unlocked) { alert(t('請先解鎖')); return }
    if (!domainDraft.trim()) { alert(t('請填寫 Shop Domain')); return }
    setBusy(true)
    try {
      await callEdge('shopify-settings', { action: 'save', pwd, shop_domain: domainDraft.trim(), access_token: tokenDraft.trim() })
      const next = { ...(shopifySettings || { id: 1 }), shop_domain: normalizeDomain(domainDraft), updated_at: new Date().toISOString() }
      setShopifySettings(next)
      queryClient.setQueryData(['bf', 'shopify_settings'], next)
      alert(t('已儲存'))
    } catch (e) {
      alert(`${t('保存失敗')}：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleTest() {
    if (!unlocked && !pwd) { alert(t('請先解鎖')); return }
    if (!domainDraft.trim()) { alert(t('請填寫 Shop Domain')); return }
    setBusy(true)
    setTestResult(null)
    try {
      const d = await callEdge('shopify-settings', { action: 'test-connection', pwd, shop_domain: domainDraft.trim(), access_token: tokenDraft.trim() })
      // 测试成功 → 自动 save，避免 draft 丢失（HMR / reload / 切 tab）后又要重填
      if (d.ok) {
        try {
          await callEdge('shopify-settings', { action: 'save', pwd, shop_domain: domainDraft.trim(), access_token: tokenDraft.trim() })
          const next = { ...(shopifySettings || { id: 1 }), shop_domain: normalizeDomain(domainDraft), updated_at: new Date().toISOString() }
          setShopifySettings(next)
          queryClient.setQueryData(['bf', 'shopify_settings'], next)
          d.autoSaved = true
        } catch (saveErr) {
          d.autoSaveError = saveErr.message
        }
      }
      setTestResult(d)
    } catch (e) {
      setTestResult({ ok: false, error: e.message })
    } finally {
      setBusy(false)
    }
  }

  function handleLockAgain() {
    setUnlocked(false)
    setTokenDraft('')
    setPwd('')
    setTestResult(null)
    setProductList(null)
    setListError('')
  }

  // 拉商品列表（read-only）
  const [productList, setProductList] = useState(null)
  const [listing, setListing] = useState(false)
  const [listError, setListError] = useState('')
  const [productSearch, setProductSearch] = useState('')
  async function handleListProducts() {
    // list 是只读，不需要解锁
    setListing(true)
    setListError('')
    try {
      const d = await callEdge('shopify-products', { action: 'list' })
      if (!d.ok) throw new Error(d.error || 'unknown')
      setProductList(d)
    } catch (e) {
      setListError(e.message)
      setProductList(null)
    } finally {
      setListing(false)
    }
  }

  // 同步到 bizflow（先 dry-run、点确认才实际写）
  const [syncPreview, setSyncPreview] = useState(null) // { stats, plan }
  const [syncResult, setSyncResult] = useState(null)   // { stats, results }
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  async function handleSyncDryRun() {
    if (!unlocked || !pwd) { alert(t('請先解鎖')); return }
    setSyncing(true)
    setSyncError('')
    setSyncResult(null)
    try {
      const d = await callEdge('shopify-products', { action: 'sync', pwd, confirm: false })
      if (!d.ok) throw new Error(d.error || 'unknown')
      setSyncPreview(d)
    } catch (e) {
      setSyncError(e.message)
      setSyncPreview(null)
    } finally {
      setSyncing(false)
    }
  }
  // 手动 link：把 Shopify variant 关联到 bizflow 现有 product
  const [linkModal, setLinkModal] = useState(null) // { variant, product } variant 来自 productList
  const [linkSearch, setLinkSearch] = useState('')
  const [linking, setLinking] = useState(false)
  // bizflow products 反查 by shopify_variant_id（用来在表格上显示已关联）
  const productByVariantId = React.useMemo(() => {
    const m = new Map()
    for (const p of products || []) if (p.shopify_variant_id) m.set(p.shopify_variant_id, p)
    return m
  }, [products])
  async function handleLink(bizflow_product_id) {
    if (!linkModal || !pwd) return
    setLinking(true)
    try {
      const { variant, product } = linkModal
      await callEdge('shopify-products', {
        action: 'link',
        pwd,
        bizflow_product_id,
        shopify_product_id: product.id,
        shopify_variant_id: variant.id,
        shopify_sku: variant.sku || null,
      })
      // 同步本地 products state
      const newProducts = products.map(p => p.id === bizflow_product_id ? { ...p, shopify_product_id: product.id, shopify_variant_id: variant.id, shopify_sku: variant.sku || null } : p)
      setProducts(newProducts)
      queryClient.setQueryData(['bf', 'products'], newProducts)
      setLinkModal(null)
      setLinkSearch('')
    } catch (e) {
      alert(`${t('關聯失敗')}：${e.message}`)
    } finally {
      setLinking(false)
    }
  }
  async function handleUnlink(bizflow_product_id) {
    if (!pwd) { alert(t('請先解鎖')); return }
    if (!window.confirm(t('確定解除關聯？'))) return
    try {
      await callEdge('shopify-products', { action: 'unlink', pwd, bizflow_product_id })
      const newProducts = products.map(p => p.id === bizflow_product_id ? { ...p, shopify_product_id: null, shopify_variant_id: null, shopify_sku: null } : p)
      setProducts(newProducts)
      queryClient.setQueryData(['bf', 'products'], newProducts)
    } catch (e) {
      alert(`${t('解除失敗')}：${e.message}`)
    }
  }

  // 通过 line_item_aliases 倒推 link
  const [aliasLinkPreview, setAliasLinkPreview] = useState(null)
  const [aliasLinkResult, setAliasLinkResult] = useState(null)
  const [aliasLinking, setAliasLinking] = useState(false)
  const [aliasLinkError, setAliasLinkError] = useState('')
  async function handleAliasDryRun() {
    if (!unlocked || !pwd) { alert(t('請先解鎖')); return }
    setAliasLinking(true)
    setAliasLinkError('')
    setAliasLinkResult(null)
    try {
      const d = await callEdge('shopify-products', { action: 'link-from-aliases', pwd, confirm: false })
      if (!d.ok) throw new Error(d.error || 'unknown')
      setAliasLinkPreview(d)
    } catch (e) {
      setAliasLinkError(e.message)
      setAliasLinkPreview(null)
    } finally {
      setAliasLinking(false)
    }
  }
  async function handleAliasConfirm() {
    if (!unlocked || !pwd) return
    if (!window.confirm(t('確定批量 link？將寫入 bizflow products 表'))) return
    setAliasLinking(true)
    try {
      const d = await callEdge('shopify-products', { action: 'link-from-aliases', pwd, confirm: true })
      if (!d.ok) throw new Error(d.error || 'unknown')
      setAliasLinkResult(d)
      setAliasLinkPreview(null)
      // 刷新 bizflow products cache 让表格上「已關聯」状态更新
      queryClient.invalidateQueries({ queryKey: ['bf', 'products'] })
    } catch (e) {
      setAliasLinkError(e.message)
    } finally {
      setAliasLinking(false)
    }
  }

  async function handleSyncConfirm() {
    if (!unlocked || !pwd) { alert(t('請先解鎖')); return }
    if (!window.confirm(t('確定執行同步？將寫入 bizflow products 表'))) return
    setSyncing(true)
    setSyncError('')
    try {
      const d = await callEdge('shopify-products', { action: 'sync', pwd, confirm: true })
      if (!d.ok) throw new Error(d.error || 'unknown')
      setSyncResult(d)
      setSyncPreview(null)
    } catch (e) {
      setSyncError(e.message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{t("Shopify 集成設置")}</div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>
          {t("貼入 Shopify Admin → Settings → Apps and sales channels → Develop apps 建立的 custom app 憑證。Access token 由 Edge Function 加密讀寫，不存進前端 cache。")}
        </div>
        {!isBfAdmin ? (
          <div style={{ padding: 12, background: "#fef3c7", color: "#92400e", borderRadius: 8, fontSize: 12 }}>
            {t("僅 admin 可查看/修改 Shopify 憑證")}
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#555", display: "block", marginBottom: 6 }}>Shop Domain <span style={{ fontWeight: 400, color: "#888" }}>· {t("例：xxx.myshopify.com")}</span></label>
              <input value={domainDraft} onChange={e => setDomainDraft(e.target.value)} placeholder="xxx.myshopify.com" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "monospace" }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#555", display: "block", marginBottom: 6 }}>Access Token <span style={{ fontWeight: 400, color: "#888" }}>· shpat_xxx</span></label>
              {unlocked ? (
                <input type="text" value={tokenDraft} onChange={e => setTokenDraft(e.target.value)} placeholder="shpat_..." style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #d1fae5", background: "#f0fdf4", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "monospace" }} />
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="password" value="************************" disabled style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", background: "#f5f5f5", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "monospace", color: "#888" }} />
                  <button onClick={() => setShowPwdInput(v => !v)} style={{ padding: "9px 14px", background: "#eef2ff", color: "#3b58d4", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t("解鎖")}</button>
                </div>
              )}
              {!unlocked && showPwdInput && (
                <div style={{ marginTop: 10, padding: 12, background: "#fafbff", border: "1px solid #e0e6ff", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>{t("輸入管理員密碼（與 WhatsApp 設置共用）")}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="password" autoFocus value={pwd} onChange={e => setPwd(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleUnlock() }} style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #c6d3ff", fontSize: 13, outline: "none" }} />
                    <button onClick={handleUnlock} disabled={busy} style={{ padding: "8px 16px", background: busy ? "#a8b8e8" : "#6382ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}>{busy ? t("處理中...") : t("確認")}</button>
                    <button onClick={() => { setShowPwdInput(false); setPwd('') }} style={{ padding: "8px 14px", background: "#f5f5f5", color: "#666", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>{t("取消")}</button>
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <button onClick={handleTest} disabled={busy || !unlocked} style={{ padding: "10px 18px", background: busy || !unlocked ? "#f5f5f5" : "#fff", color: busy || !unlocked ? "#aaa" : "#3b58d4", border: "1px solid " + (busy || !unlocked ? "#e0e0e0" : "#c6d3ff"), borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: busy || !unlocked ? "not-allowed" : "pointer" }}>
                {busy ? t("處理中...") : t("測試連接")}
              </button>
              <button onClick={handleSave} disabled={busy || !unlocked} style={{ padding: "10px 22px", background: busy || !unlocked ? "#a8b8e8" : "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: busy || !unlocked ? "not-allowed" : "pointer" }}>
                {busy ? t("保存中...") : t("儲存")}
              </button>
              {unlocked && (
                <button onClick={handleLockAgain} style={{ padding: "10px 14px", background: "transparent", color: "#888", border: "1px solid #e0e0e0", borderRadius: 10, fontSize: 12, cursor: "pointer" }}>{t("重新鎖定")}</button>
              )}
            </div>
            {testResult && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: testResult.ok ? "#f0fdf4" : "#fef2f2", border: "1px solid " + (testResult.ok ? "#bbf7d0" : "#fecaca"), fontSize: 12 }}>
                {testResult.ok ? (
                  <div>
                    <div style={{ fontWeight: 700, color: "#047857", marginBottom: 4 }}>✓ {t("連接成功")}{testResult.autoSaved && <span style={{ fontWeight: 400, color: "#047857", marginLeft: 6 }}>· {t("已自動儲存")}</span>}</div>
                    <div style={{ color: "#555" }}>
                      {t("店舖")}：<b>{testResult.shop?.name || "—"}</b> · {testResult.shop?.myshopifyDomain || ""} · {t("貨幣")} {testResult.shop?.currencyCode || "—"}
                    </div>
                    {testResult.autoSaveError && (
                      <div style={{ marginTop: 6, color: "#b45309", fontSize: 11 }}>⚠ {t("自動儲存失敗")}：{testResult.autoSaveError}</div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontWeight: 700, color: "#991b1b", marginBottom: 4 }}>× {t("連接失敗")}</div>
                    <div style={{ color: "#555", fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>{testResult.error || testResult.body || JSON.stringify(testResult.errors || {})}</div>
                  </div>
                )}
              </div>
            )}
            {shopifySettings?.last_synced_at && (
              <div style={{ marginTop: 14, fontSize: 11, color: "#888" }}>{t("最近同步")}：{new Date(shopifySettings.last_synced_at).toLocaleString()}</div>
            )}
          </>
        )}
      </div>
      {isBfAdmin && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{t("Shopify 商品列表")}</div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{t("從 Shopify 拉全量 active 商品。同步時按 SKU 匹配 bizflow 現有商品 → 用 Shopify name/price 覆蓋；沒匹配的自動建 + needs_review。庫存不動。")}</div>
            </div>
            <button onClick={handleListProducts} disabled={listing} style={{ padding: "10px 22px", background: listing ? "#a8b8e8" : "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: listing ? "not-allowed" : "pointer" }}>
              {listing ? t("拉取中...") : t("拉商品列表")}
            </button>
          </div>
          {listError && (
            <div style={{ marginTop: 12, padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 11, color: "#991b1b", fontFamily: "monospace", wordBreak: "break-all" }}>{listError}</div>
          )}
          {productList && productList.products && (() => {
            const allProducts = productList.products
            const q = productSearch.trim().toLowerCase()
            const filtered = q ? allProducts.filter(p => (p.title || "").toLowerCase().includes(q) || (p.handle || "").toLowerCase().includes(q) || p.variants.some(v => (v.sku || "").toLowerCase().includes(q))) : allProducts
            return (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
                  {t("共")} <b>{productList.count}</b> {t("個商品")} · <b>{productList.variantCount}</b> {t("個 variant")}
                  {q && <span> · {t("篩選")} <b>{filtered.length}</b></span>}
                </div>
                <input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder={t("搜尋商品名 / handle / SKU...")} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", boxSizing: "border-box", marginBottom: 10 }} />
                <div style={{ border: "1px solid #f0f0f0", borderRadius: 10, overflow: "hidden", maxHeight: 480, overflowY: "auto" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "44px 2fr 1fr 70px 60px 1.2fr", gap: 8, padding: "8px 12px", background: "#fafbfc", borderBottom: "1px solid #f0f0f0", fontSize: 11, color: "#666", fontWeight: 700, position: "sticky", top: 0 }}>
                    <div></div>
                    <div>{t("商品 / Variant")}</div>
                    <div>SKU</div>
                    <div style={{ textAlign: "right" }}>{t("價格")}</div>
                    <div style={{ textAlign: "right" }}>{t("庫存")}</div>
                    <div>{t("關聯 bizflow")}</div>
                  </div>
                  {filtered.map(p => (
                    <div key={p.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "44px 2fr 1fr 70px 60px 1.2fr", gap: 8, padding: "10px 12px", alignItems: "center", fontSize: 13, background: "#fafbff" }}>
                        {p.featuredImage ? <img src={p.featuredImage} style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6, border: "1px solid #f0f0f0" }} /> : <div style={{ width: 36, height: 36, background: "#f0f2f5", borderRadius: 6 }} />}
                        <div>
                          <div style={{ fontWeight: 700 }}>{p.title}</div>
                          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#888", marginTop: 2 }}>{p.id.replace("gid://shopify/Product/", "")} · {p.handle}</div>
                        </div>
                        <div style={{ fontSize: 11, color: "#888" }}>{p.productType || "—"}</div>
                        <div style={{ textAlign: "right", fontSize: 11, color: "#888" }}>—</div>
                        <div style={{ textAlign: "right", fontWeight: 700, color: (p.totalInventory ?? 0) > 0 ? "#047857" : "#991b1b" }}>{p.totalInventory ?? "—"}</div>
                        <div></div>
                      </div>
                      {p.variants.map(v => {
                        const linked = productByVariantId.get(v.id)
                        return (
                          <div key={v.id} style={{ display: "grid", gridTemplateColumns: "44px 2fr 1fr 70px 60px 1.2fr", gap: 8, padding: "6px 12px", alignItems: "center", fontSize: 12, color: "#555" }}>
                            <div></div>
                            <div style={{ paddingLeft: 12, color: "#666" }}>↳ {v.title === "Default Title" ? p.title : v.title}</div>
                            <div style={{ fontFamily: "monospace", fontSize: 11, color: v.sku ? "#3b58d4" : "#bbb" }}>{v.sku || t("無 SKU")}</div>
                            <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: 11 }}>{v.price ? `HK$${v.price}` : "—"}</div>
                            <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: 11, color: (v.inventoryQuantity ?? 0) > 0 ? "#047857" : "#991b1b" }}>{v.inventoryQuantity ?? "—"}</div>
                            <div>
                              {linked ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <span style={{ padding: "2px 6px", background: "#d1fae5", color: "#047857", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>✓</span>
                                  <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={linked.name}>{linked.internal_code || linked.name}</span>
                                  <button onClick={() => handleUnlink(linked.id)} title={t("解除關聯")} style={{ padding: "2px 6px", background: "#fef2f2", color: "#991b1b", border: "none", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>×</button>
                                </div>
                              ) : (
                                <button onClick={() => { if (!unlocked || !pwd) { alert(t('請先解鎖')); return } setLinkModal({ variant: v, product: p }) }} disabled={!unlocked} style={{ padding: "4px 8px", background: unlocked ? "#eef2ff" : "#f5f5f5", color: unlocked ? "#3b58d4" : "#aaa", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: unlocked ? "pointer" : "not-allowed" }}>+ {t("關聯")}</button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                  {filtered.length === 0 && (
                    <div style={{ padding: 24, textAlign: "center", color: "#aaa", fontSize: 12 }}>{t("沒有匹配的商品")}</div>
                  )}
                </div>
              </div>
            )
          })()}
          {/* 用 line item 映射倒推 link */}
          {productList && (
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px dashed #e0e6ff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>{t("用 line item 映射倒推關聯")}</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{t("讀 line_item_aliases 表，用 alias_name 文本匹配 Shopify variant 自動 link。套裝/skip alias 跳過。")}</div>
                </div>
                {!aliasLinkPreview && !aliasLinkResult && (
                  <button onClick={handleAliasDryRun} disabled={aliasLinking} style={{ padding: "10px 18px", background: aliasLinking ? "#a8b8e8" : "#fff", color: aliasLinking ? "#fff" : "#3b58d4", border: "1px solid " + (aliasLinking ? "#a8b8e8" : "#c6d3ff"), borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: aliasLinking ? "not-allowed" : "pointer" }}>
                    {aliasLinking ? t("計算中...") : t("預覽倒推計劃")}
                  </button>
                )}
              </div>
              {aliasLinkError && <div style={{ marginTop: 8, padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 11, color: "#991b1b", fontFamily: "monospace", wordBreak: "break-all" }}>{aliasLinkError}</div>}
              {aliasLinkPreview && (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
                    <div style={{ padding: 12, background: "#d1fae5", borderRadius: 8, textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: "#047857" }}>{aliasLinkPreview.stats.link}</div>
                      <div style={{ fontSize: 11, color: "#666" }}>{t("可自動 link")}</div>
                    </div>
                    <div style={{ padding: 12, background: "#fef3c7", borderRadius: 8, textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: "#92400e" }}>{aliasLinkPreview.stats.skip}</div>
                      <div style={{ fontSize: 11, color: "#666" }}>{t("跳過")}</div>
                    </div>
                    <div style={{ padding: 12, background: "#f5f5f5", borderRadius: 8, textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: "#555" }}>{aliasLinkPreview.stats.total}</div>
                      <div style={{ fontSize: 11, color: "#666" }}>{t("總計")}</div>
                    </div>
                  </div>
                  <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, overflow: "hidden", maxHeight: 360, overflowY: "auto", marginBottom: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "60px 1.3fr 1fr 1.3fr 90px", gap: 8, padding: "8px 12px", background: "#fafbfc", borderBottom: "1px solid #f0f0f0", fontSize: 11, color: "#666", fontWeight: 700, position: "sticky", top: 0 }}>
                      <div>{t("動作")}</div>
                      <div>alias_name</div>
                      <div>{t("bizflow 商品")}</div>
                      <div>{t("→ Shopify variant")}</div>
                      <div>SKU</div>
                    </div>
                    {aliasLinkPreview.plan.map((row, idx) => {
                      const isLink = row.action === "link"
                      return (
                        <div key={idx} style={{ display: "grid", gridTemplateColumns: "60px 1.3fr 1fr 1.3fr 90px", gap: 8, padding: "8px 12px", borderBottom: "1px solid #f5f5f5", alignItems: "center", fontSize: 12, background: isLink ? "transparent" : "#fafafa" }}>
                          <div>
                            <span style={{ padding: "2px 8px", background: isLink ? "#d1fae5" : "#fef3c7", color: isLink ? "#047857" : "#92400e", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>{isLink ? t("link") : t("跳過")}</span>
                          </div>
                          <div style={{ fontSize: 11 }}>{row.alias_name}</div>
                          <div style={{ fontSize: 11 }}>
                            {row.bizflow_name ? (
                              <>
                                <div>{row.bizflow_name}</div>
                                {row.bizflow_internal_code && <div style={{ fontFamily: "monospace", fontSize: 10, color: "#888" }}>{row.bizflow_internal_code}</div>}
                              </>
                            ) : "—"}
                          </div>
                          <div style={{ fontSize: 11 }}>
                            {isLink ? row.shopify_display_name : <span style={{ color: "#92400e" }}>{row.reason}</span>}
                          </div>
                          <div style={{ fontFamily: "monospace", fontSize: 10, color: row.shopify_sku ? "#3b58d4" : "#bbb" }}>{row.shopify_sku || "—"}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => setAliasLinkPreview(null)} style={{ padding: "10px 18px", background: "#f5f5f5", color: "#666", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t("取消")}</button>
                    <button onClick={handleAliasConfirm} disabled={aliasLinking || aliasLinkPreview.stats.link === 0} style={{ padding: "10px 22px", background: aliasLinking || aliasLinkPreview.stats.link === 0 ? "#a8b8e8" : "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: aliasLinking || aliasLinkPreview.stats.link === 0 ? "not-allowed" : "pointer" }}>
                      {aliasLinking ? t("執行中...") : `${t("確認 link")} ${aliasLinkPreview.stats.link} ${t("條")}`}
                    </button>
                  </div>
                </div>
              )}
              {aliasLinkResult && (
                <div style={{ padding: 14, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10 }}>
                  <div style={{ fontWeight: 800, color: "#047857", marginBottom: 6 }}>✓ {t("批量關聯完成")}：{aliasLinkResult.results.linked} {t("條")}</div>
                  {aliasLinkResult.results.errors?.length > 0 && (
                    <div style={{ marginTop: 8, padding: 8, background: "#fef2f2", borderRadius: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#991b1b", marginBottom: 4 }}>{aliasLinkResult.results.errors.length} {t("條錯誤")}</div>
                      {aliasLinkResult.results.errors.slice(0, 10).map((err, i) => (
                        <div key={i} style={{ fontSize: 10, color: "#991b1b", fontFamily: "monospace", wordBreak: "break-all" }}>{err}</div>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setAliasLinkResult(null)} style={{ marginTop: 10, padding: "6px 14px", background: "#fff", color: "#3b58d4", border: "1px solid #c6d3ff", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>{t("關閉")}</button>
                </div>
              )}
            </div>
          )}

          {/* 同步區 */}
          {productList && (
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px dashed #e0e6ff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>{t("同步到 bizflow")}</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{t("先預覽會做什麼、確認後才寫入")}</div>
                </div>
                {!syncPreview && !syncResult && (
                  <button onClick={handleSyncDryRun} disabled={syncing} style={{ padding: "10px 18px", background: syncing ? "#a8b8e8" : "#fff", color: syncing ? "#fff" : "#3b58d4", border: "1px solid " + (syncing ? "#a8b8e8" : "#c6d3ff"), borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: syncing ? "not-allowed" : "pointer" }}>
                    {syncing ? t("計算中...") : t("預覽同步計劃")}
                  </button>
                )}
              </div>
              {syncError && (
                <div style={{ marginTop: 8, padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 11, color: "#991b1b", fontFamily: "monospace", wordBreak: "break-all" }}>{syncError}</div>
              )}
              {syncPreview && (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
                    <div style={{ padding: 12, background: "#eef2ff", borderRadius: 8, textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: "#3b58d4" }}>{syncPreview.stats.update}</div>
                      <div style={{ fontSize: 11, color: "#666" }}>{t("匹配更新")}</div>
                    </div>
                    <div style={{ padding: 12, background: "#fef3c7", borderRadius: 8, textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: "#92400e" }}>{syncPreview.stats.unlinked}</div>
                      <div style={{ fontSize: 11, color: "#666" }}>{t("未關聯（請手動 link）")}</div>
                    </div>
                    <div style={{ padding: 12, background: "#fee2e2", borderRadius: 8, textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: "#991b1b" }}>{syncPreview.stats.skip}</div>
                      <div style={{ fontSize: 11, color: "#666" }}>{t("跳過")}</div>
                    </div>
                    <div style={{ padding: 12, background: "#f5f5f5", borderRadius: 8, textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: "#555" }}>{syncPreview.stats.total}</div>
                      <div style={{ fontSize: 11, color: "#666" }}>{t("總計")}</div>
                    </div>
                  </div>
                  <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, overflow: "hidden", maxHeight: 360, overflowY: "auto", marginBottom: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 1.2fr 130px", gap: 8, padding: "8px 12px", background: "#fafbfc", borderBottom: "1px solid #f0f0f0", fontSize: 11, color: "#666", fontWeight: 700, position: "sticky", top: 0 }}>
                      <div>{t("動作")}</div>
                      <div>SKU</div>
                      <div>{t("商品名")}</div>
                      <div>{t("價格")}</div>
                    </div>
                    {syncPreview.plan.map((row, idx) => {
                      const bg = row.action === "update" ? "#eef2ff" : row.action === "unlinked" ? "#fef3c7" : "#fee2e2";
                      const fg = row.action === "update" ? "#3b58d4" : row.action === "unlinked" ? "#92400e" : "#991b1b";
                      const label = row.action === "update" ? t("更新") : row.action === "unlinked" ? t("未關聯") : t("跳過");
                      return (
                        <div key={idx} style={{ display: "grid", gridTemplateColumns: "70px 1fr 1.2fr 130px", gap: 8, padding: "8px 12px", borderBottom: "1px solid #f5f5f5", alignItems: "center", fontSize: 12 }}>
                          <div><span style={{ padding: "2px 8px", background: bg, color: fg, borderRadius: 4, fontSize: 10, fontWeight: 700 }}>{label}</span></div>
                          <div style={{ fontFamily: "monospace", fontSize: 11, color: row.shopify_sku ? "#3b58d4" : "#bbb" }}>{row.shopify_sku || (row.reason || "—")}</div>
                          <div>
                            <div>{row.title}</div>
                            {row.bizflow_current_name && row.bizflow_current_name !== row.title && (
                              <div style={{ fontSize: 10, color: "#888" }}>{t("原")}：{row.bizflow_current_name}</div>
                            )}
                          </div>
                          <div style={{ fontFamily: "monospace", fontSize: 11 }}>{row.price ? `HK$${row.price}` : "—"}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => setSyncPreview(null)} style={{ padding: "10px 18px", background: "#f5f5f5", color: "#666", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t("取消")}</button>
                    <button onClick={handleSyncConfirm} disabled={syncing} style={{ padding: "10px 22px", background: syncing ? "#a8b8e8" : "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: syncing ? "not-allowed" : "pointer" }}>
                      {syncing ? t("執行中...") : t("確認執行同步")}
                    </button>
                  </div>
                </div>
              )}
              {syncResult && (
                <div style={{ padding: 14, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10 }}>
                  <div style={{ fontWeight: 800, color: "#047857", marginBottom: 8 }}>✓ {t("同步完成")}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 12 }}>{t("更新")}：<b>{syncResult.results.updated}</b></div>
                    <div style={{ fontSize: 12 }}>{t("未關聯")}：<b>{syncResult.results.unlinked}</b></div>
                    <div style={{ fontSize: 12 }}>{t("跳過")}：<b>{syncResult.results.skipped}</b></div>
                  </div>
                  {syncResult.results.errors && syncResult.results.errors.length > 0 && (
                    <div style={{ marginTop: 8, padding: 8, background: "#fef2f2", borderRadius: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#991b1b", marginBottom: 4 }}>{syncResult.results.errors.length} {t("條錯誤")}</div>
                      {syncResult.results.errors.slice(0, 10).map((err, i) => (
                        <div key={i} style={{ fontSize: 10, color: "#991b1b", fontFamily: "monospace", wordBreak: "break-all" }}>{err}</div>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setSyncResult(null)} style={{ marginTop: 10, padding: "6px 14px", background: "#fff", color: "#3b58d4", border: "1px solid #c6d3ff", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>{t("關閉")}</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {linkModal && (() => {
        const { variant, product } = linkModal
        const q = linkSearch.trim().toLowerCase()
        const all = (products || []).filter(p => p.status !== 'discontinued' && p.category !== '_archived')
        const matches = (p) => !q || (p.name || "").toLowerCase().includes(q) || (p.internal_code || "").toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q)
        // 按父子分组：父 product（parent_product_id IS NULL）下面挂子（parent_product_id === parent.id）
        const parents = all.filter(p => !p.parent_product_id).sort((a, b) => (a.internal_code || "").localeCompare(b.internal_code || ""))
        const groups = parents.map(parent => {
          const children = all.filter(c => c.parent_product_id === parent.id).sort((a, b) => (a.internal_code || "").localeCompare(b.internal_code || ""))
          const visibleChildren = children.filter(matches)
          const parentMatches = matches(parent)
          // 父或任一子匹配 → 整组可见
          const visible = parentMatches || visibleChildren.length > 0
          // 如果父匹配、子没匹配但有子 → 展开所有子；否则展开匹配的子
          const showChildren = visibleChildren.length > 0 ? visibleChildren : (parentMatches ? children : [])
          return { parent, children: showChildren, hasChildren: children.length > 0, visible }
        }).filter(g => g.visible)
        const totalSelectable = groups.reduce((s, g) => s + (g.hasChildren ? g.children.length : 1), 0)
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
            <div style={{ background: "#fff", borderRadius: 16, width: 640, maxWidth: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 22px", borderBottom: "1px solid #f0f0f0" }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{t("關聯 Shopify variant 到 bizflow 商品")}</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                    {product.title}{variant.title !== "Default Title" && ` · ${variant.title}`} · SKU <code style={{ fontFamily: "monospace", color: "#3b58d4" }}>{variant.sku || t("無 SKU")}</code>
                  </div>
                </div>
                <button onClick={() => { setLinkModal(null); setLinkSearch('') }} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
              <div style={{ padding: "12px 22px", borderBottom: "1px solid #f0f0f0" }}>
                <input value={linkSearch} onChange={e => setLinkSearch(e.target.value)} autoFocus placeholder={t("搜尋 bizflow 商品 / internal_code / 類別...")} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 22px" }}>
                {groups.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#aaa", fontSize: 12 }}>{t("沒有匹配的 bizflow 商品")}</div>}
                {groups.map(g => {
                  // 渲染一行（共用样式）
                  const renderRow = (p, isChild) => {
                    const alreadyLinked = p.shopify_variant_id === variant.id
                    const linkedToOther = p.shopify_variant_id && p.shopify_variant_id !== variant.id
                    const disabled = alreadyLinked || linkedToOther
                    return (
                      <div key={p.id} onClick={() => !disabled && !linking && handleLink(p.id)} style={{ display: "grid", gridTemplateColumns: "120px 1fr 100px", gap: 12, padding: isChild ? "8px 12px 8px 28px" : "10px 12px", borderBottom: "1px solid #f5f5f5", alignItems: "center", cursor: disabled ? "default" : "pointer", fontSize: 13, background: alreadyLinked ? "#f0fdf4" : linkedToOther ? "#fafafa" : "transparent", opacity: linkedToOther ? 0.55 : 1 }}
                        onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = "#fafbff" }}
                        onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = "transparent" }}>
                        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#666", display: "flex", alignItems: "center", gap: 4 }}>
                          {isChild && <span style={{ color: "#bbb" }}>↳</span>}
                          {p.internal_code || "—"}
                        </div>
                        <div>
                          <div style={{ fontWeight: isChild ? 500 : 700 }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{p.category || t("未分類")} · HK${p.price || 0}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          {alreadyLinked ? <span style={{ fontSize: 11, color: "#047857", fontWeight: 700 }}>✓ {t("已關聯")}</span> :
                           linkedToOther ? <span style={{ fontSize: 10, color: "#92400e" }}>{t("已關聯其他")}</span> :
                           <span style={{ fontSize: 11, color: "#3b58d4", fontWeight: 700 }}>{t("選擇 →")}</span>}
                        </div>
                      </div>
                    )
                  }
                  // 有子 → 父行不可点（只 header）+ 子可点；无子 → 父直接可点
                  if (g.hasChildren) {
                    return (
                      <div key={g.parent.id}>
                        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 100px", gap: 12, padding: "10px 12px", background: "#f8fafc", borderBottom: "1px solid #f0f0f0", alignItems: "center", fontSize: 12 }}>
                          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#888", fontWeight: 700 }}>{g.parent.internal_code}</div>
                          <div style={{ fontWeight: 700, color: "#555" }}>{g.parent.name} <span style={{ fontSize: 10, color: "#aaa", fontWeight: 400 }}>· {g.children.length} {t("個規格")}</span></div>
                          <div style={{ textAlign: "right", fontSize: 10, color: "#aaa" }}>{t("選擇下方規格")}</div>
                        </div>
                        {g.children.map(c => renderRow(c, true))}
                      </div>
                    )
                  }
                  return renderRow(g.parent, false)
                })}
              </div>
              <div style={{ padding: "12px 22px", borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, color: "#888" }}>{totalSelectable} {t("個可選")} {linking && `· ${t('關聯中...')}`}</div>
                <button onClick={() => { setLinkModal(null); setLinkSearch('') }} style={{ padding: "8px 14px", background: "#f5f5f5", color: "#666", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>{t("取消")}</button>
              </div>
            </div>
          </div>
        )
      })()}
      <div style={{ background: "#fafbff", borderRadius: 12, border: "1px dashed #c6d3ff", padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#3b58d4", marginBottom: 8 }}>{t("如何取得 Access Token")}</div>
        <ol style={{ fontSize: 12, color: "#555", margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>{t("登入 Shopify admin → Settings → Apps and sales channels")}</li>
          <li>{t("頂部「Develop apps」→ Create an app（命名 BizFlow Sync）")}</li>
          <li>{t("Configure Admin API scopes：勾 read_products / read_inventory / read_locations / read_orders / read_customers")}</li>
          <li>{t("Install app → 複製 Admin API access token（shpat_xxx 開頭）貼回此處")}</li>
        </ol>
      </div>
    </div>
  )
}
