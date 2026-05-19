import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabaseClient.js'
import { c, radius, S, tcell } from '../styles.jsx'
import { useT } from '../i18n.jsx'

// admin 视角：employees 传完整列表，lockedEmpId=null（可下拉切换销售）
// 销售视角：employees 传 [me]，lockedEmpId=me.id（强制只看自己）
export default function CommissionView({ employees, me, lockedEmpId = null }) {
  const { t } = useT()
  const qInv = useQuery({
    queryKey: ['commission', 'invoices', lockedEmpId || 'all'],
    queryFn: async () => {
      let q = supabase.from('invoices').select('id, salesperson_id, commission_amount, date, total, status, items, notes').not('salesperson_id', 'is', null).order('date', { ascending: false })
      if (lockedEmpId) q = q.eq('salesperson_id', lockedEmpId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    refetchInterval: 60000,
  })
  const invoices = qInv.data || []
  const sales = employees.filter(e => e.role === '銷售')

  const [empFilter, setEmpFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')

  const filtered = invoices.filter(i => {
    if (!lockedEmpId && empFilter !== 'all' && i.salesperson_id !== empFilter) return false
    if (monthFilter !== 'all') { const ym = (i.date || '').slice(0, 7); if (ym !== monthFilter) return false }
    return true
  })

  const months = Array.from(new Set(invoices.map(i => (i.date || '').slice(0, 7)).filter(Boolean))).sort().reverse()
  const totalCommission = filtered.reduce((s, i) => s + (i.commission_amount || 0), 0)

  if (qInv.isLoading) return <div style={{ padding: 40, color: c.textFaint, fontSize: 13 }}>{t('載入中…')}</div>

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>{lockedEmpId ? t('我的佣金') : t('銷售佣金')}</h1>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {!lockedEmpId && (
          <select value={empFilter} onChange={e => setEmpFilter(e.target.value)} style={{ ...S.input, marginBottom: 0, width: 'auto', fontSize: 12, padding: '6px 8px' }}>
            <option value="all">{t('所有銷售')}</option>
            {sales.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
        <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={{ ...S.input, marginBottom: 0, width: 'auto', fontSize: 12, padding: '6px 8px' }}>
          <option value="all">{t('所有月份')}</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', padding: '6px 14px', background: c.accentBg, borderRadius: radius.sm, fontSize: 14, fontWeight: 700, color: c.accent }}>
          {t('總佣金：')}HKD ${totalCommission.toLocaleString()}
        </div>
      </div>
      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: c.bg, borderBottom: `1px solid ${c.border}` }}>
              <th style={tcell('left')}>{t('日期')}</th>
              <th style={tcell('left')}>{t('銷售')}</th>
              <th style={tcell('left')}>{t('發票 #')}</th>
              <th style={tcell('right')}>{t('金額')}</th>
              <th style={tcell('right')}>{t('佣金')}</th>
              <th style={tcell('left')}>{t('狀態')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(inv => {
              const sp = employees.find(e => e.id === inv.salesperson_id)
              return (
                <tr key={inv.id} style={{ borderBottom: `1px solid ${c.border}` }}>
                  <td style={{ padding: '8px 12px' }}>{inv.date || '—'}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{sp?.name || '—'}</td>
                  <td style={{ padding: '8px 12px', color: c.textMuted }}>DC{String(inv.id).slice(-6)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>{(inv.total || 0).toLocaleString()}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: c.accent }}>{(inv.commission_amount || 0).toLocaleString()}</td>
                  <td style={{ padding: '8px 12px', fontSize: 11, color: c.textMuted }}>{inv.status || '—'}</td>
                </tr>
              )
            })}
            {filtered.length === 0 && <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: c.textFaint }}>{t('無紀錄')}</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: c.textFaint, marginTop: 8 }}>{t('佣金規則沿用 bizflow（轉插 600 HKD/件 cutoff 5/9）。要改規則請聯繫 admin。')}</div>
    </div>
  )
}
