import React, { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabaseClient.js'
import { c, S, Field } from '../styles.jsx'
import { useT } from '../i18n.jsx'

// ====================  PROFILE (個人資料 + 修改密碼 modal，所有角色用)  ====================
//   RLS employees_self_update 允許本人改：name/role/phone/email/note/show_update_log
//   鎖：is_admin / company_id / kind / active / user_id（管理員管）
export default function ProfileModal({ me, data, onClose }) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(me)
  const [savingField, setSavingField] = useState(null)
  useEffect(() => setDraft(me), [me.id])

  // 跨公司加入申請
  const companies = data?.companies || []
  const empCompanies = data?.empCompanies || []
  const joinPendings = data?.joinPendings || []
  const myJoinPendings = joinPendings.filter(p => p.employee_id === me.id)
  const myBindingIds = new Set(empCompanies.filter(ec => ec.employee_id === me.id).map(ec => ec.company_id))
  const myPendingIds = new Set(myJoinPendings.filter(p => p.approved == null).map(p => p.company_id))
  const joinableCompanies = companies.filter(co => !myBindingIds.has(co.id) && !myPendingIds.has(co.id))
  const [joinCompanyId, setJoinCompanyId] = useState('')
  const [joinNote, setJoinNote] = useState('')
  const [joinBusy, setJoinBusy] = useState(false)
  const submitJoin = async () => {
    if (!joinCompanyId) return
    setJoinBusy(true)
    const { error } = await supabase.from('company_join_pending').insert({
      employee_id: me.id,
      company_id: joinCompanyId,
      note: joinNote.trim() || null,
    })
    setJoinBusy(false)
    if (error) return alert(t('提交失敗：') + error.message)
    setJoinCompanyId(''); setJoinNote('')
    queryClient.invalidateQueries({ queryKey: ['admin', 'company_join_pending'] })
  }
  const cancelJoin = async (pid) => {
    if (!confirm(t('撤回申請？'))) return
    const { error } = await supabase.from('company_join_pending').delete().eq('id', pid)
    if (error) return alert(t('刪除失敗：') + error.message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'company_join_pending'] })
  }

  // 密碼
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [pwOk, setPwOk] = useState(false)

  const save = async (field, value) => {
    const v = (value || '').trim() || null
    if (v === (me[field] || null)) return
    setSavingField(field)
    const { error } = await supabase.from('employees').update({ [field]: v }).eq('id', me.id)
    setSavingField(null)
    if (error) { alert(t('保存失敗：') + error.message); setDraft(prev => ({ ...prev, [field]: me[field] })); return }
    queryClient.invalidateQueries({ queryKey: ['team'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] })
  }

  const changePassword = async () => {
    setPwMsg(''); setPwOk(false)
    if (pw1.length < 6) return setPwMsg(t('密碼至少 6 位'))
    if (pw1 !== pw2) return setPwMsg(t('兩次輸入不一致'))
    setPwBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw1 })
    setPwBusy(false)
    if (error) return setPwMsg(t('修改失敗：') + error.message)
    setPw1(''); setPw2(''); setPwOk(true); setPwMsg(t('密碼已更新'))
    // 同時清掉 must_change_password 標記（若有）
    if (me.must_change_password) {
      await supabase.from('employees').update({ must_change_password: false }).eq('id', me.id)
      queryClient.invalidateQueries({ queryKey: ['team'] })
    }
  }

  const row = (label, field, type = 'text', placeholder = '') => (
    <Field label={label}>
      <input
        type={type}
        value={draft[field] || ''}
        onChange={e => setDraft({ ...draft, [field]: e.target.value })}
        onBlur={e => save(field, e.target.value)}
        placeholder={placeholder}
        style={S.input}
      />
      {savingField === field && <div style={{ fontSize: 10, color: c.textFaint, marginTop: -4 }}>{t('保存中…')}</div>}
    </Field>
  )

  return (
    <div style={S.modal} onClick={onClose}>
      <div style={S.modalCard(440)} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t('個人資料')}</h2>
          <button onClick={onClose} style={S.iconBtn}>×</button>
        </div>
        {row(t('姓名'), 'name', 'text', t('你的名字'))}
        {row(t('職位'), 'role', 'text', t('例如 客服 / 銷售 / 技術'))}
        {row(t('電話'), 'phone', 'tel', '+852')}
        {row('Email', 'email', 'email', 'email@example.com')}
        <Field label={t('備註')}>
          <textarea
            value={draft.note || ''}
            onChange={e => setDraft({ ...draft, note: e.target.value })}
            onBlur={e => save('note', e.target.value)}
            placeholder={t('其他補充…')}
            style={{ ...S.input, minHeight: 60, resize: 'vertical' }}
          />
        </Field>
        <div style={{ fontSize: 10, color: c.textFaint, marginTop: 4, marginBottom: 14 }}>
          {t('公司 / 角色（admin/employee/task）/ 帳號類型等敏感欄位需管理員調整。')}
        </div>

        <div style={{ borderTop: `1px dashed ${c.border}`, paddingTop: 14, marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t('修改密碼')}</div>
          <input type="password" value={pw1} onChange={e => { setPw1(e.target.value); setPwMsg(''); setPwOk(false) }} placeholder={t('新密碼（至少 6 位）')} style={S.input} />
          <input type="password" value={pw2} onChange={e => { setPw2(e.target.value); setPwMsg(''); setPwOk(false) }} placeholder={t('再次輸入')} style={S.input} />
          {pwMsg && <div style={{ fontSize: 12, color: pwOk ? c.green : c.red, marginBottom: 8 }}>{pwOk ? '✓ ' : ''}{pwMsg}</div>}
          <button onClick={changePassword} disabled={pwBusy || !pw1 || !pw2} style={{ ...S.btnPrimary, width: '100%', opacity: (pwBusy || !pw1 || !pw2) ? 0.4 : 1 }}>{pwBusy ? t('處理中…') : t('更新密碼')}</button>
        </div>

        <div style={{ borderTop: `1px dashed ${c.border}`, paddingTop: 14, marginTop: 14, marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t('申請加入其他公司')}</div>
          {myJoinPendings.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {myJoinPendings.map(p => {
                const co = companies.find(co => co.id === p.company_id)
                const status = p.approved == null ? t('審核中') : p.approved ? t('已通過') : t('已拒絕')
                const color = p.approved == null ? c.textMuted : p.approved ? c.green : c.red
                return (
                  <div key={p.id} style={{ fontSize: 12, padding: '6px 10px', background: c.bg, borderRadius: 6, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span><strong>{co?.name || '?'}</strong> · <span style={{ color }}>{status}</span>{p.reject_reason && ` · ${p.reject_reason}`}</span>
                    {p.approved == null && <button onClick={() => cancelJoin(p.id)} style={{ ...S.btnGhostSm, fontSize: 10 }}>{t('撤回')}</button>}
                  </div>
                )
              })}
            </div>
          )}
          {joinableCompanies.length > 0 ? (
            <>
              <select value={joinCompanyId} onChange={e => setJoinCompanyId(e.target.value)} style={S.input}>
                <option value="">{t('選擇要加入的公司…')}</option>
                {joinableCompanies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
              </select>
              <textarea value={joinNote} onChange={e => setJoinNote(e.target.value)} placeholder={t('附言（可選，給審批者看）')} style={{ ...S.input, minHeight: 50 }} />
              <button onClick={submitJoin} disabled={!joinCompanyId || joinBusy} style={{ ...S.btnPrimary, width: '100%', opacity: (!joinCompanyId || joinBusy) ? 0.4 : 1 }}>{joinBusy ? t('處理中…') : t('提交加入申請')}</button>
            </>
          ) : (
            <div style={{ fontSize: 11, color: c.textFaint }}>{t('暫無可申請加入的公司')}</div>
          )}
        </div>

        <button onClick={onClose} style={{ ...S.btnGhost, width: '100%', marginTop: 12 }}>{t('完成')}</button>
      </div>
    </div>
  )
}
