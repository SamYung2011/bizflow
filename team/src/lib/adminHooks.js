import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabaseClient.js'
import { fetchAllTable } from '../styles.jsx'

// ============================================================
//  Admin 視角共享 hooks：拉 11 張表 + realtime 訂閱 + 多公司 binding / 權限 context
// ============================================================

export function useAdminData() {
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
export function useMyContext(me, data) {
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
