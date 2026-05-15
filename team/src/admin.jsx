import React, { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabaseClient.js'
import { c, radius, font, S, fetchAllTable, useIsMobile, Center, Empty, Field, Section, fmtShort, fmtDateTime } from './styles.jsx'
import { useT } from './i18n.jsx'
import { UpdateLogView } from './App.jsx'

// ============================================================
//  Admin 視角：員工管理 / 任務看板 / 帳號審核 / 佣金 / 更新日誌
// ============================================================

const HELEN_EMAIL = 'a1017339632@gmail.com'

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
  ['can_view_commission', '看佣金'],
  ['can_manage_roles', '管理職位'],
  ['can_post_update_log', '發更新日誌'],
]

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

  const assigneesByTask = useMemo(() => {
    const m = new Map()
    for (const a of assignees) {
      const list = m.get(a.task_id) || []
      list.push(a); m.set(a.task_id, list)
    }
    return m
  }, [assignees])

  return { employees, companies, empCompanies, roles, tasks, assignees, feedbacks, pendings, joinPendings, assigneesByTask, loading: qEmployees.isLoading || qTasks.isLoading }
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
  const canEmployees = ctx.isSuperAdmin || ctx.isAdminOfAny
  const canCompanies = ctx.isSuperAdmin
  const canAccountReview = ctx.isSuperAdmin || ctx.isAdminOfAny
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
        {safeView === 'roles' && canManageRoles && <RolesView data={data} ctx={ctx} />}
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
    ['roles', t('職位管理'), canManageRoles],
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

// ====================  TASK HELPERS  ====================
function isTaskAssignedTo(task, empId, assigneesByTask) {
  const list = assigneesByTask.get(task.id) || []
  if (list.some(a => a.employee_id === empId)) return true
  return list.length === 0 && task.employee_id === empId
}
function empDoneFor(task, empId, assigneesByTask) {
  const list = assigneesByTask.get(task.id) || []
  const row = list.find(a => a.employee_id === empId)
  if (row) return row.completed_at != null && row.abandoned_at == null
  return task.status === 'done'
}
function empAbandonedFor(task, empId, assigneesByTask) {
  const list = assigneesByTask.get(task.id) || []
  const row = list.find(a => a.employee_id === empId)
  if (row) return row.abandoned_at != null
  return task.status === 'abandoned'
}
function isAwaitingApproval(task, assigneesByTask) {
  if (!task.needs_approval) return false
  if (task.approved_at) return false
  if (task.status !== 'open') return false
  const list = assigneesByTask.get(task.id) || []
  if (list.length === 0) return false
  return list.every(a => a.completed_at != null || a.abandoned_at != null)
}

// ====================  TASKS VIEW (admin) ====================
function TasksView({ data, me, session, isMobile, ctx }) {
  const { t } = useT()
  const { employees: allEmployees, companies, empCompanies, tasks: allTasks, assignees, feedbacks, assigneesByTask } = data
  const queryClient = useQueryClient()
  const userId = session.user.id

  // 按當前活躍公司（ctx.activeCompanyId）過濾員工 + 任務
  const empIdsInActive = useMemo(
    () => new Set(empCompanies.filter(ec => ec.company_id === ctx.activeCompanyId).map(ec => ec.employee_id)),
    [empCompanies, ctx.activeCompanyId]
  )
  const employees = useMemo(
    () => allEmployees.filter(e => e.active !== false && empIdsInActive.has(e.id)),
    [allEmployees, empIdsInActive]
  )
  const tasks = useMemo(
    () => allTasks.filter(t => t.company_id === ctx.activeCompanyId),
    [allTasks, ctx.activeCompanyId]
  )
  // 包裝 data 給子組件用（任務/員工已按公司過濾，其他不變）
  const scopedData = useMemo(
    () => ({ ...data, tasks, employees }),
    [data, tasks, employees]
  )
  const visibleEmployees = employees  // 別名兼容

  // mode：super admin 預設 overview；其他人預設選自己
  const [mode, setMode] = useState(ctx.isSuperAdmin || ctx.isAdminOfActive ? 'overview' : 'list')
  const [selectedEmpId, setSelectedEmpId] = useState(ctx.isSuperAdmin || ctx.isAdminOfActive ? null : me.id)
  const [editingTask, setEditingTask] = useState(null)
  const [overviewExpanded, setOverviewExpanded] = useState(new Set())

  // companyFilter 已被頂部公司切換器取代，這裡保留 stub 給子組件兼容
  const companyFilter = ctx.activeCompanyId
  const setCompanyFilter = () => {}

  const selectedEmp = selectedEmpId ? employees.find(e => e.id === selectedEmpId) : null

  if (isMobile) {
    return (
      <div>
        {selectedEmp ? (
          <div>
            <button onClick={() => setSelectedEmpId(null)} style={{ ...S.btnGhostSm, marginBottom: 12 }}>← {t('返回員工列表')}</button>
            <TaskBoard emp={selectedEmp} data={scopedData} me={me} userId={userId} setEditingTask={setEditingTask} companyId={ctx.activeCompanyId} compact />
          </div>
        ) : (
          <EmpListMobile employees={visibleEmployees} companies={companies} companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} tasks={tasks} assigneesByTask={assigneesByTask} onSelect={(e) => setSelectedEmpId(e.id)} me={me} />
        )}
        {editingTask && <EditTaskModal task={editingTask} data={scopedData} me={me} userId={userId} onClose={() => setEditingTask(null)} />}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 18, minHeight: 'calc(100vh - 80px)' }}>
      <EmpSidebar
        employees={visibleEmployees} companies={companies} companyFilter={companyFilter} setCompanyFilter={setCompanyFilter}
        mode={mode} setMode={setMode} selectedEmpId={selectedEmpId} setSelectedEmpId={setSelectedEmpId}
        tasks={tasks} assigneesByTask={assigneesByTask} me={me}
      />
      <div>
        {mode === 'overview' ? (
          <OverviewView employees={visibleEmployees} tasks={tasks} assigneesByTask={assigneesByTask} expanded={overviewExpanded} setExpanded={setOverviewExpanded} setEditingTask={setEditingTask} />
        ) : selectedEmp ? (
          <TaskBoard emp={selectedEmp} data={scopedData} me={me} userId={userId} setEditingTask={setEditingTask} companyId={ctx.activeCompanyId} />
        ) : (
          <Empty>← {t('從左側選擇員工查看任務看板')}</Empty>
        )}
      </div>
      {editingTask && <EditTaskModal task={editingTask} data={scopedData} me={me} userId={userId} onClose={() => setEditingTask(null)} />}
    </div>
  )
}

