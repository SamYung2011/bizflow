import React, { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabaseClient.js'
import { c, radius, S, Empty, tcell, useToggleSet } from '../styles.jsx'
import CompanyCollapseCard from '../components/CompanyCollapseCard.jsx'
import { useT } from '../i18n.jsx'

// RBAC 權限點清單。新增權限點時，roles 表中已有的 role 沒這個 key → 視為 false。
// label 走 t() 翻譯。
const PERMISSION_KEYS = [
  ['can_create_task', '新建任務'],
  ['can_assign_others', '給他人分配任務'],
  ['can_edit_others_tasks', '改他人任務'],
  ['can_delete_others_tasks', '刪他人任務'],
  ['can_validate_task', '核驗任務'],
  ['can_manage_employees', '管理員工'],
  ['can_approve_registration', '審核加入申請'],
  ['can_view_commission', '看佣金（僅本人銷售業績）'],
  ['can_manage_roles', '管理職位'],
]

// 容納兩個 sub-tab：職位權限（RolesView）+ 部門設置（DepartmentsView）
export default function RolesAndDepartmentsView({ data, ctx }) {
  const { t } = useT()
  const [sub, setSub] = useState('roles')

  const tabs = [
    ['roles', t('職位權限')],
    ['departments', t('部門設置')],
  ]

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 14, letterSpacing: -0.3 }}>{t('職位 / 權限 / 部門管理')}</h1>
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, borderBottom: `1px solid ${c.border}` }}>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setSub(id)}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${sub === id ? c.accent : 'transparent'}`,
              color: sub === id ? c.accent : c.textMuted,
              fontSize: 13,
              fontWeight: sub === id ? 700 : 500,
              cursor: 'pointer',
              marginBottom: -1,
            }}>{label}</button>
        ))}
      </div>
      {sub === 'roles' && <RolesView data={data} ctx={ctx} />}
      {sub === 'departments' && <DepartmentsView data={data} ctx={ctx} />}
    </div>
  )
}

// super admin：看所有公司的職位；公司 admin：只本公司
// 編輯 inline，每個 role 一張卡片，9 個權限點 checkbox
function RolesView({ data, ctx }) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const { roles, companies } = data

  const visibleCompanies = useMemo(
    () => ctx.isSuperAdmin ? companies : companies.filter(co => co.id === ctx.activeCompanyId),
    [companies, ctx.isSuperAdmin, ctx.activeCompanyId]
  )

  const [newRoleByCompany, setNewRoleByCompany] = useState({})
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({ name: '', permissions: {} })
  const [collapsed, toggleCo] = useToggleSet()

  const startEdit = (r) => {
    setEditingId(r.id)
    setEditDraft({ name: r.name, permissions: { ...r.permissions } })
  }
  const cancelEdit = () => { setEditingId(null); setEditDraft({ name: '', permissions: {} }) }

  const saveEdit = async (id) => {
    if (!editDraft.name.trim()) return alert(t('名稱必填'))
    const { error } = await supabase.from('roles').update({
      name: editDraft.name.trim(),
      permissions: editDraft.permissions,
    }).eq('id', id)
    if (error) return alert(t('更新失敗：') + error.message)
    cancelEdit()
    queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] })
  }

  const del = async (r) => {
    if (!confirm(t('確定刪除職位') + '「' + r.name + '」？')) return
    const { error } = await supabase.from('roles').delete().eq('id', r.id)
    if (error) return alert(t('刪除失敗：') + error.message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_companies'] })
  }

  const addRole = async (companyId) => {
    const name = (newRoleByCompany[companyId] || '').trim()
    if (!name) return
    const permissions = Object.fromEntries(PERMISSION_KEYS.map(([k]) => [k, false]))
    const { error } = await supabase.from('roles').insert({ company_id: companyId, name, permissions })
    if (error) return alert(t('新增失敗：') + error.message)
    setNewRoleByCompany(prev => ({ ...prev, [companyId]: '' }))
    queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] })
  }

  return (
    <div>
      {visibleCompanies.map(co => {
        const coRoles = roles.filter(r => r.company_id === co.id)
        return (
          <CompanyCollapseCard key={co.id} collapsed={collapsed.has(co.id)} onToggle={() => toggleCo(co.id)} name={co.name} subLabel={`${coRoles.length} ${t('個職位')}`}>
            {coRoles.length === 0 && <Empty>{t('還沒有職位')}</Empty>}

                {coRoles.map(r => {
                  const isEdit = editingId === r.id
                  const draft = isEdit ? editDraft : { name: r.name, permissions: r.permissions || {} }
                  return (
                    <div key={r.id} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: radius.md, padding: 12, marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                        {isEdit ? (
                          <input value={draft.name} onChange={e => setEditDraft({ ...editDraft, name: e.target.value })} style={{ ...S.input, marginBottom: 0, fontWeight: 600, flex: 1 }} />
                        ) : (
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{r.name}</div>
                        )}
                        <div style={{ display: 'flex', gap: 6 }}>
                          {isEdit ? (
                            <>
                              <button onClick={() => saveEdit(r.id)} style={S.btnPrimary}>{t('保存')}</button>
                              <button onClick={cancelEdit} style={S.btnGhost}>{t('取消')}</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(r)} style={S.btnGhostSm}>✏</button>
                              <button onClick={() => del(r)} style={{ ...S.btnGhostSm, color: c.red }}>×</button>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                        {PERMISSION_KEYS.map(([key, label]) => {
                          const enabled = draft.permissions?.[key] === true
                          return (
                            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: enabled ? c.text : c.textMuted, cursor: isEdit ? 'pointer' : 'default' }}>
                              <input type="checkbox" checked={enabled} disabled={!isEdit}
                                onChange={e => isEdit && setEditDraft({ ...editDraft, permissions: { ...draft.permissions, [key]: e.target.checked } })} />
                              {t(label)}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}

                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input
                    value={newRoleByCompany[co.id] || ''}
                    onChange={e => setNewRoleByCompany(prev => ({ ...prev, [co.id]: e.target.value }))}
                    placeholder={t('新職位名稱')}
                    style={{ ...S.input, marginBottom: 0, flex: 1 }}
                  />
                  <button onClick={() => addRole(co.id)} disabled={!(newRoleByCompany[co.id] || '').trim()}
                    style={{ ...S.btnPrimary, opacity: (newRoleByCompany[co.id] || '').trim() ? 1 : 0.4 }}>{t('新增職位')}</button>
                </div>
          </CompanyCollapseCard>
        )
      })}
    </div>
  )
}

// 公司 admin 自由 CRUD 部門 + 把公司內員工加入/移出部門
function DepartmentsView({ data, ctx }) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const { companies, departments, empDepts, empCompanies, employees } = data

  const visibleCompanies = useMemo(() => {
    if (ctx.isSuperAdmin) return companies
    const adminCompanyIds = new Set(
      empCompanies.filter(ec => ec.is_company_admin).map(ec => ec.company_id)
    )
    return companies.filter(co => adminCompanyIds.has(co.id))
  }, [companies, empCompanies, ctx.isSuperAdmin])

  const [newDeptByCompany, setNewDeptByCompany] = useState({})
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [addMemberFor, setAddMemberFor] = useState(null)
  const [memberQuery, setMemberQuery] = useState('')
  const [collapsedCo, toggleCo] = useToggleSet()
  const [expandedDept, toggleDept] = useToggleSet()

  const addDept = async (companyId) => {
    const name = (newDeptByCompany[companyId] || '').trim()
    if (!name) return
    const { error } = await supabase.from('departments').insert({ company_id: companyId, name })
    if (error) return alert(t('新增失敗：') + error.message)
    setNewDeptByCompany(prev => ({ ...prev, [companyId]: '' }))
    queryClient.invalidateQueries({ queryKey: ['admin', 'departments'] })
  }

  const startEdit = (d) => { setEditingId(d.id); setEditName(d.name) }
  const cancelEdit = () => { setEditingId(null); setEditName('') }

  const saveEdit = async (id) => {
    if (!editName.trim()) return alert(t('名稱必填'))
    const { error } = await supabase.from('departments').update({ name: editName.trim() }).eq('id', id)
    if (error) return alert(t('更新失敗：') + error.message)
    cancelEdit()
    queryClient.invalidateQueries({ queryKey: ['admin', 'departments'] })
  }

  const delDept = async (d) => {
    if (!confirm(t('確定刪除部門') + '「' + d.name + '」？' + t('（部門內成員會被移出，原本屬於此部門的任務變回公司內可見）'))) return
    const { error } = await supabase.from('departments').delete().eq('id', d.id)
    if (error) return alert(t('刪除失敗：') + error.message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'departments'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_departments'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_tasks'] })
  }

  const addMember = async (deptId, employeeId) => {
    const { error } = await supabase.from('employee_departments').insert({ employee_id: employeeId, department_id: deptId })
    if (error) return alert(t('加入失敗：') + error.message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_departments'] })
  }

  const removeMember = async (deptId, employeeId) => {
    if (!confirm(t('確定把該成員移出此部門？'))) return
    const { error } = await supabase.from('employee_departments').delete()
      .eq('employee_id', employeeId).eq('department_id', deptId)
    if (error) return alert(t('移除失敗：') + error.message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_departments'] })
  }

  return (
    <div>
      {visibleCompanies.length === 0 && <Empty>{t('沒有可管理的公司')}</Empty>}
      {visibleCompanies.map(co => {
        const coDepts = departments.filter(d => d.company_id === co.id)
        const coEmpIds = new Set(empCompanies.filter(ec => ec.company_id === co.id).map(ec => ec.employee_id))
        const coEmps = employees.filter(e => coEmpIds.has(e.id) && e.active !== false)
        return (
          <CompanyCollapseCard key={co.id} collapsed={collapsedCo.has(co.id)} onToggle={() => toggleCo(co.id)} name={co.name} subLabel={`${coDepts.length} ${t('個部門')}`}>
            {coDepts.length === 0 && <Empty>{t('還沒有部門')}</Empty>}
                {coDepts.map(d => {
                  const memberIds = empDepts.filter(ed => ed.department_id === d.id).map(ed => ed.employee_id)
                  const memberEmps = coEmps.filter(e => memberIds.includes(e.id))
                  const nonMembers = coEmps.filter(e => !memberIds.includes(e.id))
                  const isEdit = editingId === d.id
                  const isAddingMember = addMemberFor === d.id
                  const isExpanded = expandedDept.has(d.id)
                  const q = memberQuery.toLowerCase()
                  const candidateNonMembers = q ? nonMembers.filter(e => (e.name || '').toLowerCase().includes(q)) : nonMembers
                  return (
                    <div key={d.id} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: radius.md, marginBottom: 10, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', cursor: isEdit ? 'default' : 'pointer' }}
                        onClick={() => { if (!isEdit) toggleDept(d.id) }}>
                        {isEdit ? (
                          <input value={editName} onChange={e => setEditName(e.target.value)} onClick={e => e.stopPropagation()} style={{ ...S.input, marginBottom: 0, fontWeight: 600, flex: 1 }} />
                        ) : (
                          <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 10, color: c.textMuted, width: 10 }}>{isExpanded ? '▼' : '▶'}</span>
                            {d.name}
                            <span style={{ fontSize: 11, color: c.textFaint, fontWeight: 400 }}>{memberEmps.length} {t('人')}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                          {isEdit ? (
                            <>
                              <button onClick={() => saveEdit(d.id)} style={S.btnPrimary}>{t('保存')}</button>
                              <button onClick={cancelEdit} style={S.btnGhost}>{t('取消')}</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(d)} style={S.btnGhostSm}>✏</button>
                              <button onClick={() => delDept(d)} style={{ ...S.btnGhostSm, color: c.red }}>×</button>
                            </>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{ padding: '0 0 10px', borderTop: `1px solid ${c.border}`, background: c.card }}>
                          {memberEmps.length === 0 ? (
                            <div style={{ padding: 14, textAlign: 'center', fontSize: 12, color: c.textFaint }}>{t('暫無成員')}</div>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead>
                                <tr style={{ borderBottom: `1px solid ${c.border}` }}>
                                  <th style={tcell('left')}>{t('姓名')}</th>
                                  <th style={tcell('left')}>{t('職位')}</th>
                                  <th style={tcell('left')}>{t('電話')}</th>
                                  <th style={tcell('right')}></th>
                                </tr>
                              </thead>
                              <tbody>
                                {memberEmps.map(e => (
                                  <tr key={e.id} style={{ borderBottom: `1px solid ${c.border}` }}>
                                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{e.name}</td>
                                    <td style={{ padding: '8px 12px', color: c.textMuted }}>{e.role || '—'}</td>
                                    <td style={{ padding: '8px 12px', color: c.textMuted }}>{e.phone || '—'}</td>
                                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                      <button onClick={() => removeMember(d.id, e.id)} style={{ ...S.btnGhostSm, color: c.red }}>{t('移出')}</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}

                          <div style={{ padding: '10px 12px 0' }}>
                            {isAddingMember ? (
                              <div style={{ borderTop: `1px dashed ${c.border}`, paddingTop: 8 }}>
                                <input value={memberQuery} onChange={e => setMemberQuery(e.target.value)} placeholder={t('搜索員工姓名...')}
                                  style={{ ...S.input, marginBottom: 6 }} />
                                <div style={{ maxHeight: 200, overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: radius.sm }}>
                                  {candidateNonMembers.length === 0 ? (
                                    <div style={{ padding: 10, fontSize: 11, color: c.textFaint, textAlign: 'center' }}>{t('沒有可加入的員工')}</div>
                                  ) : candidateNonMembers.map(e => (
                                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: `1px solid ${c.border}`, fontSize: 12 }}>
                                      <div>
                                        <span style={{ fontWeight: 600 }}>{e.name}</span>
                                        {e.role && <span style={{ color: c.textFaint, marginLeft: 8, fontSize: 11 }}>{e.role}</span>}
                                      </div>
                                      <button onClick={() => addMember(d.id, e.id)} style={S.btnPrimary}>+ {t('加入')}</button>
                                    </div>
                                  ))}
                                </div>
                                <button onClick={() => { setAddMemberFor(null); setMemberQuery('') }} style={{ ...S.btnGhostSm, marginTop: 6 }}>{t('完成')}</button>
                              </div>
                            ) : (
                              <button onClick={() => { setAddMemberFor(d.id); setMemberQuery('') }} style={{ ...S.btnGhostSm }}>+ {t('加入成員')}</button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}

                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input
                    value={newDeptByCompany[co.id] || ''}
                    onChange={e => setNewDeptByCompany(prev => ({ ...prev, [co.id]: e.target.value }))}
                    placeholder={t('新部門名稱')}
                    style={{ ...S.input, marginBottom: 0, flex: 1 }}
                  />
                  <button onClick={() => addDept(co.id)} disabled={!(newDeptByCompany[co.id] || '').trim()}
                    style={{ ...S.btnPrimary, opacity: (newDeptByCompany[co.id] || '').trim() ? 1 : 0.4 }}>{t('新增部門')}</button>
                </div>
          </CompanyCollapseCard>
        )
      })}
    </div>
  )
}
