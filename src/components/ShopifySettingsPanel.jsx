import React, { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'

// Shopify 集成設置面板（產品 tab → Shopify API 子 tab）
// access_token 由 Edge Function `shopify-settings` 加密讀寫；migration 059 column-level lock 攔 anon/authenticated 直拉
// 解鎖密碼複用 wa_settings.admin_password（同一個 admin 密碼、UI 體驗一致）

async function callEdge(payload) {
  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/shopify-settings`, {
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
  const { shopifySettings, setShopifySettings, isBfAdmin } = useAppContext()
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
      const d = await callEdge({ action: 'unlock', pwd })
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
      await callEdge({ action: 'save', pwd, shop_domain: domainDraft.trim(), access_token: tokenDraft.trim() })
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
    setBusy(true)
    setTestResult(null)
    try {
      const d = await callEdge({ action: 'test-connection', pwd, shop_domain: domainDraft.trim(), access_token: tokenDraft.trim() })
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
                    <div style={{ fontWeight: 700, color: "#047857", marginBottom: 4 }}>✓ {t("連接成功")}</div>
                    <div style={{ color: "#555" }}>
                      {t("店舖")}：<b>{testResult.shop?.name || "—"}</b> · {testResult.shop?.myshopifyDomain || ""} · {t("貨幣")} {testResult.shop?.currencyCode || "—"}
                    </div>
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
