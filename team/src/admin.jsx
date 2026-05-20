import React, { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabaseClient.js'
import { c, radius, font, S, fetchAllTable, useIsMobile, useToggleSet, Empty, Field, Section, fmtDateTime, tcell } from './styles.jsx'
import { useT } from './i18n.jsx'
import UpdateLogView from './views/UpdateLog.jsx'
import CompanyCollapseCard from './components/CompanyCollapseCard.jsx'
import { empIdsInCompany } from './lib/taskHelpers.js'
import TasksView from './views/Tasks.jsx'
import CompaniesView from './views/Companies.jsx'
import CommissionView from './views/Commission.jsx'
import RolesAndDepartmentsView from './views/RolesAndDepartments.jsx'

// ============================================================
//  Admin 視角：員工管理 / 任務看板 / 帳號審核 / 佣金 / 更新日誌
// ============================================================

// 共享數據 hooks
function useAdminData() {
  const queryClient = useQueryClient()

  // 輪詢拉到 30s 兜底，主要靠 realtime push 即時刷新
  const qEmployees = useQuery({ queryKey: ['admin', 'employees'], queryFn: () => fetchAllTable('employees', 'created_at'), refetchInterval: 60000 })
  const qCompanies = useQuery({ queryKey: ['admin', 'companies'], queryFn: () => fetchAllTable('companies', 'name'), refetchInterval: 120000 })
  const qEmpCompanies = useQuery({ queryKey: ['admin', 'employee_companies'], queryFn: () => fetchAllTable('employee_companies', 'joined_at'), refetchInterval: 60000 })
  const qRoles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => fetchAllTable('roles', 'name'), refetchInterval: 120000 })
  const qTasks = useQuery({ queryKey: ['admin', 'employee_tasks'], queryFn: () => fetchAllTable('employee_tasks', 'created_at', false), refetchInterval: 30000 })
  const qAssignees = useQuery({ queryKey: ['admin', 'task_assignees'], queryFn: () => fetchAllTable('task_assignees', 'created_at'), refetchInterval: 30000 })
  const qFeedbacks = useQuery({ queryKey: ['admin', 'feedbacks'], queryFn: () => fetchAllTable('employee_task_feedbacks', 'created_at'), refetchInterval: 30000 })
  const qPending = useQuery({ queryKey: ['admin', 'task_pending'], queryFn: () => fetchAllTable('task_pending', 'requested_at', false), refetchInterval: 30000 })
  const qJoinPending = useQuery({ queryKey: ['admin', 'company_join_pending'], queryFn: () => fetchAllTable('company_join_pending', 'requested_at', false), refetchInterval: 30000 })
  const qDepartments = useQuery({ queryKey: ['admin', 'departments'], queryFn: () => fetchAllTable('departments', 'name'), refetchInterval: 120000 })
  const qEmpDepts = useQuery({ queryKey: ['admin', 'employee_departments'], queryFn: () => fetchAllTable('employee_departments', 'created_at'), refetchInterval: 120000 })

  // realtime 訂閱：DB 任意改動立即觸發 invalidate
  useEffect(() => {
    const tables = [
      ['employee_tasks', ['admin', 'employee_tasks']],
      ['task_assignees', ['admin', 'task_assignees']],
      ['employee_task_feedbacks', ['admin', 'feedbacks']],
      ['employees', ['admin', 'employees']],
      ['companies', ['admin', 'companies']],
      ['employee_companies', ['admin', 'employee_companies']],
      ['roles', ['admin', 'roles']],
      ['task_pending', ['admin', 'task_pending']],
      ['company_join_pending', ['admin', 'company_join_pending']],
      ['departments', ['admin', 'departments']],
      ['employee_departments', ['admin', 'employee_departments']],
    ]
    const channels = tables.map(([table, key]) => supabase
      .channel(`team-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        queryClient.invalidateQueries({ queryKey: key })
      })
      .subscribe()
    )
    return () => { channels.forEach(ch => supabase.removeChannel(ch)) }
  }, [queryClient])

  const employees = qEmployees.data || []
  const companies = qCompanies.data || []
  const empCompanies = qEmpCompanies.data || []
  const roles = qRoles.data || []
  const tasks = qTasks.data || []
  const assignees = qAssignees.data || []
  const feedbacks = qFeedbacks.data || []
  const pendings = qPending.data || []
  const joinPendings = qJoinPending.data || []
  const departments = qDepartments.data || []
  const empDepts = qEmpDepts.data || []

  const assigneesByTask = useMemo(() => {
    const m = new Map()
    for (const a of assignees) {
      const list = m.get(a.task_id) || []
      list.push(a); m.set(a.task_id, list)
    }
    return m
  }, [assignees])

  return { employees, companies, empCompanies, roles, tasks, assignees, feedbacks, pendings, joinPendings, departments, empDepts, assigneesByTask, loading: qEmployees.isLoading || qTasks.isLoading }
}

// 計算當前用戶的「公司綁定」、活躍公司、職位權限
function useMyContext(me, data) {
  // 該用戶的所有 employee_companies 行（多公司綁定）
  const myBindings = useMemo(
    () => data.empCompanies.filter(ec => ec.employee_id === me.id),
    [data.empCompanies, me.id]
  )
  const defaultBinding = myBindings.find(b => b.is_default) || myBindings[0]
  const defaultCompanyId = defaultBinding?.company_id || me.company_id  // fallback 老 employees.company_id

  // 切換器選項：super admin 看所有公司（不受 binding 限制）；其他人只看自己綁的
  const switchableCompanies = useMemo(() => {
    if (me.is_super_admin === true) {
      return data.companies.map(co => ({
        company_id: co.id,
        is_default: co.id === defaultCompanyId,
      }))
    }
    return myBindings.map(b => ({ company_id: b.company_id, is_default: b.is_default }))
  }, [me.is_super_admin, data.companies, myBindings, defaultCompanyId])

  // localStorage 存當前活躍公司（按 user 維度）
  // 注意：useState initializer 跑時 switchableCompanies 還是空（query 沒回），不能在這裡校驗。
  // 先信任 localStorage，等 bindings 加載後再校驗（見下面 useEffect）。
  const storageKey = `team-active-company-${me.user_id || me.id}`
  const [activeCompanyId, setActiveCompanyIdState] = useState(() => {
    try { return localStorage.getItem(storageKey) || null } catch { return null }
  })
  // 加載後：activeCompanyId 為 null OR 不在可選列表 → 回 default
  useEffect(() => {
    if (switchableCompanies.length === 0) return
    if (!activeCompanyId || !switchableCompanies.some(b => b.company_id === activeCompanyId)) {
      setActiveCompanyIdState(defaultCompanyId)
    }
  }, [switchableCompanies, activeCompanyId, defaultCompanyId])
  const setActiveCompanyId = (id) => {
    setActiveCompanyIdState(id)
    try { localStorage.setItem(storageKey, id) } catch {}
  }

  const activeCompany = data.companies.find(c => c.id === activeCompanyId)
  const activeBinding = myBindings.find(b => b.company_id === activeCompanyId)
  const activeRole = activeBinding?.role_id ? data.roles.find(r => r.id === activeBinding.role_id) : null

  // 是否在當前活躍公司是 admin（super admin 視為所有公司 admin）
  const isAdminOfActive = me.is_super_admin === true || !!activeBinding?.is_company_admin
  // 是否顯示公司切換器（多個可切的 OR super admin 視角）
  const hasMultipleCompanies = switchableCompanies.length > 1
  // 任意公司是不是 admin（決定能不能進「員工管理」等板塊）
  const isAdminOfAny = myBindings.some(b => b.is_company_admin)

  // 權限檢查：super admin 一切通過；否則查當前活躍 role 的 permissions JSONB
  const hasPermission = (key) => {
    if (me.is_super_admin === true) return true
    if (isAdminOfActive) return true  // 公司 admin 在自己公司是全權的
    return activeRole?.permissions?.[key] === true
  }

  return {
    myBindings,
    switchableCompanies,
    activeCompanyId,
    setActiveCompanyId,
    activeCompany,
    activeBinding,
    activeRole,
    isAdminOfActive,
    isAdminOfAny,
    hasMultipleCompanies,
    hasPermission,
    isSuperAdmin: me.is_super_admin === true,
  }
}

// ====================  ADMIN APP ROOT  ====================
export default function AdminApp({ me, session, view, setView }) {
  const { t } = useT()
  const isMobile = useIsMobile()
  const data = useAdminData()
  const ctx = useMyContext(me, data)
  const [showProfile, setShowProfile] = useState(false)

  // view 按權限 fallback
  const isSales = me.role === '銷售'
  const canEmployees = ctx.isSuperAdmin || ctx.isAdminOfAny || ctx.hasPermission('can_manage_employees')
  const canCompanies = ctx.isSuperAdmin
  const canAccountReview = ctx.isSuperAdmin || ctx.isAdminOfAny || ctx.hasPermission('can_approve_registration')
  const canCommission = ctx.isSuperAdmin || ctx.hasPermission('can_view_commission') || isSales
  const canManageRoles = ctx.isSuperAdmin || ctx.isAdminOfActive || ctx.hasPermission('can_manage_roles')
  const allowedViews = ['tasks', 'updatelog']
  if (canEmployees) allowedViews.push('employees')
  if (canCompanies) allowedViews.push('companies')
  if (canManageRoles) allowedViews.push('roles')
  if (canAccountReview) allowedViews.push('accountreview')
  if (canCommission) allowedViews.push('commission')
  const safeView = allowedViews.includes(view) ? view : 'tasks'

  return (
    <div style={{ minHeight: '100vh', background: c.bg, fontFamily: font.ui, color: c.text, WebkitFontSmoothing: 'antialiased' }}>
      <AdminTopBar me={me} ctx={ctx} data={data} view={safeView} setView={setView} isMobile={isMobile} pendingCount={data.pendings.filter(p => p.approved == null).length} onProfileClick={() => setShowProfile(true)} canEmployees={canEmployees} canCompanies={canCompanies} canAccountReview={canAccountReview} canCommission={canCommission} canManageRoles={canManageRoles} />
      <main style={{ maxWidth: 1500, margin: '0 auto', padding: isMobile ? '12px 12px' : '18px 24px' }}>
        {safeView === 'tasks' && <TasksView data={data} me={me} session={session} isMobile={isMobile} ctx={ctx} />}
        {safeView === 'employees' && canEmployees && <EmployeesView data={data} me={me} isMobile={isMobile} ctx={ctx} />}
        {safeView === 'companies' && canCompanies && <CompaniesView data={data} />}
        {safeView === 'accountreview' && canAccountReview && <AccountReviewView data={data} me={me} session={session} />}
        {safeView === 'commission' && canCommission && (
          <CommissionView employees={ctx.isSuperAdmin ? data.employees : [me]} me={me} lockedEmpId={ctx.isSuperAdmin ? null : me.id} />
        )}
        {safeView === 'roles' && canManageRoles && <RolesAndDepartmentsView data={data} ctx={ctx} />}
        {safeView === 'updatelog' && <UpdateLogView me={me} session={session} isMobile={isMobile} />}
      </main>
      {showProfile && <ProfileModal me={me} data={data} onClose={() => setShowProfile(false)} />}
    </div>
  )
}

function AdminTopBar({ me, ctx, data, view, setView, isMobile, pendingCount, onProfileClick, canEmployees, canCompanies, canAccountReview, canCommission, canManageRoles }) {
  const { t, lang, setLang } = useT()
  const isSales = me.role === '銷售'
  // 只 Honnmono 公司可以跳 bizflow 主端（其他公司沒有 bizflow 後台）
  // super admin 在任意公司視角看 Honnmono 也算（兜底）
  const isHonnmonoActive = ctx.activeCompany?.name === 'Honnmono'
  const canGoBizflow = isHonnmonoActive || ctx.isSuperAdmin
  const navs = [
    ['tasks', t('任務'), true],
    ['employees', t('員工管理'), canEmployees],
    ['companies', t('公司管理'), canCompanies],
    ['roles', t('職位 / 權限 / 部門管理'), canManageRoles],
    ['accountreview', t('帳號審核'), canAccountReview],
    ['commission', ctx.isSuperAdmin ? t('佣金') : t('我的佣金'), canCommission],
    ['updatelog', t('更新日誌'), true],
  ].filter(([, , show]) => show)

  // 顯示當前公司名（多公司綁定的人才能切換）
  const titleNode = canGoBizflow ? (
    <a href={import.meta.env.VITE_BIZFLOW_URL || 'https://bizflowhonnmono.vercel.app'} style={{ fontSize: 15, fontWeight: 700, color: c.text, letterSpacing: -0.2, whiteSpace: 'nowrap', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }} title={t('返回 bizflow 主端')}>
      <span style={{ fontSize: 13, color: c.textMuted }}>←</span>
      Honnmono Team
    </a>
  ) : (
    <span style={{ fontSize: 15, fontWeight: 700, color: c.text, letterSpacing: -0.2, whiteSpace: 'nowrap' }}>
      {ctx.activeCompany?.name || 'Team'}
    </span>
  )

  return (
    <header style={{ background: c.card, borderBottom: `1px solid ${c.border}`, padding: isMobile ? '10px 14px' : '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 28, overflowX: 'auto' }}>
        {titleNode}
        {ctx.hasMultipleCompanies && (
          <select value={ctx.activeCompanyId || ''} onChange={e => ctx.setActiveCompanyId(e.target.value)}
            style={{ fontSize: 12, padding: '4px 8px', border: `1px solid ${c.border}`, borderRadius: 6, background: c.bg, color: c.text, fontFamily: font.ui, cursor: 'pointer' }}>
            {ctx.switchableCompanies.map(b => {
              const co = data.companies.find(co => co.id === b.company_id)
              return <option key={b.company_id} value={b.company_id}>{co?.name || '?'}{b.is_default ? ' ★' : ''}</option>
            })}
          </select>
        )}
        <nav style={{ display: 'flex', gap: 2 }}>
          {navs.map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} style={{ ...S.navBtn(view === k), position: 'relative', whiteSpace: 'nowrap' }}>
              {label}
              {k === 'accountreview' && pendingCount > 0 && <span style={{ position: 'absolute', top: -2, right: -4, background: c.red, color: '#fff', fontSize: 9, borderRadius: 8, padding: '1px 5px', fontWeight: 700 }}>{pendingCount}</span>}
            </button>
          ))}
        </nav>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', gap: 2, padding: 2, background: c.bg, borderRadius: 6 }}>
          {[{ v: 'zh', l: '繁' }, { v: 'en', l: 'EN' }, { v: 'fr', l: 'FR' }].map(opt => (
            <button key={opt.v} onClick={() => setLang(opt.v)}
              style={{ padding: '3px 8px', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: lang === opt.v ? c.accent : 'transparent', color: lang === opt.v ? '#fff' : c.textMuted, fontFamily: font.ui }}>
              {opt.l}
            </button>
          ))}
        </div>
        <button onClick={onProfileClick} title={t('編輯個人資料')} style={{ fontSize: 12, color: c.text, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: isMobile ? 'none' : 'inline', fontFamily: font.ui, textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>{me.name}</button>
        <button onClick={() => supabase.auth.signOut()} style={S.btnGhostSm}>{t('登出')}</button>
      </div>
    </header>
  )
}


// ====================  EMPLOYEES VIEW (admin)  ====================
function EmployeesView({ data, me, isMobile, ctx }) {
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
      await supabase.from('employee_tasks').delete()
        .eq('creator_employee_id', emp.id)
        .eq('company_id', targetCompanyId)
      // 刪該員工在本公司任務的 assignees 行（A 是 assignee 不是 creator 的情況）
      const { data: companyTasks } = await supabase.from('employee_tasks')
        .select('id').eq('company_id', targetCompanyId)
      if (companyTasks && companyTasks.length > 0) {
        await supabase.from('task_assignees').delete()
          .eq('employee_id', emp.id)
          .in('task_id', companyTasks.map(tk => tk.id))
      }
      // 刪 binding
      const { error: bErr } = await supabase.from('employee_companies').delete()
        .eq('employee_id', emp.id)
        .eq('company_id', targetCompanyId)
      if (bErr) throw bErr
      // 變孤兒 → 標停用
      if (willBeOrphan) {
        await supabase.from('employees').update({
          active: false,
          deactivated_at: new Date().toISOString(),
        }).eq('id', emp.id)
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
        <button onClick={() => setShowAdd(true)} style={S.btnPrimary}>＋ {t('新增員工')}</button>
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

      {showAdd && <NewEmployeeModal companies={companies} onClose={() => setShowAdd(false)} onSaved={refresh} />}
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
  const contextCompanyName = contextBinding ? companies.find(co => co.id === contextBinding.company_id)?.name : null

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

function NewEmployeeModal({ companies, onClose, onSaved }) {
  const { t } = useT()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [companyId, setCompanyId] = useState(companies[0]?.id || '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) return alert(t('姓名必填'))
    setBusy(true)
    const { error } = await supabase.from('employees').insert({
      name: name.trim(), role: role.trim() || null, phone: phone.trim() || null,
      email: email.trim() || null, company_id: companyId || null, kind: 'employee',
    })
    setBusy(false)
    if (error) return alert(t('新增失敗：') + error.message)
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
        <Field label={t('職位')}><input value={role} onChange={e => setRole(e.target.value)} style={S.input} placeholder={t('例如 客服 / 技術 / 銷售')} /></Field>
        <Field label={t('公司')}><select value={companyId} onChange={e => setCompanyId(e.target.value)} style={S.input}>
          <option value="">—</option>
          {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
        </select></Field>
        <Field label={t('電話')}><input value={phone} onChange={e => setPhone(e.target.value)} style={S.input} placeholder="+852" /></Field>
        <Field label="Email"><input value={email} onChange={e => setEmail(e.target.value)} style={S.input} placeholder="email@example.com" /></Field>
        <div style={{ fontSize: 10, color: c.textFaint, marginBottom: 10 }}>{t('備註：員工 auth 帳號（user_id）需在 Supabase 後台另行創建並綁定。')}</div>
        <button onClick={save} disabled={busy || !name.trim()} style={{ ...S.btnPrimary, width: '100%', opacity: (busy || !name.trim()) ? 0.4 : 1 }}>{busy ? t('處理中…') : t('儲存')}</button>
      </div>
    </div>
  )
}

// ====================  PROFILE (個人資料 + 修改密碼 modal，所有角色用)  ====================
//   RLS employees_self_update 允許本人改：name/role/phone/email/note/show_update_log
//   鎖：is_admin / company_id / kind / active / user_id（管理員管）
function ProfileModal({ me, data, onClose }) {
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

// ====================  ACCOUNT REVIEW  ====================
function AccountReviewView({ data, me, session }) {
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

