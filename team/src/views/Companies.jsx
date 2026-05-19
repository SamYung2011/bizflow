import React, { useState, useMemo, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabaseClient.js'
import { c, radius, S, fmtDateTime, tcell } from '../styles.jsx'
import { useT } from '../i18n.jsx'

export default function CompaniesView({ data }) {
  const { t } = useT()
  const { companies, employees } = data
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const empCountByCompany = useMemo(() => {
    const m = new Map()
    for (const e of employees) {
      if (!e.company_id) continue
      m.set(e.company_id, (m.get(e.company_id) || 0) + 1)
    }
    return m
  }, [employees])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'companies'] })

  const add = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    const { error } = await supabase.from('companies').upsert({ name }, { onConflict: 'name' })
    setBusy(false)
    if (error) return alert(t('新建公司失敗：') + error.message)
    setNewName('')
    refresh()
  }

  const rename = async (co, nextName) => {
    const v = (nextName || '').trim()
    if (!v || v === co.name) return
    const { error } = await supabase.from('companies').update({ name: v }).eq('id', co.id)
    if (error) return alert(t('改名失敗：') + error.message)
    refresh()
  }

  const del = async (co) => {
    const count = empCountByCompany.get(co.id) || 0
    if (count > 0) return alert('「' + co.name + '」' + t('還有') + ' ' + count + ' ' + t('個員工，無法刪除。先把員工挪到別的公司或刪掉員工。'))
    if (!confirm(t('確定刪除') + '「' + co.name + '」？')) return
    const { error } = await supabase.from('companies').delete().eq('id', co.id)
    if (error) return alert(t('刪除失敗：') + error.message)
    refresh()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{t('公司管理')} <span style={{ fontSize: 12, color: c.textFaint, fontWeight: 400 }}>{companies.length}</span></h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder={t('新公司名稱')} style={{ ...S.input, marginBottom: 0, fontSize: 12, padding: '6px 10px', width: 200 }} />
          <button onClick={add} disabled={busy || !newName.trim()} style={{ ...S.btnPrimary, opacity: (busy || !newName.trim()) ? 0.4 : 1 }}>＋ {t('新增')}</button>
        </div>
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: c.bg, borderBottom: `1px solid ${c.border}` }}>
              <th style={tcell('left')}>{t('名稱')}</th>
              <th style={tcell('left')}>{t('員工數')}</th>
              <th style={tcell('left')}>{t('創建時間')}</th>
              <th style={tcell('right')}></th>
            </tr>
          </thead>
          <tbody>
            {companies.length === 0 && <tr><td colSpan={4} style={{ padding: 30, textAlign: 'center', color: c.textFaint }}>{t('無公司')}</td></tr>}
            {companies.map(co => (
              <CompanyRow key={co.id} co={co} count={empCountByCompany.get(co.id) || 0} rename={rename} del={del} />
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: c.textFaint, marginTop: 8 }}>{t('提示：刪除公司前要把其下員工挪走或刪除。「Honnmono」是 admin 內部公司，慎刪。')}</div>
    </div>
  )
}

function CompanyRow({ co, count, rename, del }) {
  const { t } = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(co.name)
  useEffect(() => setDraft(co.name), [co.id, co.name])

  return (
    <tr style={{ borderBottom: `1px solid ${c.border}` }}>
      <td style={{ padding: '8px 12px', fontWeight: 600 }}>
        {editing ? <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && (rename(co, draft), setEditing(false))} style={{ ...S.input, marginBottom: 0, fontSize: 12 }} autoFocus /> : co.name}
      </td>
      <td style={{ padding: '8px 12px', color: count > 0 ? c.text : c.textFaint }}>{count}</td>
      <td style={{ padding: '8px 12px', color: c.textMuted, fontSize: 12 }}>{co.created_at ? fmtDateTime(co.created_at) : '—'}</td>
      <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {editing ? (
          <>
            <button onClick={() => { rename(co, draft); setEditing(false) }} style={{ ...S.btnPrimary, padding: '4px 10px', fontSize: 11, marginRight: 4 }}>{t('保存')}</button>
            <button onClick={() => { setDraft(co.name); setEditing(false) }} style={{ ...S.btnGhostSm, padding: '4px 8px' }}>{t('取消')}</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} style={{ ...S.btnGhostSm, padding: '4px 8px', marginRight: 4 }}>{t('改名')}</button>
            <button onClick={() => del(co)} disabled={count > 0} style={{ background: 'none', border: 'none', color: count > 0 ? c.textFaint : c.red, fontSize: 11, cursor: count > 0 ? 'not-allowed' : 'pointer', padding: 4 }}>{t('刪除')}</button>
          </>
        )}
      </td>
    </tr>
  )
}
