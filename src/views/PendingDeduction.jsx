import React, { useMemo, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'
import { Icon } from '../components/Icon.jsx'
import { fmtInvNum, invoiceSource, formatNotes } from '../lib/invoiceHelpers.js'
import InvoiceEditModal from '../components/InvoiceEditModal.jsx'

/**
 * 待扣庫存清單 — Phase 1 人工審核期入口
 *
 * 列出所有「應扣但沒扣」的發票（含已 Paid 進來的 Shopify 同步單、補錄歷史單等）。
 * 點條目 → 觸發 handleMarkPaid → 彈現有 mark paid modal → 用戶看扣減計劃審核。
 *
 * 條件：legacy_skip_deduct != true AND 非百老匯 AND status='Paid' AND 沒有對應 inventory_movements
 * （百老匯渠道發票不扣本地庫存，永遠不會有 movements 記錄，列出來只會死循環）
 *
 * Props: handleMarkPaid — App.jsx 傳入，撕掉了「已 Paid 跳過」攔截後可重用
 */
export function PendingDeductionView({ handleMarkPaid }) {
  const { t } = useT()
  const { invoices, customers } = useAppContext()
  const [deductedIds, setDeductedIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [viewingInvoice, setViewingInvoice] = useState(null)  // 點發票號彈編輯 modal 看詳情

  // 拉所有已扣過的 invoice_id（從 inventory_movements 反查）
  useEffect(() => {
    setLoading(true)
    supabase
      .from('inventory_movements')
      .select('invoice_id')
      .not('invoice_id', 'is', null)
      .then(({ data, error }) => {
        if (!error && data) {
          setDeductedIds(new Set(data.map(r => r.invoice_id)))
        }
        setLoading(false)
      })
  }, [])

  const pending = useMemo(() => {
    return invoices
      .filter(inv => {
        if (inv.legacy_skip_deduct === true) return false
        if ((inv.notes || '').includes('__BROADWAY__')) return false
        if ((inv.status || '').trim().toLowerCase() !== 'paid') return false
        if (deductedIds.has(inv.id)) return false
        return true
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }, [invoices, deductedIds])

  const customerById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{t('待扣庫存')}</h1>
        <span style={{ background: '#fef3c7', color: '#92400e', padding: '4px 10px', borderRadius: 12, fontSize: 13, fontWeight: 700 }}>
          {loading ? '…' : pending.length}
        </span>
      </div>

      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#1e40af', lineHeight: 1.7 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('人工審核期')}</div>
        <div>{t('以下發票 status 為 Paid 但未扣庫存，點「審核扣減」逐張查看扣減計劃並確認。確認後寫入 audit 表，一個月後根據統計切全自動。')}</div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#888', fontSize: 13, padding: 40 }}>{t('加載中')}…</div>
      ) : pending.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#aaa', fontSize: 14, padding: 60, background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0' }}>
          <Icon name="check" size={32} />
          <div style={{ marginTop: 12 }}>{t('無待處理扣減')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pending.map(inv => {
            const cust = inv.customer_id ? customerById.get(inv.customer_id) : null
            const custName = cust?.name || inv.customer_name_snapshot || '—'
            const custPhone = cust?.phone || cust?.phone_mainland || ''
            const src = invoiceSource(inv)
            return (
              <div key={inv.id} style={{ background: '#fff', borderRadius: 14, padding: '18px 22px', border: '1px solid #f0f0f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)', display: 'flex', alignItems: 'center', gap: 18 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => setViewingInvoice(inv)}
                      title={t('查看發票詳情')}
                      style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: '#6382ff', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      {fmtInvNum(inv)}
                    </button>
                    <span style={{ fontSize: 10, fontWeight: 700, color: src.color, background: src.bg, padding: '2px 7px', borderRadius: 6 }}>{t(src.key)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>
                    {custPhone ? `${custPhone} · ` : ''}{custName} · {inv.date || t('日期未知')}{formatNotes(inv.notes) ? ` · ${formatNotes(inv.notes)}` : ''}
                  </div>
                  {Array.isArray(inv.items) && inv.items.slice(0, 2).map((item, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#999' }}>{item.name} ×{item.qty}</div>
                  ))}
                  {Array.isArray(inv.items) && inv.items.length > 2 && (
                    <div style={{ fontSize: 11, color: '#bbb', fontStyle: 'italic' }}>... {t('還有')} {inv.items.length - 2} {t('項')}</div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>HKD${Number(inv.total || 0).toLocaleString()}</div>
                  <button
                    onClick={() => handleMarkPaid(inv)}
                    style={{ background: '#6382ff', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {t('審核扣減')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 點發票號彈出編輯 modal 查看完整內容（共用組件，view 自管 state） */}
      <InvoiceEditModal
        invoice={viewingInvoice}
        onClose={() => setViewingInvoice(null)}
      />
    </div>
  )
}
