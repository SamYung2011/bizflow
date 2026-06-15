import React, { useState, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabaseClient.js'
import { c, S, useToggleSet, Empty, Field, tcell } from '../styles.jsx'
import { useT } from '../i18n.jsx'
import { empIdsInCompany } from '../lib/taskHelpers.js'
import CompanyCollapseCard from '../components/CompanyCollapseCard.jsx'

// ============================================================
//  員工管理：按公司分組 + 編輯員工綁定 + 新增員工 + 移除/永久刪
// ============================================================

export default function EmployeesView({ data, me, isMobile, ctx }) {
  const { t } = useT()
  const { employees, companies, empCompanies, roles } = data
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  // 折疊狀態：存「主動折疊」的公司 id（默認全展開）
  const [collapsed, toggle] = useToggleSet()

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_companies'] })
  }

  const updateField = async (id, patch) => {
    const { error } = await supabase.from('employees').update(patch).eq('id', id)
    if (error) return alert(t('更新失敗：') + error.message)
    refresh()
  }

  const updateBinding = async (employee_id, company_id, patch) => {
    // employee_companies 行的 upsert / update：如果不存在就 INSERT，存在就 UPDATE
    const existing = empCompanies.find(ec => ec.employee_id === employee_id && ec.company_id === company_id)
    if (existing) {
      const { error } = await supabase.from('employee_companies').update(patch).eq('id', existing.id)
      if (error) return alert(t('更新失敗：') + error.message)
    } else {
      const { error } = await supabase.from('employee_companies').insert({ employee_id, company_id, ...patch })
      if (error) return alert(t('新增失敗：') + error.message)
    }
    refresh()
  }

  // 「移除出本公司」：只刪該員工在當前活躍公司的 binding + 任務 / assignees。
  // 若該員工沒別的公司 binding（變孤兒）→ 標 active=false + deactivated_at，6 天後 pg_cron 自動清。
  const removeFromCompany = async (emp) => {
    const targetCompanyId = ctx?.activeCompanyId
    if (!targetCompanyId) return alert(t('未選定公司'))
    if (emp.id === me.id) return alert(t('不能移除自己'))
    const empBindings = empCompanies.filter(ec => ec.employee_id === emp.id)
    const willBeOrphan = empBindings.length === 1 && empBindings[0].company_id === targetCompanyId
    const targetCo = companies.find(co => co.id === targetCompanyId)
    const msg = willBeOrphan
      ? (t('員工只屬於') + targetCo?.name + t('，移除等於銷號。6 天後自動清除所有任務 + 帳號。確定？'))
      : (t('把') + ' ' + emp.name + ' ' + t('從') + targetCo?.name + t('移除？\n他在本公司創建的任務 + assignee 行會一併刪除。其他公司的數據保留。'))
    if (!confirm(msg)) return
    try {
      // 刪該員工在本公司創建的所有任務（cascade 帶 assignees + feedbacks）
      const { error: taskDeleteErr } = await supabase.from('employee_tasks').delete()
        .eq('creator_employee_id', emp.id)
        .eq('company_id', targetCompanyId)
      if (taskDeleteErr) throw taskDeleteErr
      // 刪該員工在本公司任務的 assignees 行（A 是 assignee 不是 creator 的情況）
      const { data: companyTasks, error: taskSelectErr } = await supabase.from('employee_tasks')
        .select('id').eq('company_id', targetCompanyId)
      if (taskSelectErr) throw taskSelectErr
      if (companyTasks && companyTasks.length > 0) {
        const { error: assigneeDeleteErr } = await supabase.from('task_assignees').delete()
          .eq('employee_id', emp.id)
          .in('task_id', companyTasks.map(tk => tk.id))
        if (assigneeDeleteErr) throw assigneeDeleteErr
      }
      // 刪 binding
      const { error: bErr } = await supabase.from('employee_companies').delete()
        .eq('employee_id', emp.id)
        .eq('company_id', targetCompanyId)
      if (bErr) throw bErr
      // 變孤兒 → 標停用
      if (willBeOrphan) {
        const { error: empUpdateErr } = await supabase.from('employees').update({
          active: false,
          deactivated_at: new Date().toISOString(),
        }).eq('id', emp.id)
        if (empUpdateErr) throw empUpdateErr
      }
      refresh()
    } catch (e) {
      alert(t('移除失敗：') + (e.message || String(e)))
    }
  }

  // 「永久刪除」：super admin only，繞過 6 天 grace。走 RPC（前端沒權限刪 auth.users）。
  const permanentDelete = async (emp) => {
    if (emp.id === me.id) return alert(t('不能刪除自己'))
    if (!confirm(t('永久刪除') + ' ' + emp.name + ' ？\n' + t('他的所有任務 / 公司綁定 / 帳號全部清除，不可恢復。'))) return
    if (!confirm(t('再次確認：永久刪除 ') + emp.name + ' ？')) return
    const { error } = await supabase.rpc('permanent_delete_employee', { emp_id: emp.id })
    if (error) return alert(t('永久刪除失敗：') + error.message)
    refresh()
  }

  // 可見公司：super admin 看所有；公司 admin 只看自己管理的公司
  const visibleCompanies = ctx?.isSuperAdmin
    ? companies
    : companies.filter(co => empCompanies.some(ec => ec.employee_id === me.id && ec.company_id === co.id && ec.is_company_admin))

  // 每家公司的員工列表：按 employee_companies 反查（合作者會出現在多家公司）
  const empsByCompany = useMemo(() => {
    const m = new Map()
    for (const co of visibleCompanies) {
      const ids = empIdsInCompany(empCompanies, co.id)
      m.set(co.id, employees.filter(e => e.active !== false && ids.has(e.id)))
    }
    return m
  }, [employees, empCompanies, visibleCompanies])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{t('員工管理')}</h1>
        {ctx?.isSuperAdmin && <button onClick={() => setShowAdd(true)} style={S.btnPrimary}>＋ {t('新增員工')}</button>}
      </div>

      {visibleCompanies.length === 0 && <Empty>{t('沒有可管理的公司')}</Empty>}

      {visibleCompanies.map(co => {
        const coEmps = empsByCompany.get(co.id) || []
        return (
          <CompanyCollapseCard key={co.id} collapsed={collapsed.has(co.id)} onToggle={() => toggle(co.id)} name={co.name} subLabel={`${coEmps.length} ${t('人')}`} contentPadding={0}>
            {coEmps.length === 0 ? (
              <div style={{ padding: 18, textAlign: 'center', fontSize: 12, color: c.textFaint }}>{t('該公司暫無員工')}</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${c.border}` }}>
                    <th style={tcell('left')}>{t('姓名')}</th>
                    <th style={tcell('left')}>{t('職位')}</th>
                    <th style={tcell('left')}>{t('公司管理員')}</th>
                    <th style={tcell('left')}>{t('電話')}</th>
                    <th style={tcell('left')}>Email</th>
                    <th style={tcell('left')}>{t('狀態')}</th>
                    <th style={tcell('right')}></th>
                  </tr>
                </thead>
                <tbody>
                  {coEmps.map(e => (
                    <EmployeeRow key={e.id} emp={e} companies={companies} empCompanies={empCompanies} roles={roles}
                      companyContext={co.id}
                      updateField={updateField} updateBinding={updateBinding} removeFromCompany={removeFromCompany} permanentDelete={permanentDelete} me={me} ctx={ctx} />
                  ))}
                </tbody>
              </table>
            )}
          </CompanyCollapseCard>
        )
      })}

      {showAdd && <NewEmployeeModal companies={companies} roles={roles} onClose={() => setShowAdd(false)} onSaved={refresh} />}
    </div>
  )
}


function EmployeeRow({ emp, companies, empCompanies, roles, companyContext, updateField, updateBinding, removeFromCompany, permanentDelete, me, ctx }) {
  const { t } = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(emp)
  useEffect(() => setDraft(emp), [emp.id, emp.updated_at])

  // 該員工在「當前上下文公司」的綁定（職位 + is_company_admin）
  const myBindings = empCompanies.filter(ec => ec.employee_id === emp.id)
  const contextBinding = companyContext ? myBindings.find(b => b.company_id === companyContext) : (myBindings.find(b => b.is_default) || myBindings[0])
  const contextRoleName = contextBinding?.role_id ? roles.find(r => r.id === contextBinding.role_id)?.name : null

  // 編輯時：本人欄位（name/phone/email）改 employees；職位/is_company_admin 改 employee_companies
  const [bindingDraft, setBindingDraft] = useState({ role_id: contextBinding?.role_id || '', is_company_admin: !!contextBinding?.is_company_admin })
  useEffect(() => setBindingDraft({ role_id: contextBinding?.role_id || '', is_company_admin: !!contextBinding?.is_company_admin }), [contextBinding?.id])

  const save = async () => {
    // employees 表只改 name/phone/email/active（kind 和 user_id 鎖；is_super_admin 由 super admin 在別處改）
    const empPatch = {}
    for (const k of ['name', 'phone', 'email', 'active']) {
      if (draft[k] !== emp[k]) empPatch[k] = draft[k] ?? (k === 'active' ? false : null)
    }
    if (Object.keys(empPatch).length > 0) await updateField(emp.id, empPatch)
    // employee_companies 行：更新本上下文公司的 role_id / is_company_admin
    if (contextBinding && (bindingDraft.role_id !== (contextBinding.role_id || '') || bindingDraft.is_company_admin !== !!contextBinding.is_company_admin)) {
      await updateBinding(emp.id, contextBinding.company_id, {
        role_id: bindingDraft.role_id || null,
        is_company_admin: bindingDraft.is_company_admin,
      })
    }
    setEditing(false)
  }

  const companyRoles = roles.filter(r => contextBinding && r.company_id === contextBinding.company_id)

  return (
    <tr style={{ borderBottom: `1px solid ${c.border}` }}>
      <td style={{ padding: '8px 12px', fontWeight: 600 }}>
        {editing ? <input value={draft.name || ''} onChange={e => setDraft({ ...draft, name: e.target.value })} style={{ ...S.input, marginBottom: 0, fontSize: 12 }} /> : (emp.name || '—')}
      </td>
      <td style={{ padding: '8px 12px' }}>
        {editing && contextBinding ? (
          <select value={bindingDraft.role_id} onChange={e => setBindingDraft({ ...bindingDraft, role_id: e.target.value })} style={{ ...S.input, marginBottom: 0, fontSize: 12 }}>
            <option value="">—</option>
            {companyRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        ) : (contextRoleName || '—')}
      </td>
      <td style={{ padding: '8px 12px', fontSize: 11 }}>
        {editing && contextBinding ? (
          <input type="checkbox" checked={bindingDraft.is_company_admin} onChange={e => setBindingDraft({ ...bindingDraft, is_company_admin: e.target.checked })} />
        ) : (contextBinding?.is_company_admin ? <span style={{ color: c.accent, fontWeight: 600 }}>✓</span> : '—')}
      </td>
      <td style={{ padding: '8px 12px' }}>
        {editing ? <input value={draft.phone || ''} onChange={e => setDraft({ ...draft, phone: e.target.value })} style={{ ...S.input, marginBottom: 0, fontSize: 12 }} /> : (emp.phone || '—')}
      </td>
      <td style={{ padding: '8px 12px', color: c.textMuted, fontSize: 12 }}>
        {editing ? <input value={draft.email || ''} onChange={e => setDraft({ ...draft, email: e.target.value })} style={{ ...S.input, marginBottom: 0, fontSize: 12 }} /> : (emp.email || '—')}
      </td>
      <td style={{ padding: '8px 12px', fontSize: 11 }}>
        {emp.active === false ? <span style={{ color: c.textFaint }}>{t('停用')}</span> : <span style={{ color: c.green }}>{t('在職')}</span>}
        {!emp.user_id && <span style={{ marginLeft: 4, color: c.textFaint }}>·{t('未綁帳號')}</span>}
      </td>
      <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {editing ? (
          <>
            <button onClick={save} style={{ ...S.btnPrimary, padding: '4px 10px', fontSize: 11, marginRight: 4 }}>{t('保存')}</button>
            <button onClick={() => { setDraft(emp); setEditing(false) }} style={{ ...S.btnGhostSm, padding: '4px 8px' }}>{t('取消')}</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} style={{ ...S.btnGhostSm, padding: '4px 8px', marginRight: 4 }}>{t('編輯')}</button>
            {(ctx?.isSuperAdmin || ctx?.isAdminOfActive) && (
              <button onClick={() => removeFromCompany(emp)} style={{ background: 'none', border: 'none', color: c.red, fontSize: 11, cursor: 'pointer', padding: 4, marginRight: 4 }} title={t('刪除該員工在本公司的所有任務 + 解綁。其他公司不影響。')}>{t('移除')}</button>
            )}
            {ctx?.isSuperAdmin && (
              <button onClick={() => permanentDelete(emp)} style={{ background: 'none', border: 'none', color: c.red, fontSize: 10, cursor: 'pointer', padding: 4, opacity: 0.7 }} title={t('繞過 6 天 grace，立即永久刪除員工 + 帳號')}>{t('永久刪')}</button>
            )}
          </>
        )}
      </td>
    </tr>
  )
}

function NewEmployeeModal({ companies, roles, onClose, onSaved }) {
  const { t } = useT()
  const [name, setName] = useState('')
  const [roleId, setRoleId] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [companyId, setCompanyId] = useState(companies[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const companyRoles = roles.filter(r => r.company_id === companyId)
  const selectedRole = companyRoles.find(r => r.id === roleId)
  const defaultRole = companyRoles.find(r => r.name === '普通員工') || companyRoles[0] || null

  const save = async () => {
    if (!name.trim()) return alert(t('姓名必填'))
    if (!companyId) return alert(t('未選定公司'))
    const bindingRoleId = selectedRole?.id || defaultRole?.id || null
    const roleName = (selectedRole || defaultRole)?.name || null
    setBusy(true)
    const { data: employee, error } = await supabase.from('employees').insert({
      name: name.trim(), role: roleName, phone: phone.trim() || null,
      email: email.trim() || null, company_id: companyId || null, kind: 'employee',
    }).select('id').single()
    if (error) {
      setBusy(false)
      return alert(t('新增失敗：') + error.message)
    }
    const { error: bindError } = await supabase.from('employee_companies').insert({
      employee_id: employee.id,
      company_id: companyId,
      is_default: true,
      is_company_admin: false,
      role_id: bindingRoleId,
    })
    setBusy(false)
    if (bindError) {
      await supabase.from('employees').delete().eq('id', employee.id)
      return alert(t('創建綁定失敗：') + bindError.message)
    }
    onSaved(); onClose()
  }
  return (
    <div style={S.modal} onClick={onClose}>
      <div style={S.modalCard(440)} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t('新增員工')}</h2>
          <button onClick={onClose} style={S.iconBtn}>×</button>
        </div>
        <Field label={t('姓名 *')}><input value={name} onChange={e => setName(e.target.value)} style={S.input} placeholder={t('員工姓名')} /></Field>
        <Field label={t('公司')}><select value={companyId} onChange={e => { setCompanyId(e.target.value); setRoleId('') }} style={S.input}>
          <option value="">—</option>
          {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
        </select></Field>
        <Field label={t('職位')}><select value={roleId} onChange={e => setRoleId(e.target.value)} style={S.input}>
          <option value="">{defaultRole ? defaultRole.name : '—'}</option>
          {companyRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select></Field>
        <Field label={t('電話')}><input value={phone} onChange={e => setPhone(e.target.value)} style={S.input} placeholder="+852" /></Field>
        <Field label="Email"><input value={email} onChange={e => setEmail(e.target.value)} style={S.input} placeholder="email@example.com" /></Field>
        <div style={{ fontSize: 10, color: c.textFaint, marginBottom: 10 }}>{t('備註：員工 auth 帳號（user_id）需在 Supabase 後台另行創建並綁定。')}</div>
        <button onClick={save} disabled={busy || !name.trim()} style={{ ...S.btnPrimary, width: '100%', opacity: (busy || !name.trim()) ? 0.4 : 1 }}>{busy ? t('處理中…') : t('儲存')}</button>
      </div>
    </div>
  )
}
