import React, { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabaseClient.js'
import { c, radius, S, Empty, Section, fmtDateTime } from '../styles.jsx'
import { useT } from '../i18n.jsx'

// ====================  ACCOUNT REVIEW  ====================
//   兩個 sub-tab：新註冊（task_pending）+ 跨公司加入（company_join_pending）
export default function AccountReviewView({ data, me, session }) {
  const { t } = useT()
  const { pendings, companies, joinPendings, employees, empCompanies, roles } = data
  const queryClient = useQueryClient()
  const [reviewTab, setReviewTab] = useState('register')  // 'register' | 'join'

  // 給新建 binding 填默認 role_id：本公司的「普通員工」role（migration 054 起每個公司都有）
  const defaultRoleIdFor = (companyId) =>
    roles.find(r => r.company_id === companyId && r.name === '普通員工')?.id || null

  // ========== task_pending（新註冊）==========
  const open = pendings.filter(p => p.approved == null)
  const done = pendings.filter(p => p.approved != null).slice(0, 30)
  const reviewerUid = session.user.id  // task_pending.reviewed_by FK 到 auth.users.id

  // ========== company_join_pending（跨公司加入）==========
  // 過濾：super admin 看所有 / 公司 admin 只看自己管理的公司
  const myAdminCompanyIds = useMemo(
    () => new Set(empCompanies.filter(ec => ec.employee_id === me.id && ec.is_company_admin).map(ec => ec.company_id)),
    [empCompanies, me.id]
  )
  const visibleJoinPendings = useMemo(
    () => me.is_super_admin
      ? joinPendings
      : joinPendings.filter(p => myAdminCompanyIds.has(p.company_id)),
    [joinPendings, me.is_super_admin, myAdminCompanyIds]
  )
  const joinOpen = visibleJoinPendings.filter(p => p.approved == null)
  const joinDone = visibleJoinPendings.filter(p => p.approved != null).slice(0, 30)

  const approveJoin = async (p) => {
    // 1. 先檢查 binding 存不存在（避免靜默吞 duplicate 後標 approved，但實際 INSERT 失敗）
    const { data: existing } = await supabase.from('employee_companies')
      .select('id').eq('employee_id', p.employee_id).eq('company_id', p.company_id).maybeSingle()
    // 2. 不存在才 INSERT。失敗立即彈框 + return（不繼續標 approved）
    if (!existing) {
      const { error: ecErr } = await supabase.from('employee_companies').insert({
        employee_id: p.employee_id,
        company_id: p.company_id,
        is_default: false,
        is_company_admin: false,
        role_id: defaultRoleIdFor(p.company_id),
      })
      if (ecErr) return alert(t('創建綁定失敗：') + ecErr.message)
    }
    // 3. binding 確認在了，才標 approved
    const { error: upErr } = await supabase.from('company_join_pending').update({
      approved: true, reviewed_at: new Date().toISOString(), reviewed_by: reviewerUid,
    }).eq('id', p.id)
    if (upErr) return alert(t('更新失敗：') + upErr.message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'company_join_pending'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_companies'] })
  }
  const rejectJoin = async (p) => {
    const reason = prompt(t('拒絕理由（可選）：')) || null
    await supabase.from('company_join_pending').update({ approved: false, reject_reason: reason, reviewed_at: new Date().toISOString(), reviewed_by: reviewerUid }).eq('id', p.id)
    queryClient.invalidateQueries({ queryKey: ['admin', 'company_join_pending'] })
  }

  const approve = async (p) => {
    const guess = companies.find(co => co.name === p.company_name)
    let companyId = guess?.id
    if (!companyId) {
      const ans = prompt('「' + p.company_name + '」' + t('不在公司列表，是否新建？輸入 y 確認，或輸入要綁定到的現有公司名：'), 'y')
      if (!ans) return
      if (ans.trim().toLowerCase() === 'y') {
        // upsert 避免快速批准兩條同名觸發 UNIQUE 冲突
        const { data: co, error } = await supabase.from('companies').upsert({ name: p.company_name }, { onConflict: 'name' }).select().single()
        if (error) return alert(t('新建公司失敗：') + error.message)
        companyId = co.id
      } else {
        const found = companies.find(co => co.name.toLowerCase() === ans.trim().toLowerCase())
        if (!found) return alert(t('未找到') + '「' + ans + '」')
        companyId = found.id
      }
    }
    const { data: newEmp, error: empErr } = await supabase.from('employees').insert({
      name: p.name, email: p.email, user_id: p.user_id, company_id: companyId, kind: 'task',
    }).select().single()
    if (empErr) return alert(t('創建員工失敗：') + empErr.message)
    // 新邏輯：employee_companies 才是公司歸屬的真表（老 employees.company_id 是兼容字段）
    // 沒這行 → 員工進 team 切換器空、看不到任何任務（jaykc bug）
    const { error: ecErr } = await supabase.from('employee_companies').insert({
      employee_id: newEmp.id, company_id: companyId, is_default: true, is_company_admin: false,
      role_id: defaultRoleIdFor(companyId),
    })
    if (ecErr) return alert(t('創建綁定失敗：') + ecErr.message)
    await supabase.from('task_pending').update({ approved: true, reviewed_at: new Date().toISOString(), reviewed_by: reviewerUid }).eq('id', p.id)
    queryClient.invalidateQueries({ queryKey: ['admin', 'task_pending'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_companies'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'companies'] })
  }
  const reject = async (p) => {
    const reason = prompt(t('拒絕理由（可選）：')) || null
    await supabase.from('task_pending').update({ approved: false, reject_reason: reason, reviewed_at: new Date().toISOString(), reviewed_by: reviewerUid }).eq('id', p.id)
    queryClient.invalidateQueries({ queryKey: ['admin', 'task_pending'] })
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>{t('帳號審核')}</h1>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: c.bg, borderRadius: radius.md, marginBottom: 18, width: 'fit-content' }}>
        <button onClick={() => setReviewTab('register')} style={S.segmentBtn(reviewTab === 'register')}>{t('新註冊')} · {open.length}</button>
        <button onClick={() => setReviewTab('join')} style={S.segmentBtn(reviewTab === 'join')}>{t('跨公司加入')} · {joinOpen.length}</button>
      </div>
      {reviewTab === 'join' && (
        <>
          <Section label={t('待審核') + ' · ' + joinOpen.length}>
            {joinOpen.length === 0 ? <Empty>{t('沒有待審核申請')}</Empty> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {joinOpen.map(p => {
                  const emp = employees.find(e => e.id === p.employee_id)
                  const co = companies.find(co => co.id === p.company_id)
                  return (
                    <div key={p.id} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg, padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{emp?.name || p.employee_id}</div>
                        <div style={{ fontSize: 12, color: c.textMuted, marginTop: 3 }}>{emp?.email || ''}</div>
                        <div style={{ fontSize: 11, color: c.textMuted, marginTop: 6 }}>{t('申請加入：')}<strong style={{ color: c.text }}>{co?.name || '?'}</strong></div>
                        {p.note && <div style={{ fontSize: 11, color: c.textMuted, marginTop: 6, padding: 8, background: c.bg, borderRadius: radius.sm }}>{t('備註：')}{p.note}</div>}
                        <div style={{ fontSize: 10, color: c.textFaint, marginTop: 6 }}>{fmtDateTime(p.requested_at)}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button onClick={() => approveJoin(p)} style={S.btnSuccess}>{t('批准')}</button>
                        <button onClick={() => rejectJoin(p)} style={S.btnDanger}>{t('拒絕')}</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>
          {joinDone.length > 0 && (
            <Section label={t('最近處理') + ' · ' + joinDone.length}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {joinDone.map(p => {
                  const emp = employees.find(e => e.id === p.employee_id)
                  const co = companies.find(co => co.id === p.company_id)
                  return (
                    <div key={p.id} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.sm, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                      <span style={{ fontWeight: 600, flex: 1 }}>{emp?.name || p.employee_id}</span>
                      <span style={{ color: c.textFaint }}>→ {co?.name || '?'}</span>
                      <span style={{ color: p.approved ? c.green : c.red, fontWeight: 600 }}>{p.approved ? '✓ ' + t('已批准') : '✗ ' + t('已拒絕')}</span>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}
        </>
      )}
      {reviewTab === 'register' && <>
      <Section label={t('待審核') + ' · ' + open.length}>
        {open.length === 0 ? <Empty>{t('沒有待審核申請')}</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {open.map(p => (
              <div key={p.id} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg, padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: c.textMuted, marginTop: 3 }}>{p.email}</div>
                  <div style={{ fontSize: 11, color: c.textMuted, marginTop: 6 }}>{t('申請公司：')}<strong style={{ color: c.text }}>{p.company_name}</strong></div>
                  {p.note && <div style={{ fontSize: 11, color: c.textMuted, marginTop: 6, padding: 8, background: c.bg, borderRadius: radius.sm }}>{t('備註：')}{p.note}</div>}
                  <div style={{ fontSize: 10, color: c.textFaint, marginTop: 6 }}>{fmtDateTime(p.requested_at)}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button onClick={() => approve(p)} style={S.btnSuccess}>{t('批准')}</button>
                  <button onClick={() => reject(p)} style={S.btnDanger}>{t('拒絕')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      {done.length > 0 && (
        <Section label={t('最近處理') + ' · ' + done.length}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {done.map(p => (
              <div key={p.id} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.sm, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                <span style={{ fontWeight: 600, flex: 1 }}>{p.name}</span>
                <span style={{ color: c.textMuted }}>{p.email}</span>
                <span style={{ color: c.textFaint }}>{p.company_name}</span>
                <span style={{ color: p.approved ? c.green : c.red, fontWeight: 600 }}>{p.approved ? '✓ ' + t('已批准') : '✗ ' + t('已拒絕')}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      </>}
    </div>
  )
}
