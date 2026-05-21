import React, { useMemo, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'
import { Icon } from '../components/Icon.jsx'
import { fmtInvNum } from '../lib/invoiceHelpers.js'
import InvoiceEditModal from '../components/InvoiceEditModal.jsx'

/**
 * 待扣庫存清單 — Phase 1 人工審核期入口
 *
 * 列出所有「應扣但沒扣」的發票（含已 Paid 進來的 Shopify 同步單、補錄歷史單等）。
 * 點條目 → 觸發 handleMarkPaid → 彈現有 mark paid modal → 用戶看扣減計劃審核。
 *
 * 條件：legacy_skip_deduct != true AND status='Paid' AND 沒有對應 inventory_movements
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
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 120px 1fr 180px 100px 120px', gap: 12, padding: '12px 16px', background: '#fafbfc', fontSize: 11, color: '#666', fontWeight: 600, borderBottom: '1px solid #f0f0f0' }}>
            <div>{t('發票號')}</div>
            <div>{t('日期')}</div>
            <div>{t('產品')}</div>
            <div>{t('客戶')}</div>
            <div style={{ textAlign: 'right' }}>{t('金額')}</div>
            <div style={{ textAlign: 'right' }}>{t('動作')}</div>
          </div>
          {pending.map(inv => {
            const itemsStr = Array.isArray(inv.items)
              ? inv.items.map(it => it?.name || '?').filter(Boolean).join(' / ')
              : '—'
            const cust = inv.customer_id ? customerById.get(inv.customer_id) : null
            const custName = cust?.name || inv.customer_name_snapshot || '—'
            return (
              <div key={inv.id} style={{ display: 'grid', gridTemplateColumns: '110px 120px 1fr 180px 100px 120px', gap: 12, padding: '12px 16px', borderBottom: '1px solid #f5f5f5', alignItems: 'center', fontSize: 13 }}>
                <div>
                  <button
                    onClick={() => setViewingInvoice(inv)}
                    title={t('查看發票詳情')}
                    style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'monospace', fontSize: 13, color: '#6382ff', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {fmtInvNum(inv)}
                  </button>
                </div>
                <div style={{ color: '#666', fontSize: 12 }}>{inv.date || '—'}</div>
                <div style={{ color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={itemsStr}>{itemsStr}</div>
                <div style={{ color: '#666', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{custName}</div>
                <div style={{ textAlign: 'right', color: '#555', fontWeight: 600 }}>HK${Number(inv.total || 0).toLocaleString()}</div>
                <div style={{ textAlign: 'right' }}>
                  <button
                    onClick={() => handleMarkPaid(inv)}
                    style={{ background: '#6382ff', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
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
