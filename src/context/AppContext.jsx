import { createContext, useContext, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, fetchAllTable } from '../lib/supabaseClient.js'

const AppContext = createContext(null)

// WhatsApp tab 管理员（沿用旧名）
const WA_ADMIN_EMAILS = ['samyung2011@gmail.com', 'a1017339632@gmail.com']

export function AppProvider({ children }) {
  // Supabase Auth：初始化 + 監聽 session 變化
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => subscription?.unsubscribe?.()
  }, [])

  // 登入後才加載數據 — 用 user.id 作為依賴
  const userId = session?.user?.id

  // 批 1：products / suppliers / warehouses / stocks
  const qProducts = useQuery({ queryKey: ['bf', 'products'], queryFn: () => fetchAllTable('products', 'name'), enabled: !!userId })
  const qWarehouses = useQuery({ queryKey: ['bf', 'warehouses'], queryFn: () => fetchAllTable('warehouses', 'sort_order'), enabled: !!userId })
  const qStocks = useQuery({ queryKey: ['bf', 'inventory_stock'], queryFn: () => fetchAllTable('inventory_stock', null), enabled: !!userId })
  const qSuppliers = useQuery({ queryKey: ['bf', 'suppliers'], queryFn: () => fetchAllTable('suppliers', 'created_at', false), enabled: !!userId })

  // 批 2：customers / line_item_aliases
  // customers 高頻：staleTime: 0 → F5 立刻 hydrate 老 cache 顯示 + 同時 background refetch 拿最新
  const qCustomers = useQuery({ queryKey: ['bf', 'customers'], queryFn: () => fetchAllTable('customers', 'name'), enabled: !!userId, staleTime: 0 })
  const qLineItemAliases = useQuery({ queryKey: ['bf', 'line_item_aliases'], queryFn: () => fetchAllTable('line_item_aliases', 'alias_name'), enabled: !!userId })

  // 批 3：invoices / inventory
  // invoices 高頻：staleTime: 0（同上）
  const qInvoices = useQuery({ queryKey: ['bf', 'invoices'], queryFn: () => fetchAllTable('invoices', 'date', false), enabled: !!userId, staleTime: 0 })
  const qInventory = useQuery({ queryKey: ['bf', 'inventory'], queryFn: () => fetchAllTable('inventory', null), enabled: !!userId })

  // 批 4：員工/任務/反饋/更新日誌/WhatsApp/companies 等
  // WhatsApp 全板塊高頻：staleTime: 0 + 原有 refetchInterval 不動
  const qEmployees = useQuery({ queryKey: ['bf', 'employees'], queryFn: () => fetchAllTable('employees', 'created_at'), enabled: !!userId })
  const qTasks = useQuery({ queryKey: ['bf', 'employee_tasks'], queryFn: () => fetchAllTable('employee_tasks', 'created_at'), enabled: !!userId })
  const qTaskAssignees = useQuery({ queryKey: ['bf', 'task_assignees'], queryFn: () => fetchAllTable('task_assignees', 'created_at', true, null), enabled: !!userId })
  const qFeedbacks = useQuery({ queryKey: ['bf', 'employee_task_feedbacks'], queryFn: () => fetchAllTable('employee_task_feedbacks', 'created_at'), enabled: !!userId })
  const qUpdateLogs = useQuery({ queryKey: ['bf', 'employee_update_logs'], queryFn: () => fetchAllTable('employee_update_logs', 'created_at', false), enabled: !!userId })
  const qLogComments = useQuery({ queryKey: ['bf', 'employee_update_log_comments'], queryFn: () => fetchAllTable('employee_update_log_comments', 'created_at'), enabled: !!userId })
  const qWaSettings = useQuery({ queryKey: ['bf', 'wa_settings'], queryFn: async () => { const { data } = await supabase.from('wa_settings').select('*').eq('id', 1).maybeSingle(); return data }, enabled: !!userId, refetchInterval: 30000, staleTime: 0 })
  const qWaWhitelist = useQuery({ queryKey: ['bf', 'wa_whitelist'], queryFn: () => fetchAllTable('wa_whitelist', 'created_at'), enabled: !!userId, refetchInterval: 30000, staleTime: 0 })
  const qWaMessages = useQuery({ queryKey: ['bf', 'wa_messages'], queryFn: async () => { const { data } = await supabase.from('wa_messages').select('*').order('created_at', { ascending: false }).limit(1000); return data || [] }, enabled: !!userId, refetchInterval: 5000, staleTime: 0 })
  const qWaPending = useQuery({ queryKey: ['bf', 'wa_replies_pending'], queryFn: async () => { const { data, error } = await supabase.from('wa_replies').select('*').is('delivered_at', null).order('created_at', { ascending: false }).limit(500); if (error) throw error; return data || [] }, enabled: !!userId, refetchInterval: 5000, staleTime: 0 })
  const qWaUnresolved = useQuery({ queryKey: ['bf', 'wa_unresolved'], queryFn: () => fetchAllTable('wa_unresolved', 'created_at', false), enabled: !!userId, refetchInterval: 30000, staleTime: 0 })
  const qCompanies = useQuery({ queryKey: ['bf', 'companies'], queryFn: () => fetchAllTable('companies', 'name', true), enabled: !!userId, refetchInterval: 60000 })
  const qWaReports = useQuery({ queryKey: ['bf', 'wa_daily_reports'], queryFn: () => fetchAllTable('wa_daily_reports', 'report_date', false), enabled: !!userId, refetchInterval: 60000, staleTime: 0 })
  const qWaHeartbeat = useQuery({ queryKey: ['bf', 'wa_heartbeat'], queryFn: async () => { const { data } = await supabase.from('wa_heartbeat').select('*').eq('id', 1).maybeSingle(); return data }, enabled: !!userId, refetchInterval: 15000, staleTime: 0 })
  const qWaLogs = useQuery({ queryKey: ['bf', 'wa_logs'], queryFn: async () => { const { data } = await supabase.from('wa_logs').select('*').order('created_at', { ascending: false }).limit(500); return data || [] }, enabled: !!userId, refetchInterval: 5000, staleTime: 0 })
  const qWaClients = useQuery({ queryKey: ['bf', 'wa_clients'], queryFn: async () => { const { data } = await supabase.from('wa_clients').select('*').order('last_seen', { ascending: false }); return data || [] }, enabled: !!userId, refetchInterval: 2000, staleTime: 0 })

  const [products, setProducts] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [stocks, setStocks] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [customers, setCustomers] = useState([])
  const [lineItemAliases, setLineItemAliases] = useState([])
  const [invoices, setInvoices] = useState([])
  const [inventory, setInventory] = useState([])
  const [employees, setEmployees] = useState([])
  const [tasks, setTasks] = useState([])
  const [taskAssignees, setTaskAssignees] = useState([])
  const [feedbacks, setFeedbacks] = useState([])
  const [updateLogs, setUpdateLogs] = useState([])
  const [logComments, setLogComments] = useState([])
  const [waSettings, setWaSettings] = useState(null)
  const [waWhitelist, setWaWhitelist] = useState([])
  const [waMessages, setWaMessages] = useState([])
  const [waUnresolved, setWaUnresolved] = useState([])
  const [waReports, setWaReports] = useState([])
  const [waLogs, setWaLogs] = useState([])
  const [waClients, setWaClients] = useState([])
  const [waHeartbeat, setWaHeartbeat] = useState(null)

  useEffect(() => { if (qProducts.data) setProducts(qProducts.data) }, [qProducts.data])
  useEffect(() => { if (qWarehouses.data) setWarehouses(qWarehouses.data) }, [qWarehouses.data])
  useEffect(() => { if (qStocks.data) setStocks(qStocks.data) }, [qStocks.data])
  useEffect(() => { if (qSuppliers.data) setSuppliers(qSuppliers.data) }, [qSuppliers.data])
  useEffect(() => { if (qCustomers.data) setCustomers(qCustomers.data) }, [qCustomers.data])
  useEffect(() => { if (qLineItemAliases.data) setLineItemAliases(qLineItemAliases.data) }, [qLineItemAliases.data])
  useEffect(() => { if (qInvoices.data) setInvoices(qInvoices.data) }, [qInvoices.data])
  useEffect(() => { if (qInventory.data) setInventory(qInventory.data) }, [qInventory.data])
  useEffect(() => { if (qEmployees.data) setEmployees(qEmployees.data) }, [qEmployees.data])
  useEffect(() => { if (qTasks.data) setTasks(qTasks.data) }, [qTasks.data])
  useEffect(() => { if (qTaskAssignees.data) setTaskAssignees(qTaskAssignees.data) }, [qTaskAssignees.data])
  useEffect(() => { if (qFeedbacks.data) setFeedbacks(qFeedbacks.data) }, [qFeedbacks.data])
  useEffect(() => { if (qUpdateLogs.data) setUpdateLogs(qUpdateLogs.data) }, [qUpdateLogs.data])
  useEffect(() => { if (qLogComments.data) setLogComments(qLogComments.data) }, [qLogComments.data])
  useEffect(() => { if (qWaSettings.data) setWaSettings(qWaSettings.data) }, [qWaSettings.data])
  useEffect(() => { if (qWaWhitelist.data) setWaWhitelist(qWaWhitelist.data) }, [qWaWhitelist.data])
  useEffect(() => { if (qWaMessages.data) setWaMessages(qWaMessages.data) }, [qWaMessages.data])
  useEffect(() => { if (qWaUnresolved.data) setWaUnresolved(qWaUnresolved.data) }, [qWaUnresolved.data])
  useEffect(() => { if (qWaReports.data) setWaReports(qWaReports.data) }, [qWaReports.data])
  useEffect(() => { if (qWaHeartbeat.data) setWaHeartbeat(qWaHeartbeat.data) }, [qWaHeartbeat.data])
  useEffect(() => { if (qWaLogs.data) setWaLogs(qWaLogs.data) }, [qWaLogs.data])
  useEffect(() => { if (qWaClients.data) setWaClients(qWaClients.data) }, [qWaClients.data])

  // 当前登录的 employee 记录（按 user_id 反查 employees 表）
  const currentEmployee = userId ? employees.find(e => e.user_id === userId) : null
  // bizflow 管理员（按 employees.is_admin 反查；samyung 老 admin 兼容保留）
  const isBfAdmin = (currentEmployee && currentEmployee.is_admin === true) || (!!session?.user?.email && session.user.email === 'samyung2011@gmail.com')
  const isWaAdmin = isBfAdmin || (!!session?.user?.email && WA_ADMIN_EMAILS.includes(session.user.email))
  // 發貨權限：admin 或 employees.can_ship=true 的人
  const canShip = isBfAdmin || (currentEmployee && currentEmployee.can_ship === true)

  // qTaskPending：依賴 isWaAdmin，1c 從 App.jsx 搬進來
  const qTaskPending = useQuery({ queryKey: ['bf', 'task_pending'], queryFn: () => fetchAllTable('task_pending', 'requested_at', false), enabled: !!userId && isWaAdmin, refetchInterval: 15000 })

  // 全 App 共享：當前 tab + 首屏 loading/error 匯總
  const [tab, setTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  // 最快一張到位就解 spinner
  useEffect(() => {
    if (qProducts.data || qInventory.data || qCustomers.data || qInvoices.data) setLoading(false)
  }, [qProducts.data, qInventory.data, qCustomers.data, qInvoices.data])

  // 匯總錯誤
  useEffect(() => {
    const errs = [qProducts.error, qInventory.error, qCustomers.error, qInvoices.error].filter(Boolean)
    if (errs.length > 0) setLoadError(errs[0].message || String(errs[0]))
  }, [qProducts.error, qInventory.error, qCustomers.error, qInvoices.error])

  const value = {
    session, setSession,
    authLoading, setAuthLoading,
    userId, currentEmployee, isBfAdmin, isWaAdmin, canShip,
    tab, setTab,
    loading, setLoading,
    loadError, setLoadError,
    products, setProducts,
    warehouses, setWarehouses,
    stocks, setStocks,
    suppliers, setSuppliers,
    customers, setCustomers,
    lineItemAliases, setLineItemAliases,
    invoices, setInvoices,
    inventory, setInventory,
    employees, setEmployees,
    tasks, setTasks,
    taskAssignees, setTaskAssignees,
    feedbacks, setFeedbacks,
    updateLogs, setUpdateLogs,
    logComments, setLogComments,
    waSettings, setWaSettings,
    waWhitelist, setWaWhitelist,
    waMessages, setWaMessages,
    waUnresolved, setWaUnresolved,
    waReports, setWaReports,
    waLogs, setWaLogs,
    waClients, setWaClients,
    waHeartbeat, setWaHeartbeat,
    qProducts, qWarehouses, qStocks, qSuppliers,
    qCustomers, qLineItemAliases,
    qInvoices, qInventory,
    qEmployees, qTasks, qTaskAssignees,
    qFeedbacks, qUpdateLogs, qLogComments,
    qWaSettings, qWaWhitelist, qWaMessages, qWaPending, qWaUnresolved,
    qCompanies, qWaReports, qWaHeartbeat, qWaLogs, qWaClients,
    qTaskPending,
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppContext() {
  const ctx = useContext(AppContext)
  if (ctx === null) {
    throw new Error('useAppContext must be used inside <AppProvider>')
  }
  return ctx
}