// ====================  員工側欄  ====================
function EmpSidebar({ employees, companies, companyFilter, setCompanyFilter, mode, setMode, selectedEmpId, setSelectedEmpId, tasks, assigneesByTask, me }) {
  const { t } = useT()
  return (
    <aside style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg, padding: 14, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 100px)' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{t('員工')} <span style={{ fontSize: 11, color: c.textFaint, fontWeight: 400 }}>{employees.length}</span></div>
        {me.is_admin && (
          <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)} style={{ ...S.input, marginBottom: 0, fontSize: 12, padding: '6px 8px' }}>
            <option value="all">{t('所有公司')}</option>
            {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
          </select>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div onClick={() => { setMode('overview'); setSelectedEmpId(null) }} style={{ background: mode === 'overview' ? c.accentBg : c.bg, border: `1px solid ${mode === 'overview' ? c.accent : c.border}`, borderRadius: radius.md, padding: '10px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: mode === 'overview' ? c.accent : c.text }}>
          📊 {t('任務總覽')}
        </div>
        {employees.length === 0 ? (
          <Empty>{t('無員工')}</Empty>
        ) : employees.map(e => {
          const openCount = tasks.filter(t => isTaskAssignedTo(t, e.id, assigneesByTask) && !t.parent_task_id && !empDoneFor(t, e.id, assigneesByTask) && !empAbandonedFor(t, e.id, assigneesByTask)).length
          const doneCount = tasks.filter(t => isTaskAssignedTo(t, e.id, assigneesByTask) && !t.parent_task_id && empDoneFor(t, e.id, assigneesByTask)).length
          const active = mode === 'list' && selectedEmpId === e.id
          return (
            <div key={e.id} onClick={() => { setMode('list'); setSelectedEmpId(e.id) }} style={{ background: active ? c.accentBg : c.bg, border: `1px solid ${active ? c.accent : c.border}`, borderRadius: radius.md, padding: '10px 12px', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#7c9dff,#a78bfa)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{(e.name || '?').slice(0, 1)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: active ? c.accent : c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                  {e.role && <div style={{ fontSize: 10, color: c.textFaint }}>{e.role}</div>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, fontSize: 11, color: c.textMuted, marginTop: 6 }}>
                <span><span style={{ fontWeight: 700, color: c.accent }}>{openCount}</span> {t('進行')}</span>
                <span><span style={{ fontWeight: 700, color: c.green }}>{doneCount}</span> {t('完成')}</span>
                {!e.user_id && <span style={{ fontSize: 9, color: c.textFaint, marginLeft: 'auto' }}>{t('未綁帳號')}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function EmpListMobile({ employees, companies, companyFilter, setCompanyFilter, tasks, assigneesByTask, onSelect, me }) {
  const { t } = useT()
  return (
    <div>
      {me?.is_admin && (
        <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)} style={{ ...S.input, marginBottom: 10, fontSize: 12 }}>
          <option value="all">{t('所有公司')}</option>
          {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
        </select>
      )}
      {employees.map(e => {
        const openCount = tasks.filter(tk => isTaskAssignedTo(tk, e.id, assigneesByTask) && !tk.parent_task_id && !empDoneFor(tk, e.id, assigneesByTask) && !empAbandonedFor(tk, e.id, assigneesByTask)).length
        return (
          <div key={e.id} onClick={() => onSelect(e)} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.md, padding: 12, marginBottom: 8, cursor: 'pointer' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{e.name}</div>
            <div style={{ fontSize: 11, color: c.textMuted, marginTop: 4 }}>{openCount} {t('進行中')}</div>
          </div>
        )
      })}
    </div>
  )
}

// ====================  TASK OVERVIEW  ====================
function OverviewView({ employees, tasks, assigneesByTask, expanded, setExpanded, setEditingTask }) {
  const { t } = useT()
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 18, letterSpacing: -0.3 }}>{t('任務總覽')}</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {employees.map(e => {
          const isExp = expanded.has(e.id)
          const ownsT = (tk) => isTaskAssignedTo(tk, e.id, assigneesByTask) || e.id === tk.creator_employee_id
          const empOpen = tasks.filter(tk => ownsT(tk) && !tk.parent_task_id && tk.status === 'open' && !empDoneFor(tk, e.id, assigneesByTask) && !empAbandonedFor(tk, e.id, assigneesByTask))
          const empDone = tasks.filter(tk => ownsT(tk) && !tk.parent_task_id && empDoneFor(tk, e.id, assigneesByTask))
            .sort((a, b) => new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at)).slice(0, 5)
          const high = empOpen.filter(tk => tk.priority === 'high')
          const mid = empOpen.filter(tk => tk.priority === 'mid')
          const low = empOpen.filter(tk => tk.priority === 'low' || tk.priority === 'none' || !tk.priority)
          const groups = [
            { key: 'high', label: t('高優先級'), color: c.red, list: high },
            { key: 'mid', label: t('中優先級'), color: c.amber, list: mid },
            { key: 'low', label: t('低優先級'), color: c.green, list: low },
          ]
          return (
            <div key={e.id} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg }}>
              <div onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n })} style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 11, color: c.textMuted, width: 10 }}>{isExp ? '▼' : '▶'}</span>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#7c9dff,#a78bfa)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{(e.name || '?').slice(0, 1)}</div>
                <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{e.name}</div>
                <span style={{ fontSize: 11, color: c.accent, fontWeight: 600 }}>{empOpen.length} {t('進行')}</span>
                <span style={{ fontSize: 11, color: c.green, fontWeight: 600 }}>{empDone.length} {t('完成')}</span>
              </div>
              {isExp && (
                <div style={{ padding: '0 16px 14px', borderTop: `1px solid ${c.border}` }}>
                  {groups.map(g => g.list.length > 0 && (
                    <div key={g.key} style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: g.color, marginBottom: 6 }}>{g.label} <span style={{ color: c.textFaint, fontWeight: 400 }}>· {g.list.length}</span></div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {g.list.map(tk => (
                          <div key={tk.id} onClick={() => setEditingTask(tk)} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: radius.sm, padding: '7px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{tk.title}</span>
                            {tk.due_date && <span style={{ fontSize: 10, color: c.textFaint }}>{tk.due_date}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {empOpen.length === 0 && <div style={{ marginTop: 12, fontSize: 12, color: c.textFaint, fontStyle: 'italic' }}>{t('沒有進行中任務')}</div>}
                  {empDone.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: c.textMuted, marginBottom: 6 }}>{t('最近完成')} <span style={{ color: c.textFaint, fontWeight: 400 }}>· {empDone.length}</span></div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {empDone.map(tk => (
                          <div key={tk.id} onClick={() => setEditingTask(tk)} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: radius.sm, padding: '7px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: 0.7 }}>
                            <span style={{ flex: 1, fontSize: 12, color: c.textMuted, textDecoration: 'line-through' }}>{tk.title}</span>
                            <span style={{ fontSize: 10, color: c.green }}>✓ {fmtShort(tk.completed_at)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ====================  TASK BOARD（單員工任務看板）  ====================
function TaskBoard({ emp, data, me, userId, setEditingTask, compact, companyId }) {
  const { t } = useT()
  const { employees, tasks, feedbacks, assigneesByTask } = data
  const queryClient = useQueryClient()

  // emp 是 assignee 或 creator 的任務
  const empOwnsTask = (tk) => isTaskAssignedTo(tk, emp.id, assigneesByTask) || emp.id === tk.creator_employee_id
  // 顶级展示：非子任务 OR「孤兒」子任务（父任務 emp 不沾，那子任務在 emp 视圖里要独立顯示）
  const topTasks = tasks.filter(tk => {
    if (!empOwnsTask(tk)) return false
    if (!tk.parent_task_id) return true
    const parent = tasks.find(p => p.id === tk.parent_task_id)
    return !parent || !empOwnsTask(parent)
  })
  const allEmpTasks = tasks.filter(tk => empOwnsTask(tk))
  const oneEightyDaysAgo = Date.now() - 180 * 86400000
  const within180 = (tk) => {
    const list = assigneesByTask.get(tk.id) || []
    const row = list.find(a => a.employee_id === emp.id)
    const ts = row?.completed_at || tk.completed_at || tk.created_at
    return new Date(ts).getTime() >= oneEightyDaysAgo
  }
  const showInTerminal = (tk) => {
    if (!tk.parent_task_id) return true
    const parent = allEmpTasks.find(p => p.id === tk.parent_task_id)
    if (!parent) return true
    return parent.status === 'open'
  }
  const eDone = (tk) => empDoneFor(tk, emp.id, assigneesByTask)
  const eAb = (tk) => empAbandonedFor(tk, emp.id, assigneesByTask)
  const isAssignee = (tk) => isTaskAssignedTo(tk, emp.id, assigneesByTask)
  const isCreator = (tk) => emp.id === tk.creator_employee_id

  const showInOpen = (tk) => {
    if (isCreator(tk) && isAwaitingApproval(tk, assigneesByTask)) return true
    if (tk.status !== 'open') return false
    if (isAssignee(tk)) return !eDone(tk) && !eAb(tk)
    return true
  }
  const showInDone = (tk) => {
    if (isCreator(tk) && isAwaitingApproval(tk, assigneesByTask)) return false
    if (isAssignee(tk)) return eDone(tk) && !eAb(tk)
    return tk.status === 'done'
  }
  const showInAb = (tk) => {
    if (isAssignee(tk)) return eAb(tk) && !eDone(tk)
    return tk.status === 'abandoned'
  }

  const cols = {
    high: topTasks.filter(tk => tk.priority === 'high' && showInOpen(tk)),
    mid: topTasks.filter(tk => tk.priority === 'mid' && showInOpen(tk)),
    low: topTasks.filter(tk => (tk.priority === 'low' || tk.priority === 'none' || !tk.priority) && showInOpen(tk)),
    done: allEmpTasks.filter(tk => showInDone(tk) && within180(tk) && showInTerminal(tk)),
    abandoned: allEmpTasks.filter(tk => showInAb(tk) && within180(tk) && showInTerminal(tk)),
  }

  // 反饋（僅顯示 emp 未完成的 task；每個 task 取最近一條作摘要，展開後看全部）
  const empTaskIds = new Set(tasks.filter(tk =>
    isTaskAssignedTo(tk, emp.id, assigneesByTask)
    && !empDoneFor(tk, emp.id, assigneesByTask)
    && !empAbandonedFor(tk, emp.id, assigneesByTask)
  ).map(tk => tk.id))
  const fbByTask = new Map()
  for (const fb of feedbacks) {
    if (!empTaskIds.has(fb.task_id)) continue
    const cur = fbByTask.get(fb.task_id)
    if (!cur || new Date(fb.created_at) > new Date(cur.created_at)) fbByTask.set(fb.task_id, fb)
  }
  const fbList = Array.from(fbByTask.entries()).map(([tid, fb]) => {
    const tk = tasks.find(x => x.id === tid)
    return tk ? { ...tk, _fb: fb } : null
  }).filter(Boolean).sort((a, b) => new Date(b._fb.created_at) - new Date(a._fb.created_at))

  // 標記完成（個人 task_assignees.completed_at toggle）
  const toggleDone = async (task) => {
    const list = assigneesByTask.get(task.id) || []
    const row = list.find(a => a.employee_id === emp.id)
    if (!row) return alert(t('員工不在此任務 assignees'))
    const nextTs = row.completed_at ? null : new Date().toISOString()
    const { error } = await supabase.from('task_assignees').update({ completed_at: nextTs, abandoned_at: null }).eq('task_id', task.id).eq('employee_id', emp.id)
    if (error) return alert(error.message)
    // 自動更新 task.status（全員完成 + 不需核驗）
    const updated = list.map(a => a.employee_id === emp.id ? { ...a, completed_at: nextTs, abandoned_at: null } : a)
    const allDone = updated.every(a => a.completed_at != null)
    if (allDone && !task.needs_approval && task.status !== 'done') {
      await supabase.from('employee_tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', task.id)
    } else if (!allDone && task.status === 'done') {
      await supabase.from('employee_tasks').update({ status: 'open', completed_at: null }).eq('id', task.id)
    }
    queryClient.invalidateQueries({ queryKey: ['admin', 'task_assignees'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_tasks'] })
  }

  const renderCard = (task) => {
    const myRow = (assigneesByTask.get(task.id) || []).find(a => a.employee_id === emp.id)
    const isEmpAssignee = !!myRow
    const isDone = isEmpAssignee ? eDone(task) : task.status === 'done'
    const isAb = isEmpAssignee ? eAb(task) : task.status === 'abandoned'
    const subtasks = tasks.filter(s => s.parent_task_id === task.id)
    const subDone = subtasks.filter(s => s.status === 'done').length
    const fbCount = feedbacks.filter(f => f.task_id === task.id).length
    const list = assigneesByTask.get(task.id) || []
    return (
      <div key={task.id} onClick={(e) => { if (e.target.tagName !== 'INPUT') setEditingTask(task) }} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.md, padding: '9px 11px', marginBottom: 6, opacity: (isDone || isAb) ? 0.55 : 1, cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <input type="checkbox" checked={isDone} disabled={!isEmpAssignee} onChange={() => isEmpAssignee && toggleDone(task)} onClick={e => e.stopPropagation()} style={{ width: 14, height: 14, marginTop: 2, cursor: isEmpAssignee ? 'pointer' : 'not-allowed' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {task.parent_task_id && (() => {
              const parent = tasks.find(p => p.id === task.parent_task_id)
              return parent ? <div style={{ fontSize: 10, color: c.textFaint, marginBottom: 2 }}>↳ {parent.title}</div> : null
            })()}
            <div style={{ fontSize: 13, fontWeight: 500, textDecoration: isDone ? 'line-through' : 'none', color: (isDone || isAb) ? c.textMuted : c.text, lineHeight: 1.4 }}>{task.title}</div>
            <div style={{ fontSize: 10, color: c.textFaint, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {task.creator_employee_id && task.creator_employee_id !== emp.id && (() => {
                const cr = employees.find(x => x.id === task.creator_employee_id)
                return cr ? <span style={{ background: c.accentBg, color: c.accent, padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>{cr.name} {t('分配')}</span> : null
              })()}
              {task.due_date && (() => {
                const days = Math.ceil((new Date(task.due_date) - new Date()) / 86400000)
                if (isDone || isAb) return <span>⏰ {task.due_date}</span>
                if (days < 0) return <span style={{ color: c.red, fontWeight: 600 }}>⚠ {task.due_date}（{t('過期')} {Math.abs(days)}d）</span>
                if (days <= 3) return <span style={{ color: c.amber, fontWeight: 600 }}>⏰ {task.due_date}（{days}d）</span>
                return <span>⏰ {task.due_date}</span>
              })()}
              {subtasks.length > 0 && <span>☑ {subDone}/{subtasks.length}</span>}
              {fbCount > 0 && <span style={{ color: c.amber }}>💬 {fbCount}</span>}
              {Array.isArray(task.attachments) && task.attachments.length > 0 && <span style={{ color: c.accent }}>📎 {task.attachments.length}</span>}
              {list.length > 1 && (
                <span style={{ display: 'inline-flex', gap: 3 }}>
                  {list.map((a, i) => {
                    const e2 = employees.find(x => x.id === a.employee_id)
                    if (!e2) return null
                    const done = a.completed_at != null
                    const ab = a.abandoned_at != null
                    return <span key={a.employee_id} style={{ color: done ? c.green : ab ? c.textFaint : c.accent, fontWeight: 600, textDecoration: ab ? 'line-through' : 'none' }}>{done ? '✓' : ab ? '✗' : ''}{e2.name}{i < list.length - 1 ? '·' : ''}</span>
                  })}
                </span>
              )}
              {isAwaitingApproval(task, assigneesByTask) && (() => {
                const cr = employees.find(x => x.id === task.creator_employee_id)
                return <span style={{ background: c.amberBg, color: c.amber, padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>{t('等待')} {cr?.name || t('發布人')} {t('核驗')}</span>
              })()}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const colBox = (title, color, items) => (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: radius.lg, padding: 12, minHeight: 220, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{title}</span>
        <span style={{ fontSize: 11, color: c.textFaint }}>{items.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>{items.map(tk => renderCard(tk))}</div>
    </div>
  )

  // 只有 admin / 本人 / 同公司同事可新增任務（普通員工給同事分配，沿用 bizflow 邏輯）
  const canCreate = me.is_admin || emp.id === me.id || (me.company_id && emp.company_id === me.company_id)
  const newTaskBlock = canCreate
    ? <NewTaskForm emp={emp} me={me} employees={employees} companyId={companyId} />
    : <div style={{ background: c.card, border: `1px dashed ${c.border}`, borderRadius: radius.lg, padding: 24, textAlign: 'center', color: c.textFaint, fontSize: 12 }}>{t('非本公司同事，無法新增任務')}</div>

  return (
    <div>
      <EmpHeader emp={emp} me={me} />
      {compact ? (
        <div>
          {newTaskBlock}
          {cols.high.length > 0 && colBox(t('高優先級'), c.red, cols.high)}
          {cols.mid.length > 0 && colBox(t('中優先級'), c.amber, cols.mid)}
          {cols.low.length > 0 && colBox(t('低優先級'), c.green, cols.low)}
          {fbList.length > 0 && <FbPanel fbList={fbList} feedbacks={feedbacks} setEditingTask={setEditingTask} />}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: 'auto auto', gap: 12, marginBottom: 16 }}>
          <div style={{ gridColumn: 1, gridRow: 1 }}>{colBox(t('高優先級'), c.red, cols.high)}</div>
          <div style={{ gridColumn: 2, gridRow: 1 }}>{colBox(t('中優先級'), c.amber, cols.mid)}</div>
          <div style={{ gridColumn: 3, gridRow: '1 / 3' }}>{newTaskBlock}</div>
          <div style={{ gridColumn: 1, gridRow: 2 }}><FbPanel fbList={fbList} feedbacks={feedbacks} setEditingTask={setEditingTask} /></div>
          <div style={{ gridColumn: 2, gridRow: 2 }}>{colBox(t('低優先級'), c.green, cols.low)}</div>
        </div>
      )}
      {(cols.abandoned.length > 0 || cols.done.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 1fr', gap: 12 }}>
          {cols.abandoned.length > 0 && (
            <details>
              <summary style={{ fontSize: 13, fontWeight: 600, color: c.textMuted, cursor: 'pointer', padding: '8px 0' }}>{t('已放棄')} <span style={{ color: c.textFaint, marginLeft: 4 }}>{cols.abandoned.length}</span></summary>
              <div style={{ marginTop: 6 }}>{cols.abandoned.map(tk => renderCard(tk))}</div>
            </details>
          )}
          {cols.done.length > 0 && (
            <details>
              <summary style={{ fontSize: 13, fontWeight: 600, color: c.green, cursor: 'pointer', padding: '8px 0' }}>{t('已完成')} <span style={{ color: c.textFaint, marginLeft: 4 }}>{cols.done.length}</span></summary>
              <div style={{ marginTop: 6 }}>{cols.done.map(tk => renderCard(tk))}</div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// 員工頭部（admin 視角顯示）
function EmpHeader({ emp, me }) {
  const { t } = useT()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, padding: '4px 0' }}>
      <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,#7c9dff,#a78bfa)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700 }}>{(emp.name || '?').slice(0, 1)}</div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{emp.name}</div>
        <div style={{ fontSize: 12, color: c.textMuted }}>{[emp.role, emp.phone, emp.email].filter(Boolean).join(' · ') || '—'}</div>
      </div>
    </div>
  )
}

// 反饋面板（只看 emp 未完成 task；卡片可展開看全部反饋）
function FbPanel({ fbList, feedbacks, setEditingTask }) {
  const { t } = useT()
  const [expanded, setExpanded] = useState(new Set())
  const toggle = (id) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  return (
    <div style={{ background: c.amberBg, border: `1px solid #fde68a`, borderRadius: radius.lg, padding: 12, minHeight: 220 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#a16207', marginBottom: 8 }}>💬 {t('任務反饋記錄')} <span style={{ fontSize: 11, color: '#b88a00' }}>{fbList.length}</span></div>
      {fbList.length === 0 ? (
        <div style={{ fontSize: 11, color: '#b88a00', fontStyle: 'italic' }}>{t('暫無反饋')}</div>
      ) : fbList.map(tk => {
        const allFbs = feedbacks.filter(f => f.task_id === tk.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        const isExp = expanded.has(tk.id)
        return (
          <div key={tk.id} style={{ background: c.card, border: `1px solid #fde68a`, borderRadius: radius.sm, padding: '8px 10px', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <button type="button" onClick={() => toggle(tk.id)} title={isExp ? t('收起') : t('展開全部反饋')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b88a00', fontSize: 10, padding: 0, width: 12, lineHeight: 1 }}>{isExp ? '▼' : '▶'}</button>
              <span onClick={() => setEditingTask(tk)} style={{ fontSize: 12, fontWeight: 600, flex: 1, cursor: 'pointer' }}>{tk.title}</span>
              {allFbs.length > 1 && <span style={{ fontSize: 10, color: '#b88a00' }}>{allFbs.length}</span>}
            </div>
            {!isExp ? (
              <div onClick={() => setEditingTask(tk)} style={{ cursor: 'pointer' }}>
                <div style={{ fontSize: 10, color: '#b88a00', marginBottom: 2 }}>{tk._fb.author_name || t('未知')} · {fmtDateTime(tk._fb.created_at)}</div>
                <div style={{ fontSize: 11, color: '#8a6900', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', whiteSpace: 'pre-wrap' }}>{tk._fb.body}</div>
              </div>
            ) : (
              <div style={{ marginTop: 4, borderTop: '1px dashed #fde68a', paddingTop: 6 }}>
                {allFbs.map(fb => (
                  <div key={fb.id} style={{ borderLeft: '2px solid #fde68a', paddingLeft: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: '#b88a00', marginBottom: 1 }}><strong style={{ color: '#a16207' }}>{fb.author_name || '?'}</strong> · {fmtDateTime(fb.created_at)}</div>
                    <div style={{ fontSize: 11, color: '#8a6900', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{fb.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// 新建任務表單
function NewTaskForm({ emp, me, employees, companyId }) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('low')
  const [note, setNote] = useState('')
  const [assigneeIds, setAssigneeIds] = useState(null)  // null = default 用 emp
  const [needsApproval, setNeedsApproval] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [assigneeInput, setAssigneeInput] = useState('')
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [subtaskTitles, setSubtaskTitles] = useState([])  // 子任務標題列表，submit 時一起 INSERT，assignees 沿用父任務

  const effective = assigneeIds === null ? [emp.id] : assigneeIds
  // 候選限本公司（emp 所屬公司）；admin 跨公司請左側切員工
  const sameCo = (e) => emp.company_id ? e.company_id === emp.company_id : true
  const activeEmps = employees.filter(e => e.active !== false && sameCo(e))
  const q = assigneeInput.replace(/^@/, '').toLowerCase()
  const candidates = activeEmps.filter(e => !effective.includes(e.id) && (q === '' || (e.name || '').toLowerCase().includes(q)))

  const submit = async () => {
    if (!title.trim() || effective.length === 0) return
    // company_id fallback：優先 prop，否則用 emp.company_id（任務所屬員工的公司），最後 me.company_id
    const effectiveCompanyId = companyId || emp?.company_id || me.company_id
    if (!effectiveCompanyId) {
      return alert(t('未選定公司，請先在右上角切換公司再新增任務'))
    }
    setBusy(true)
    try {
      const { data, error } = await supabase.from('employee_tasks').insert({
        employee_id: effective[0],
        creator_employee_id: me.id,
        needs_approval: needsApproval,
        title: title.trim(),
        priority,
        note: note.trim() || null,
        due_date: dueDate || null,
        company_id: effectiveCompanyId,
      }).select().single()
      if (error) throw error
      const rows = effective.map(eid => ({ task_id: data.id, employee_id: eid }))
      const { error: ae } = await supabase.from('task_assignees').insert(rows)
      if (ae) throw ae
      if (files.length > 0) {
        const attachments = await Promise.all(files.map(f => uploadAttachment(f, data.id)))
        await supabase.from('employee_tasks').update({ attachments }).eq('id', data.id)
      }
      // 子任務（assignees 沿用父）
      const cleanSubs = subtaskTitles.map(s => s.trim()).filter(Boolean)
      for (const subTitle of cleanSubs) {
        const { data: sub, error: se } = await supabase.from('employee_tasks').insert({
          employee_id: effective[0],
          creator_employee_id: me.id,
          needs_approval: needsApproval,
          title: subTitle,
          priority: 'none',
          parent_task_id: data.id,
          company_id: effectiveCompanyId,
        }).select().single()
        if (se) { console.error('子任務新增失敗', se); continue }
        await supabase.from('task_assignees').insert(effective.map(eid => ({ task_id: sub.id, employee_id: eid })))
      }
      setTitle(''); setNote(''); setPriority('low'); setAssigneeIds(null); setNeedsApproval(false); setDueDate(''); setFiles([]); setSubtaskTitles([])
      queryClient.invalidateQueries({ queryKey: ['admin', 'employee_tasks'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'task_assignees'] })
    } catch (e) {
      alert(t('新增任務失敗：') + (e.message || String(e)))
    } finally { setBusy(false) }
  }

  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg, padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: c.accent, marginBottom: 10 }}>＋ {t('新增任務')}</div>
      <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 4 }}>{t('優先級')}</div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
        {[{ v: 'high', l: t('高'), c: c.red }, { v: 'mid', l: t('中'), c: c.amber }, { v: 'low', l: t('低'), c: c.green }].map(opt => (
          <button key={opt.v} onClick={() => setPriority(opt.v)} style={{ flex: 1, padding: '6px 0', borderRadius: radius.sm, border: `1px solid ${priority === opt.v ? opt.c : c.border}`, background: priority === opt.v ? opt.c + '18' : c.bg, color: priority === opt.v ? opt.c : c.textMuted, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>{opt.l}</button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 4 }}>{t('分配給')} · {effective.length}</div>
      <div style={{ position: 'relative', border: `1px solid ${c.border}`, borderRadius: radius.sm, padding: '4px 6px', marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 3, minHeight: 28, background: c.card }}>
        {effective.map(id => {
          const e2 = employees.find(x => x.id === id)
          return (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 6px', background: c.accentBg, color: c.accent, borderRadius: 9, fontSize: 10, fontWeight: 600 }}>
              @{e2?.name || '?'}
              <button type="button" onClick={() => setAssigneeIds(effective.filter(x => x !== id))} style={{ background: 'none', border: 'none', color: c.accent, cursor: 'pointer', fontSize: 11 }}>×</button>
            </span>
          )
        })}
        <input value={assigneeInput} onChange={e => { setAssigneeInput(e.target.value); setAssigneeOpen(true) }} onFocus={() => setAssigneeOpen(true)} onBlur={() => setTimeout(() => setAssigneeOpen(false), 200)} placeholder={t('@ 加成員')} style={{ flex: 1, minWidth: 60, border: 'none', outline: 'none', fontSize: 11, background: 'transparent' }} />
        {assigneeOpen && candidates.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 3, background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.sm, boxShadow: '0 4px 14px rgba(0,0,0,0.1)', padding: 3, width: '100%', maxHeight: 180, overflowY: 'auto', zIndex: 30 }}>
            {candidates.map(e2 => (
              <button key={e2.id} type="button" onMouseDown={ev => { ev.preventDefault(); setAssigneeIds([...effective, e2.id]); setAssigneeInput('') }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', background: 'none', border: 'none', fontSize: 11, color: c.text, cursor: 'pointer', borderRadius: 3 }}>{e2.name}{e2.role && <span style={{ color: c.textFaint, marginLeft: 4, fontSize: 9 }}>{e2.role}</span>}</button>
            ))}
          </div>
        )}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10, fontSize: 11, color: c.textMuted, cursor: 'pointer' }}>
        <input type="checkbox" checked={needsApproval} onChange={e => setNeedsApproval(e.target.checked)} />{t('完成後需我核驗')}
      </label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('任務標題...')} style={{ ...S.input, marginBottom: 8 }} />
      <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={t('描述 / 備註（可選）')} style={{ ...S.input, minHeight: 60, resize: 'vertical' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: c.textMuted }}>{t('截止：')}</span>
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ padding: '4px 8px', borderRadius: radius.sm, border: `1px solid ${c.border}`, fontSize: 11 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: c.bg, border: `1px dashed ${c.border}`, borderRadius: radius.sm, fontSize: 11, color: c.accent, cursor: 'pointer' }}>
          📎 {t('附件')}
          <input type="file" multiple style={{ display: 'none' }} onChange={e => { const fs = Array.from(e.target.files || []); setFiles(prev => [...prev, ...fs]); e.target.value = '' }} />
        </label>
        {files.map((f, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', background: c.accentBg, borderRadius: radius.sm, fontSize: 10, color: c.accent }}>
            {f.name}
            <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: c.accent, cursor: 'pointer', fontSize: 11 }}>×</button>
          </span>
        ))}
      </div>

      {/* 子任務（assignees 沿用父任務；要單獨改去 EditTaskModal） */}
      <div style={{ marginBottom: 10, paddingTop: 8, borderTop: `1px dashed ${c.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: c.textMuted }}>{t('子任務（可選）')}{subtaskTitles.length > 0 && <span style={{ color: c.textFaint, marginLeft: 4 }}>· {subtaskTitles.length}</span>}</span>
          <button type="button" onClick={() => setSubtaskTitles(prev => [...prev, ''])} style={{ background: c.bg, border: `1px dashed ${c.border}`, borderRadius: radius.sm, padding: '2px 8px', fontSize: 10, color: c.accent, cursor: 'pointer' }}>＋ {t('加子任務')}</button>
        </div>
        {subtaskTitles.map((stTitle, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: c.textFaint, width: 14 }}>{i + 1}.</span>
            <input value={stTitle} onChange={e => setSubtaskTitles(prev => prev.map((v, j) => j === i ? e.target.value : v))} placeholder={t('子任務標題')} style={{ flex: 1, padding: '5px 8px', borderRadius: radius.sm, border: `1px solid ${c.border}`, fontSize: 11, outline: 'none', boxSizing: 'border-box' }} />
            <button type="button" onClick={() => setSubtaskTitles(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: c.textFaint, cursor: 'pointer', fontSize: 13 }}>×</button>
          </div>
        ))}
      </div>

      <button onClick={submit} disabled={busy || !title.trim() || effective.length === 0} style={{ ...S.btnPrimary, width: '100%', opacity: (busy || !title.trim() || effective.length === 0) ? 0.4 : 1 }}>{busy ? t('處理中…') : t('新增任務')}</button>
    </div>
  )
}

// 算出任務所屬公司：取 assignees 中第一個有 company_id 的；fallback creator
function getTaskCompanyId(task, assigneesByTask, employees) {
  const list = assigneesByTask.get(task.id) || []
  for (const a of list) {
    const e = employees.find(x => x.id === a.employee_id)
    if (e?.company_id) return e.company_id
  }
  if (task.creator_employee_id) {
    const cr = employees.find(x => x.id === task.creator_employee_id)
    if (cr?.company_id) return cr.company_id
  }
  return null
}

// 上傳附件到 supabase storage
export async function uploadAttachment(file, taskId) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `${taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('task-attachments').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw error
  const { data: pub } = supabase.storage.from('task-attachments').getPublicUrl(path)
  return { url: pub.publicUrl, name: file.name, size: file.size, type: file.type || 'application/octet-stream' }
}

// ====================  EDIT TASK MODAL  ====================
function EditTaskModal({ task: initial, data, me, userId, onClose }) {
  const { t } = useT()
  const { employees, tasks, feedbacks, assigneesByTask } = data
  const queryClient = useQueryClient()
  const [tk, setTk] = useState(initial)
  // 切到不同 task 時 reset。同 task 內部由本地 state 主導，後台 query 刷新不會吞用戶輸入
  useEffect(() => { setTk(initial) }, [initial.id])

  const tkList = assigneesByTask.get(tk.id) || []
  const isAssignee = tkList.some(a => a.employee_id === me.id)
  const isCreator = tk.creator_employee_id === me.id
  const canEdit = me.is_admin || isCreator
  const ro = !canEdit
  // 公司範圍：所有候選都限本任務所屬公司（admin 通過左側員工列表切換）
  const scopeCompanyId = getTaskCompanyId(tk, assigneesByTask, employees)

  const subtasks = tasks.filter(s => s.parent_task_id === tk.id)
  const fbList = feedbacks.filter(f => f.task_id === tk.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  const updateField = async (patch) => {
    if (ro) return
    setTk(prev => ({ ...prev, ...patch }))
    const { error } = await supabase.from('employee_tasks').update(patch).eq('id', tk.id)
    if (error) { alert(t('更新失敗：') + error.message); return }
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_tasks'] })
  }

  const setAssignees = async (newIds) => {
    if (newIds.length === 0) return alert(t('至少需要一個負責人'))
    const cur = tkList.map(a => a.employee_id)
    const toAdd = newIds.filter(id => !cur.includes(id))
    const toRemove = cur.filter(id => !newIds.includes(id))
    if (toAdd.length > 0) {
      const { error } = await supabase.from('task_assignees').insert(toAdd.map(eid => ({ task_id: tk.id, employee_id: eid })))
      if (error) return alert(t('分配失敗：') + error.message)
    }
    if (toRemove.length > 0) {
      const { error } = await supabase.from('task_assignees').delete().eq('task_id', tk.id).in('employee_id', toRemove)
      if (error) return alert(t('移除失敗：') + error.message)
    }
    // 同步 employee_tasks.employee_id 為新主負責人
    if (tk.employee_id !== newIds[0]) {
      await supabase.from('employee_tasks').update({ employee_id: newIds[0] }).eq('id', tk.id)
    }
    queryClient.invalidateQueries({ queryKey: ['admin', 'task_assignees'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_tasks'] })
  }

  const approve = async () => {
    const anyDone = tkList.some(a => a.completed_at != null)
    const ns = anyDone ? 'done' : 'abandoned'
    const now = new Date().toISOString()
    await updateField({ status: ns, completed_at: now, approved_at: now, approved_by: me.id })
  }

  const toggleAbandoned = async () => {
    const row = tkList.find(a => a.employee_id === me.id)
    if (!row) return
    if (tkList.length === 1 && !tk.needs_approval) {
      const next = tk.status === 'abandoned' ? 'open' : 'abandoned'
      const ts = next === 'abandoned' ? new Date().toISOString() : null
      await updateField({ status: next, completed_at: ts })
      const { error } = await supabase.from('task_assignees').update({ abandoned_at: ts, completed_at: null }).eq('task_id', tk.id).eq('employee_id', me.id)
      if (error) alert(error.message)
      queryClient.invalidateQueries({ queryKey: ['admin', 'task_assignees'] })
      return
    }
    const ts = row.abandoned_at ? null : new Date().toISOString()
    const { error } = await supabase.from('task_assignees').update({ abandoned_at: ts, completed_at: ts ? null : row.completed_at }).eq('task_id', tk.id).eq('employee_id', me.id)
    if (error) return alert(error.message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'task_assignees'] })
  }

  const deleteTask = async () => {
    if (!confirm(t('確定刪除此任務及所有子任務？'))) return
    const { error } = await supabase.from('employee_tasks').delete().eq('id', tk.id)
    if (error) return alert(error.message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_tasks'] })
    onClose()
  }

  const canDelete = me.is_admin || isCreator || (isAssignee && tkList.length === 1 && !tk.needs_approval)

  return (
    <div style={S.modal} onClick={onClose}>
      <div style={S.modalCard(600)} onClick={e => e.stopPropagation()}>
        {ro && <div style={{ background: c.amberBg, border: '1px solid #fde68a', color: '#a16207', padding: '8px 12px', borderRadius: radius.sm, fontSize: 12, marginBottom: 12 }}>{t('🔒 只讀模式：你不是發布人也不是 admin，僅查看')}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ v: 'high', l: t('高優'), c: c.red }, { v: 'mid', l: t('中優'), c: c.amber }, { v: 'low', l: t('低優'), c: c.green }].map(opt => {
              const on = tk.priority === opt.v || (opt.v === 'low' && (tk.priority === 'none' || !tk.priority))
              return <button key={opt.v} disabled={ro} onClick={() => updateField({ priority: opt.v })} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, border: `1px solid ${on ? opt.c : c.border}`, background: on ? opt.c + '18' : c.card, color: on ? opt.c : c.textMuted, cursor: ro ? 'not-allowed' : 'pointer', opacity: ro ? 0.6 : 1 }}>{opt.l}</button>
            })}
          </div>
          <button onClick={onClose} style={S.iconBtn}>×</button>
        </div>

        <input value={tk.title || ''} readOnly={ro} onChange={e => setTk({ ...tk, title: e.target.value })} onBlur={() => updateField({ title: tk.title })} style={{ width: '100%', padding: '8px 0', fontSize: 20, fontWeight: 700, border: 'none', outline: 'none', background: 'transparent', marginBottom: 8, color: c.text }} />

        {isAwaitingApproval(tk, assigneesByTask) && (
          <div style={{ background: c.amberBg, border: '1px solid #fde68a', borderRadius: radius.sm, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 12, color: '#a16207', fontWeight: 600 }}>⏳ {t('此任務全員已結算')}{(me.is_admin || isCreator) ? t('，待你核驗') : t('，等待發布人核驗')}</div>
            {(me.is_admin || isCreator) && <button onClick={approve} style={{ background: c.amber, color: '#fff', border: 'none', borderRadius: radius.sm, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✓ {t('核驗通過')}</button>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: c.textMuted }}>{t('截止')}</span>
          <input type="date" value={tk.due_date || ''} readOnly={ro} onChange={e => setTk({ ...tk, due_date: e.target.value || null })} onBlur={() => updateField({ due_date: tk.due_date || null })} style={{ padding: '4px 8px', borderRadius: radius.sm, border: `1px solid ${c.border}`, fontSize: 12 }} />
        </div>

        <AssigneeEditor tk={tk} tkList={tkList} employees={employees} canManage={canEdit} setAssignees={setAssignees} scopeCompanyId={scopeCompanyId} />

        {canEdit ? (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 12, color: c.textMuted, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!tk.needs_approval} onChange={e => updateField({ needs_approval: e.target.checked })} />{t('完成後需發布人核驗')}
          </label>
        ) : tk.needs_approval ? (
          <div style={{ marginTop: 8, fontSize: 12, color: '#a16207' }}>⏳ {t('完成後需發布人核驗')}</div>
        ) : null}

        <div style={{ fontSize: 11, color: c.textMuted, marginTop: 14, marginBottom: 4 }}>{t('描述 / 備註')}</div>
        <textarea value={tk.note || ''} readOnly={ro} onChange={e => setTk({ ...tk, note: e.target.value })} onBlur={() => updateField({ note: tk.note || null })} style={{ ...S.input, minHeight: 60, resize: 'vertical', background: ro ? c.bg : c.card }} />

        <AttachmentList tk={tk} ro={ro} onUpdate={updateField} />

        <SubtaskList tk={tk} subtasks={subtasks} employees={employees} feedbacks={feedbacks} assigneesByTask={assigneesByTask} me={me} canEdit={canEdit} scopeCompanyId={scopeCompanyId} />

        <FeedbackThread tk={tk} fbList={fbList} employees={employees} me={me} userId={userId} scopeCompanyId={scopeCompanyId} />

        <div style={{ fontSize: 10, color: c.textFaint, marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>{t('添加於')} {fmtDateTime(tk.created_at)}</span>
          {tk.status === 'done' && tk.completed_at && <span style={{ color: c.green }}>✓ {t('完成於')} {fmtDateTime(tk.completed_at)}</span>}
          {tk.status === 'abandoned' && tk.completed_at && <span>✗ {t('放棄於')} {fmtDateTime(tk.completed_at)}</span>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 14, borderTop: `1px solid ${c.border}` }}>
          <div style={{ display: 'flex', gap: 12 }}>
            {canDelete && <button onClick={deleteTask} style={{ background: 'none', border: 'none', color: c.red, fontSize: 12, cursor: 'pointer' }}>🗑 {t('刪除任務')}</button>}
            {isAssignee && (() => {
              const row = tkList.find(a => a.employee_id === me.id)
              const myAb = row?.abandoned_at != null || (!row && tk.status === 'abandoned')
              const label = (tkList.length > 1 || tk.needs_approval) ? (myAb ? t('恢復我的進行') : t('我放棄此任務')) : (myAb ? t('恢復進行') : t('放棄此任務'))
              return <button onClick={toggleAbandoned} style={{ background: 'none', border: 'none', color: myAb ? c.accent : c.textMuted, fontSize: 12, cursor: 'pointer' }}>✗ {label}</button>
            })()}
          </div>
          <button onClick={onClose} style={S.btnPrimary}>{t('完成')}</button>
        </div>
      </div>
    </div>
  )
}

function AssigneeEditor({ tk, tkList, employees, canManage, setAssignees, scopeCompanyId }) {
  const { t } = useT()
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const cur = tkList.map(a => a.employee_id)
  const q = input.replace(/^@/, '').toLowerCase()
  const sameCo = (e) => scopeCompanyId ? e.company_id === scopeCompanyId : true
  const cands = employees.filter(e => e.active !== false && sameCo(e) && !cur.includes(e.id) && (q === '' || (e.name || '').toLowerCase().includes(q)))
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 11, color: c.textMuted }}>{t('分配給')} · {cur.length}</span>
        {tk.creator_employee_id && (() => {
          const cr = employees.find(e => e.id === tk.creator_employee_id)
          return cr ? <span style={{ fontSize: 11, color: c.textMuted, marginLeft: 'auto' }}>{t('發布人:')} <span style={{ color: c.accent, fontWeight: 600 }}>{cr.name}</span></span> : null
        })()}
      </div>
      <div style={{ position: 'relative', border: `1px solid ${canManage ? c.border : c.bg}`, borderRadius: radius.sm, padding: '4px 6px', display: 'flex', flexWrap: 'wrap', gap: 3, minHeight: 28, background: canManage ? c.card : c.bg }}>
        {cur.map(id => {
          const e2 = employees.find(x => x.id === id)
          return (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 6px', background: c.accentBg, color: c.accent, borderRadius: 9, fontSize: 10, fontWeight: 600 }}>
              @{e2?.name || '?'}
              {canManage && <button type="button" onClick={() => setAssignees(cur.filter(x => x !== id))} style={{ background: 'none', border: 'none', color: c.accent, cursor: 'pointer', fontSize: 11 }}>×</button>}
            </span>
          )
        })}
        {canManage && (
          <input value={input} onChange={e => { setInput(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)} placeholder={t('@ 加成員')} style={{ flex: 1, minWidth: 60, border: 'none', outline: 'none', fontSize: 10, background: 'transparent' }} />
        )}
        {canManage && open && cands.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 3, background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.sm, boxShadow: '0 4px 14px rgba(0,0,0,0.1)', padding: 3, width: '100%', maxHeight: 180, overflowY: 'auto', zIndex: 30 }}>
            {cands.map(e2 => (
              <button key={e2.id} type="button" onMouseDown={ev => { ev.preventDefault(); setAssignees([...cur, e2.id]); setInput('') }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', background: 'none', border: 'none', fontSize: 11, color: c.text, cursor: 'pointer', borderRadius: 3 }}>{e2.name}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AttachmentList({ tk, ro, onUpdate }) {
  const { t } = useT()
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 5 }}>📎 {t('任務附件')}{Array.isArray(tk.attachments) && tk.attachments.length > 0 && <span style={{ marginLeft: 4 }}>{tk.attachments.length}</span>}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
        {Array.isArray(tk.attachments) && tk.attachments.map((a, i) => {
          const isImg = (a.type || '').startsWith('image/')
          return (
            <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {isImg ? (
                <a href={a.url} target="_blank" rel="noopener noreferrer"><img src={a.url} style={{ maxWidth: 100, maxHeight: 70, borderRadius: 4, border: `1px solid ${c.border}` }} alt={a.name} /></a>
              ) : (
                <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', background: c.accentBg, borderRadius: radius.sm, fontSize: 10, color: c.accent, textDecoration: 'none' }}>📎 {a.name}</a>
              )}
              {!ro && <button onClick={async () => {
                if (!confirm(t('確定移除？'))) return
                const rest = tk.attachments.filter((_, j) => j !== i)
                await onUpdate({ attachments: rest.length > 0 ? rest : null })
              }} style={{ background: 'none', border: 'none', color: c.textFaint, cursor: 'pointer', fontSize: 13 }}>×</button>}
            </div>
          )
        })}
        {!ro && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 10px', background: c.bg, border: `1px dashed ${c.border}`, borderRadius: radius.sm, fontSize: 10, color: c.accent, cursor: 'pointer' }}>
            ＋ {t('添加')}
            <input type="file" multiple style={{ display: 'none' }} onChange={async e => {
              const fs = Array.from(e.target.files || [])
              e.target.value = ''
              if (fs.length === 0) return
              try {
                const newOnes = await Promise.all(fs.map(f => uploadAttachment(f, tk.id)))
                const merged = [...(Array.isArray(tk.attachments) ? tk.attachments : []), ...newOnes]
                await onUpdate({ attachments: merged })
              } catch (err) { alert(t('上傳失敗：') + err.message) }
            }} />
          </label>
        )}
      </div>
    </div>
  )
}

function SubtaskList({ tk, subtasks, employees, feedbacks, assigneesByTask, me, canEdit, scopeCompanyId }) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const [subTitle, setSubTitle] = useState('')
  const [subAssignees, setSubAssignees] = useState(null)
  const [subInput, setSubInput] = useState('')
  const [subOpen, setSubOpen] = useState(false)

  const parentAssignees = (assigneesByTask.get(tk.id) || []).map(a => a.employee_id)
  const effectiveSub = subAssignees === null ? parentAssignees : subAssignees
  const sq = subInput.replace(/^@/, '').toLowerCase()
  const sameCo = (e) => scopeCompanyId ? e.company_id === scopeCompanyId : true
  const subCands = employees.filter(e => e.active !== false && sameCo(e) && !effectiveSub.includes(e.id) && (sq === '' || (e.name || '').toLowerCase().includes(sq)))

  const addSub = async () => {
    const title = subTitle.trim()
    if (!title) return
    if (effectiveSub.length === 0) return alert(t('至少需要一個負責人'))
    const { data, error } = await supabase.from('employee_tasks').insert({
      employee_id: effectiveSub[0], creator_employee_id: me.id, needs_approval: !!tk.needs_approval,
      title, priority: 'none', parent_task_id: tk.id, company_id: tk.company_id,
    }).select().single()
    if (error) return alert(error.message)
    await supabase.from('task_assignees').insert(effectiveSub.map(eid => ({ task_id: data.id, employee_id: eid })))
    setSubTitle(''); setSubAssignees(null)
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_tasks'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'task_assignees'] })
  }

  const toggleSubDone = async (st) => {
    const list = assigneesByTask.get(st.id) || []
    const row = list.find(a => a.employee_id === me.id)
    if (!row) return
    const ts = row.completed_at ? null : new Date().toISOString()
    const { error } = await supabase.from('task_assignees').update({ completed_at: ts }).eq('task_id', st.id).eq('employee_id', me.id)
    if (error) return alert(error.message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'task_assignees'] })
  }

  const deleteSub = async (st) => {
    if (!confirm(t('刪除此子任務？'))) return
    const { error } = await supabase.from('employee_tasks').delete().eq('id', st.id)
    if (error) return alert(error.message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_tasks'] })
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 5 }}>{t('子任務')}</div>
      {subtasks.map(st => {
        const fbCount = feedbacks.filter(f => f.task_id === st.id).length
        const stIsMine = (assigneesByTask.get(st.id) || []).some(a => a.employee_id === me.id)
        const canTick = me.is_admin || tk.creator_employee_id === me.id || stIsMine
        return (
          <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: `1px solid ${c.border}` }}>
            <input type="checkbox" checked={st.status === 'done' || empDoneFor(st, me.id, assigneesByTask)} disabled={!canTick} onChange={() => canTick && toggleSubDone(st)} style={{ width: 14, height: 14, cursor: canTick ? 'pointer' : 'not-allowed' }} />
            <span style={{ flex: 1, fontSize: 12, color: st.status === 'done' ? c.textMuted : c.text, textDecoration: st.status === 'done' ? 'line-through' : 'none' }}>{st.title}</span>
            {fbCount > 0 && <span style={{ fontSize: 10, color: c.amber }}>💬 {fbCount}</span>}
            {canEdit && <button onClick={() => deleteSub(st)} style={{ background: 'none', border: 'none', color: c.textFaint, cursor: 'pointer', fontSize: 13 }}>×</button>}
          </div>
        )
      })}
      {canEdit && (
        <div style={{ marginTop: 8, padding: '8px 10px', border: `1px dashed ${c.border}`, borderRadius: radius.sm, background: c.bg }}>
          <div style={{ fontSize: 10, color: c.textMuted, marginBottom: 3 }}>{t('分配給')}</div>
          <div style={{ position: 'relative', border: `1px solid ${c.border}`, borderRadius: radius.sm, padding: '3px 5px', marginBottom: 5, display: 'flex', flexWrap: 'wrap', gap: 3, minHeight: 24, background: c.card }}>
            {effectiveSub.map(id => {
              const e2 = employees.find(x => x.id === id)
              return (
                <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 5px', background: c.accentBg, color: c.accent, borderRadius: 9, fontSize: 9, fontWeight: 600 }}>
                  @{e2?.name || '?'}
                  <button type="button" onClick={() => setSubAssignees(effectiveSub.filter(x => x !== id))} style={{ background: 'none', border: 'none', color: c.accent, cursor: 'pointer', fontSize: 10 }}>×</button>
                </span>
              )
            })}
            <input value={subInput} onChange={e => { setSubInput(e.target.value); setSubOpen(true) }} onFocus={() => setSubOpen(true)} onBlur={() => setTimeout(() => setSubOpen(false), 200)} placeholder={t('@ 加')} style={{ flex: 1, minWidth: 50, border: 'none', outline: 'none', fontSize: 10, background: 'transparent' }} />
            {subOpen && subCands.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 3, background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.sm, boxShadow: '0 4px 14px rgba(0,0,0,0.1)', padding: 3, width: '100%', maxHeight: 160, overflowY: 'auto', zIndex: 30 }}>
                {subCands.map(e2 => (
                  <button key={e2.id} type="button" onMouseDown={ev => { ev.preventDefault(); setSubAssignees([...effectiveSub, e2.id]); setSubInput('') }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 7px', background: 'none', border: 'none', fontSize: 10, color: c.text, cursor: 'pointer' }}>{e2.name}</button>
                ))}
              </div>
            )}
          </div>
          <form onSubmit={e => { e.preventDefault(); addSub() }}>
            <input value={subTitle} onChange={e => setSubTitle(e.target.value)} placeholder={t('＋ 子任務（Enter 確認）')} style={{ width: '100%', padding: '6px 8px', borderRadius: radius.sm, border: `1px solid ${c.border}`, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </form>
        </div>
      )}
    </div>
  )
}

function FeedbackThread({ tk, fbList, employees, me, userId, scopeCompanyId }) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState([])
  const [replying, setReplying] = useState(null)
  const [mentionPop, setMentionPop] = useState({ open: false, query: '', atIdx: -1 })
  const [files, setFiles] = useState([])

  const sameCo = (e) => scopeCompanyId ? e.company_id === scopeCompanyId : true
  const mentionables = employees.filter(e => e.active !== false && e.user_id && e.id !== me.id && sameCo(e))
  const filtered = mentionPop.open ? mentionables.filter(e => !mentionPop.query || (e.name || '').toLowerCase().includes(mentionPop.query.toLowerCase())) : []

  const handleChange = (e) => {
    const val = e.target.value
    const cursor = e.target.selectionStart
    setBody(val)
    const before = val.slice(0, cursor)
    const atIdx = before.lastIndexOf('@')
    if (atIdx === -1) { setMentionPop({ open: false, query: '', atIdx: -1 }); return }
    const between = before.slice(atIdx + 1)
    if (/\s/.test(between)) { setMentionPop({ open: false, query: '', atIdx: -1 }); return }
    setMentionPop({ open: true, query: between, atIdx })
  }

  const selectMention = (emp) => {
    const atIdx = mentionPop.atIdx
    const before = body.slice(0, atIdx)
    const afterAt = body.slice(atIdx + 1)
    let queryEnd = afterAt.search(/\s/); if (queryEnd === -1) queryEnd = afterAt.length
    const rest = afterAt.slice(queryEnd)
    setBody(`${before}@${emp.name} ${rest.replace(/^\s+/, '')}`)
    setMentions(prev => Array.from(new Set([...prev, emp.user_id])))
    setMentionPop({ open: false, query: '', atIdx: -1 })
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!body.trim() && files.length === 0) return
    let attachments = null
    if (files.length > 0) {
      try { attachments = await Promise.all(files.map(f => uploadAttachment(f, tk.id))) } catch (er) { return alert(t('附件上傳失敗：') + er.message) }
    }
    const { error } = await supabase.from('employee_task_feedbacks').insert({
      task_id: tk.id, author_user_id: userId, author_name: me.name, body: body.trim() || null,
      parent_feedback_id: replying, mentioned_user_ids: mentions.length > 0 ? mentions : null, attachments,
    })
    if (error) return alert(error.message)
    setBody(''); setMentions([]); setReplying(null); setFiles([])
    queryClient.invalidateQueries({ queryKey: ['admin', 'feedbacks'] })
  }

  const delFb = async (id) => {
    const { error } = await supabase.from('employee_task_feedbacks').delete().eq('id', id)
    if (error) return alert(error.message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'feedbacks'] })
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: c.amber, marginBottom: 5 }}>💬 {t('反饋記錄')} <span style={{ fontSize: 11, color: c.textFaint, fontWeight: 400 }}>{fbList.length}</span></div>
      <div style={{ background: c.amberBg, border: '1px solid #fde68a', borderRadius: radius.sm, padding: 10, marginBottom: 8, maxHeight: 280, overflowY: 'auto' }}>
        {fbList.length === 0 ? (
          <div style={{ fontSize: 11, color: '#b88a00', fontStyle: 'italic' }}>{t('暫無反饋')}</div>
        ) : fbList.map(fb => {
          const isOwn = fb.author_user_id === userId
          const canDel = isOwn || me.is_admin
          const isReply = !!fb.parent_feedback_id
          const parent = isReply ? fbList.find(p => p.id === fb.parent_feedback_id) : null
          return (
            <div key={fb.id} style={{ background: c.card, border: '1px solid #fde68a', borderRadius: radius.sm, padding: '6px 9px', marginBottom: 5, marginLeft: isReply ? 18 : 0 }}>
              {isReply && <div style={{ fontSize: 9, color: '#b88a00', marginBottom: 2, fontStyle: 'italic' }}>↪ {t('回覆')} <b>{parent?.author_name || '?'}</b>: {(parent?.body || '').slice(0, 28)}...</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#a16207' }}>{fb.author_name || '?'}<span style={{ fontWeight: 400, marginLeft: 5, color: c.textFaint }}>{fmtDateTime(fb.created_at)}</span></span>
                <div style={{ display: 'flex', gap: 5 }}>
                  <button onClick={() => setReplying(fb.id)} style={{ background: 'none', border: 'none', color: '#b88a00', cursor: 'pointer', fontSize: 10 }}>↩ {t('回覆')}</button>
                  {canDel && <button onClick={() => delFb(fb.id)} style={{ background: 'none', border: 'none', color: c.textFaint, cursor: 'pointer', fontSize: 12 }}>×</button>}
                </div>
              </div>
              <div style={{ fontSize: 12, color: c.text, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{fb.body}</div>
              {Array.isArray(fb.attachments) && fb.attachments.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
                  {fb.attachments.map((a, i) => {
                    const isImg = (a.type || '').startsWith('image/')
                    return isImg ? (
                      <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"><img src={a.url} style={{ maxWidth: 100, maxHeight: 70, borderRadius: 4, border: `1px solid ${c.border}` }} /></a>
                    ) : (
                      <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', background: c.card, borderRadius: radius.sm, fontSize: 10, color: c.textMuted, textDecoration: 'none', border: `1px solid ${c.border}` }}>📎 {a.name}</a>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {replying && (() => {
        const target = fbList.find(f => f.id === replying)
        if (!target) return null
        return (
          <div style={{ background: '#fff4d6', border: '1px solid #fde68a', borderRadius: radius.sm, padding: '4px 8px', marginBottom: 5, fontSize: 10, color: '#a16207', display: 'flex', alignItems: 'center', gap: 5 }}>
            ↩ {t('回覆')} <b>{target.author_name || '?'}</b>: <span style={{ flex: 1, color: '#b88a00', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(target.body || '').slice(0, 50)}</span>
            <button onClick={() => setReplying(null)} style={{ background: 'none', border: 'none', color: '#a16207', cursor: 'pointer', fontSize: 12 }}>×</button>
          </div>
        )
      })()}
      <form onSubmit={submit} style={{ display: 'flex', gap: 5, position: 'relative' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 9px', background: c.amberBg, border: '1px solid #fde68a', borderRadius: radius.sm, fontSize: 13, cursor: 'pointer' }}>
          📎<input type="file" multiple style={{ display: 'none' }} onChange={e => { setFiles(prev => [...prev, ...Array.from(e.target.files || [])]); e.target.value = '' }} />
        </label>
        <textarea value={body} onChange={handleChange} onKeyDown={e => { if (e.key === 'Escape') setMentionPop({ open: false, query: '', atIdx: -1 }); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} rows={2} placeholder={t('追加反饋… @ 提醒；Cmd+Enter 發送')} style={{ flex: 1, padding: '7px 9px', borderRadius: radius.sm, border: '1px solid #fde68a', fontSize: 11, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
        <button type="submit" style={{ background: c.amber, color: '#fff', border: 'none', borderRadius: radius.sm, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{t('發送')}</button>
        {mentionPop.open && filtered.length > 0 && (
          <div style={{ position: 'absolute', bottom: '100%', left: 36, marginBottom: 4, background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.sm, boxShadow: '0 4px 14px rgba(0,0,0,0.1)', padding: 3, minWidth: 160, maxHeight: 180, overflowY: 'auto', zIndex: 50 }}>
            {filtered.map(emp => (
              <button key={emp.id} type="button" onMouseDown={ev => { ev.preventDefault(); selectMention(emp) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', background: 'none', border: 'none', fontSize: 11, color: c.text, cursor: 'pointer' }}>{emp.name}{emp.role && <span style={{ color: c.textFaint, marginLeft: 5, fontSize: 9 }}>{emp.role}</span>}</button>
            ))}
          </div>
        )}
      </form>
      {files.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
          {files.map((f, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 6px', background: '#fff4d6', borderRadius: radius.sm, fontSize: 10, color: '#a16207', border: '1px solid #fde68a' }}>📎 {f.name}<button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#a16207', cursor: 'pointer', fontSize: 11 }}>×</button></span>
          ))}
        </div>
      )}
      {mentions.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          <span style={{ fontSize: 9, color: c.textMuted }}>{t('將提醒:')}</span>
          {mentions.map(uid => {
            const emp = employees.find(e2 => e2.user_id === uid)
            if (!emp) return null
            return <span key={uid} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 5px', background: '#fff4d6', color: '#a16207', borderRadius: 9, fontSize: 9, fontWeight: 600, border: '1px solid #fde68a' }}>@{emp.name}<button type="button" onClick={() => setMentions(prev => prev.filter(id => id !== uid))} style={{ background: 'none', border: 'none', color: '#a16207', cursor: 'pointer', fontSize: 10 }}>×</button></span>
          })}
        </div>
      )}
    </div>
  )
}

// ====================  EMPLOYEES VIEW (admin)  ====================
function EmployeesView({ data, me, isMobile, ctx }) {
  const { t } = useT()
  const { employees, companies, empCompanies, roles } = data
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [companyFilter, setCompanyFilter] = useState(ctx?.isSuperAdmin ? 'all' : (ctx?.activeCompanyId || 'all'))

  // 公司 admin 只能看本公司員工（按 employee_companies 過濾）
  // super admin 看所有，可以下拉切公司或 all
  const visibleEmployees = useMemo(() => {
    let list = employees
    if (!ctx?.isSuperAdmin) {
      // 公司 admin：限制到自己管理的公司們
      const myAdminCompanyIds = new Set(empCompanies.filter(ec => ec.employee_id === me.id && ec.is_company_admin).map(ec => ec.company_id))
      const empsInAdminCo = new Set(empCompanies.filter(ec => myAdminCompanyIds.has(ec.company_id)).map(ec => ec.employee_id))
      list = list.filter(e => empsInAdminCo.has(e.id))
    }
    if (companyFilter !== 'all') {
      const empsInFilter = new Set(empCompanies.filter(ec => ec.company_id === companyFilter).map(ec => ec.employee_id))
      list = list.filter(e => empsInFilter.has(e.id))
    }
    return list
  }, [employees, empCompanies, companyFilter, ctx, me.id])

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

  const del = async (emp) => {
    if (!confirm(t('確定刪除員工') + '「' + emp.name + '」' + t('？該員工的所有任務也會被刪除。此操作不可撤銷。'))) return
    const { error } = await supabase.from('employees').delete().eq('id', emp.id)
    if (error) return alert(t('刪除失敗：') + error.message)
    refresh()
  }

  // 候選公司：super admin 全部，公司 admin 只本公司
  const filterOptions = ctx?.isSuperAdmin
    ? companies
    : companies.filter(co => empCompanies.some(ec => ec.employee_id === me.id && ec.company_id === co.id && ec.is_company_admin))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{t('員工管理')} <span style={{ fontSize: 12, color: c.textFaint, fontWeight: 400 }}>{visibleEmployees.length}</span></h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)} style={{ ...S.input, marginBottom: 0, width: 'auto', fontSize: 12, padding: '6px 8px' }}>
            {ctx?.isSuperAdmin && <option value="all">{t('所有公司')}</option>}
            {filterOptions.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
          </select>
          <button onClick={() => setShowAdd(true)} style={S.btnPrimary}>＋ {t('新增員工')}</button>
        </div>
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: c.bg, borderBottom: `1px solid ${c.border}` }}>
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
            {visibleEmployees.map(e => (
              <EmployeeRow key={e.id} emp={e} companies={companies} empCompanies={empCompanies} roles={roles}
                companyContext={companyFilter !== 'all' ? companyFilter : ctx?.activeCompanyId}
                updateField={updateField} updateBinding={updateBinding} del={del} me={me} ctx={ctx} />
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && <NewEmployeeModal companies={companies} onClose={() => setShowAdd(false)} onSaved={refresh} />}
    </div>
  )
}

const tcell = (align = 'left') => ({ padding: '10px 12px', textAlign: align, fontSize: 11, color: c.textMuted, fontWeight: 600, letterSpacing: 0.3 })

function EmployeeRow({ emp, companies, empCompanies, roles, companyContext, updateField, updateBinding, del, me, ctx }) {
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
            {(ctx?.isSuperAdmin || ctx?.isAdminOfActive) && <button onClick={() => del(emp)} style={{ background: 'none', border: 'none', color: c.red, fontSize: 11, cursor: 'pointer', padding: 4 }}>{t('刪除')}</button>}
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

// ====================  COMPANIES (admin only)  ====================
function CompaniesView({ data }) {
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

// ====================  ACCOUNT REVIEW  ====================
function AccountReviewView({ data, me, session }) {
  const { t } = useT()
  const { pendings, companies, joinPendings, employees, empCompanies } = data
  const queryClient = useQueryClient()
  const [reviewTab, setReviewTab] = useState('register')  // 'register' | 'join'

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
    // 加 employee_companies 行（is_default=false）
    const { error: ecErr } = await supabase.from('employee_companies').insert({
      employee_id: p.employee_id,
      company_id: p.company_id,
      is_default: false,
      is_company_admin: false,
    })
    if (ecErr && !String(ecErr.message).includes('duplicate')) return alert(t('創建綁定失敗：') + ecErr.message)
    await supabase.from('company_join_pending').update({ approved: true, reviewed_at: new Date().toISOString(), reviewed_by: reviewerUid }).eq('id', p.id)
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
    const { error: empErr } = await supabase.from('employees').insert({
      name: p.name, email: p.email, user_id: p.user_id, company_id: companyId, kind: 'task',
    })
    if (empErr) return alert(t('創建員工失敗：') + empErr.message)
    await supabase.from('task_pending').update({ approved: true, reviewed_at: new Date().toISOString(), reviewed_by: reviewerUid }).eq('id', p.id)
    queryClient.invalidateQueries({ queryKey: ['admin', 'task_pending'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] })
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

// ====================  COMMISSION  ====================
//   admin 视角：employees 传完整列表，lockedEmpId=null（可下拉切换销售）
//   销售视角：employees 传 [me]，lockedEmpId=me.id（强制只看自己）
export function CommissionView({ employees, me, lockedEmpId = null }) {
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

// ====================  ROLES VIEW（職位管理）  ====================
// super admin：看所有公司的職位；公司 admin：只本公司
// 編輯 inline，每個 role 一張卡片，10 個權限點 checkbox
function RolesView({ data, ctx }) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const { roles, companies } = data

  // 過濾：super admin 看全部，否則只看當前活躍公司
  const visibleCompanies = useMemo(
    () => ctx.isSuperAdmin ? companies : companies.filter(co => co.id === ctx.activeCompanyId),
    [companies, ctx.isSuperAdmin, ctx.activeCompanyId]
  )

  const [newRoleByCompany, setNewRoleByCompany] = useState({})  // { [companyId]: 'role name draft' }
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({ name: '', permissions: {} })

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
    // 預設權限：全部 false
    const permissions = Object.fromEntries(PERMISSION_KEYS.map(([k]) => [k, false]))
    const { error } = await supabase.from('roles').insert({ company_id: companyId, name, permissions })
    if (error) return alert(t('新增失敗：') + error.message)
    setNewRoleByCompany(prev => ({ ...prev, [companyId]: '' }))
    queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] })
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 18, letterSpacing: -0.3 }}>{t('職位管理')}</h1>
      {visibleCompanies.map(co => {
        const coRoles = roles.filter(r => r.company_id === co.id)
        return (
          <div key={co.id} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: c.text }}>{co.name}</h2>

            {coRoles.length === 0 && <Empty>{t('還沒有職位')}</Empty>}

            {coRoles.map(r => {
              const isEdit = editingId === r.id
              const draft = isEdit ? editDraft : { name: r.name, permissions: r.permissions || {} }
              return (
                <div key={r.id} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg, padding: 14, marginBottom: 10 }}>
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
          </div>
        )
      })}
    </div>
  )
}
