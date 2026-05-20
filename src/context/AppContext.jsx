import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, fetchAllTable } from '../lib/supabaseClient.js'
import { isNonWarrantyItem, itemWarrantyMonths } from '../lib/warranty.js'
import { fmtInvNum } from '../lib/invoiceHelpers.js'

// 庫存預警閾值（活 SKU 合計 < 50 視為低庫存）
const LOW_STOCK_THRESHOLD = 50

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
  // wa_settings 不拉 admin_password / openai_api_key（敏感欄位、走 wa-unlock Edge Function；DB 層 migration 057 已 column-level REVOKE）
  const qWaSettings = useQuery({ queryKey: ['bf', 'wa_settings'], queryFn: async () => { const { data } = await supabase.from('wa_settings').select('id, claude_mode, openai_base_url, model, max_history, max_replies_per_min, reply_delay_base, cooldown_minutes, bot_phone, boss_chat_name, daily_report_hour, system_prompt, boss_prompt, knowledge, updated_at, bot_name, chargers_prompt, location_hint_prompt, latest_ext_version').eq('id', 1).maybeSingle(); return data }, enabled: !!userId, refetchInterval: 30000, staleTime: 0 })
  const qWaWhitelist = useQuery({ queryKey: ['bf', 'wa_whitelist'], queryFn: () => fetchAllTable('wa_whitelist', 'created_at'), enabled: !!userId, refetchInterval: 30000, staleTime: 0 })
  const qWaMessages = useQuery({ queryKey: ['bf', 'wa_messages'], queryFn: async () => { const { data } = await supabase.from('wa_messages').select('*').order('created_at', { ascending: false }).limit(1000); return data || [] }, enabled: !!userId, refetchInterval: 5000, staleTime: 0 })
  const qWaPending = useQuery({ queryKey: ['bf', 'wa_replies_pending'], queryFn: async () => { const { data, error } = await supabase.from('wa_replies').select('*').is('delivered_at', null).order('created_at', { ascending: false }).limit(500); if (error) throw error; return data || [] }, enabled: !!userId, refetchInterval: 5000, staleTime: 0 })
  const qWaUnresolved = useQuery({ queryKey: ['bf', 'wa_unresolved'], queryFn: () => fetchAllTable('wa_unresolved', 'created_at', false), enabled: !!userId, refetchInterval: 30000, staleTime: 0 })
  const qCompanies = useQuery({ queryKey: ['bf', 'companies'], queryFn: () => fetchAllTable('companies', 'name', true), enabled: !!userId, refetchInterval: 60000 })
  const qWaReports = useQuery({ queryKey: ['bf', 'wa_daily_reports'], queryFn: () => fetchAllTable('wa_daily_reports', 'report_date', false), enabled: !!userId, refetchInterval: 60000, staleTime: 0 })
  const qWaHeartbeat = useQuery({ queryKey: ['bf', 'wa_heartbeat'], queryFn: async () => { const { data } = await supabase.from('wa_heartbeat').select('*').eq('id', 1).maybeSingle(); return data }, enabled: !!userId, refetchInterval: 15000, staleTime: 0 })
  const qWaLogs = useQuery({ queryKey: ['bf', 'wa_logs'], queryFn: async () => { const { data } = await supabase.from('wa_logs').select('*').order('created_at', { ascending: false }).limit(500); return data || [] }, enabled: !!userId, refetchInterval: 5000, staleTime: 0 })
  const qWaClients = useQuery({ queryKey: ['bf', 'wa_clients'], queryFn: async () => { const { data } = await supabase.from('wa_clients').select('*').order('last_seen', { ascending: false }); return data || [] }, enabled: !!userId, refetchInterval: 2000, staleTime: 0 })
  // shopify_settings 不拉 access_token（敏感欄位、走 shopify-settings Edge Function；DB 層 migration 059 已 column-level REVOKE）
  const qShopifySettings = useQuery({ queryKey: ['bf', 'shopify_settings'], queryFn: async () => { const { data } = await supabase.from('shopify_settings').select('id, shop_domain, api_version, last_synced_at, updated_at').eq('id', 1).maybeSingle(); return data }, enabled: !!userId, refetchInterval: 60000, staleTime: 0 })
  // M:N 关联表（migration 062）：bizflow product ↔ Shopify variant 多对多
  const qShopifyVariantLinks = useQuery({ queryKey: ['bf', 'shopify_variant_links'], queryFn: () => fetchAllTable('shopify_variant_links', 'created_at'), enabled: !!userId })

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
  const [shopifySettings, setShopifySettings] = useState(null)
  const [shopifyVariantLinks, setShopifyVariantLinks] = useState([])

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
  useEffect(() => { if (qShopifySettings.data) setShopifySettings(qShopifySettings.data) }, [qShopifySettings.data])
  useEffect(() => { if (qShopifyVariantLinks.data) setShopifyVariantLinks(qShopifyVariantLinks.data) }, [qShopifyVariantLinks.data])

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

  // ─────────────────────────────────────────────────────────────
  // 跨 view 共用的派生 helper（從 App.jsx 推進 AppContext）
  // ─────────────────────────────────────────────────────────────

  // 客戶去重聚合：
  //   規則 1（虛擬合併，union-find）：name/phone/email/address 4 字段命中 3+ 視為疑似同人
  //   規則 2（物理合併，DB parent_id）：除 name 外所有字段完全相等 + name 都非空 → UPDATE parent_id = keeper.id
  //     parent_id 非空的子記錄不作為獨立客戶顯示，名字作別名加入 keeper 的 allNames
  const customerGroups = useMemo(() => {
    const norm = s => (s || "").trim().toLowerCase()
    // fields：multi=多值（按 \n 分行）；fuzzy=允許每行 edit distance ≤ 1 命中
    const fields = [
      { key: "name",           multi: false, fuzzy: false },
      { key: "phone",          multi: true,  fuzzy: false },
      { key: "phone_mainland", multi: true,  fuzzy: false },
      { key: "email",          multi: true,  fuzzy: true  },
      { key: "address",        multi: true,  fuzzy: true  },
    ]
    // edit distance ≤ 1（容忍 1 個字的錯漏）
    const editDist1 = (a, b) => {
      if (a === b) return true
      const la = a.length, lb = b.length
      if (Math.abs(la - lb) > 1) return false
      let i = 0, j = 0, edits = 0
      while (i < la && j < lb) {
        if (a[i] === b[j]) { i++; j++; continue }
        if (++edits > 1) return false
        if (la === lb) { i++; j++ }
        else if (la > lb) i++
        else j++
      }
      if (i < la || j < lb) edits++
      return edits <= 1
    }
    const splitLinesLower = s => String(s || "").split(/\n+/).map(x => x.trim().toLowerCase()).filter(Boolean)
    const lineMatch = (a, b, fuzzy) => fuzzy ? editDist1(a, b) : a === b
    const fieldMatch = (f, ca, cb) => {
      if (f.multi) {
        const A = splitLinesLower(ca[f.key]), B = splitLinesLower(cb[f.key])
        if (A.length === 0 || B.length === 0) return false
        for (const x of A) for (const y of B) if (lineMatch(x, y, f.fuzzy)) return true
        return false
      }
      const a = norm(ca[f.key]), b = norm(cb[f.key])
      return !!a && a === b
    }
    // 兜底去重：state 異常時可能有重複 id（fetchAllTable 已修，這裡再保險）
    const uniqueCustomers = Array.from(new Map(customers.map(c => [c.id, c])).values())
    const idToCustomer = new Map()
    uniqueCustomers.forEach(c => idToCustomer.set(c.id, c))
    const childrenByParent = new Map()
    uniqueCustomers.forEach(c => {
      if (c.parent_id) {
        if (!childrenByParent.has(c.parent_id)) childrenByParent.set(c.parent_id, [])
        childrenByParent.get(c.parent_id).push(c)
      }
    })
    const independents = uniqueCustomers.filter(c => !c.parent_id)
    // exact-match indexes：multi 字段每行一個 entry，single 字段整字段
    const indexes = fields.map(() => new Map())
    independents.forEach(c => {
      fields.forEach((f, i) => {
        const lines = f.multi ? splitLinesLower(c[f.key]) : [norm(c[f.key])].filter(Boolean)
        lines.forEach(line => {
          if (!indexes[i].has(line)) indexes[i].set(line, [])
          indexes[i].get(line).push(c.id)
        })
      })
    })
    const parent = new Map()
    independents.forEach(c => parent.set(c.id, c.id))
    const find = x => {
      let r = x
      while (parent.get(r) !== r) r = parent.get(r)
      let cur = x
      while (parent.get(cur) !== r) { const nx = parent.get(cur); parent.set(cur, r); cur = nx }
      return r
    }
    independents.forEach(c => {
      const candidates = new Set()
      fields.forEach((f, i) => {
        const lines = f.multi ? splitLinesLower(c[f.key]) : [norm(c[f.key])].filter(Boolean)
        lines.forEach(line => {
          indexes[i].get(line)?.forEach(id => { if (id !== c.id) candidates.add(id) })
        })
      })
      candidates.forEach(id => {
        const other = idToCustomer.get(id)
        if (!other) return
        const ex1 = Array.isArray(c.merge_exclude) ? c.merge_exclude : []
        const ex2 = Array.isArray(other.merge_exclude) ? other.merge_exclude : []
        if (ex1.includes(other.id) || ex2.includes(c.id)) return
        let matches = 0
        fields.forEach(f => { if (fieldMatch(f, c, other)) matches++ })
        if (matches >= 3) {
          const ra = find(c.id), rb = find(id)
          if (ra !== rb) parent.set(ra, rb)
        }
      })
    })
    const groupInfo = new Map()
    const splitLines = v => String(v || "").split(/\n+/).map(s => s.trim()).filter(Boolean)
    // 把 keeper 自身 + 物理子記錄的字段一起算進 group
    const absorb = (g, c) => {
      const n = (c.name || "").trim(); if (n) g.names.add(n)
      splitLines(c.phone).forEach(v => g.phones.add(v))
      splitLines(c.email).forEach(v => g.emails.add(v))
      splitLines(c.address).forEach(v => g.addresses.add(v))
      splitLines(c.phone_mainland).forEach(v => g.phoneMainlands.add(v))
      splitLines(c.car_make).forEach(v => g.carMakes.add(v))
      splitLines(c.car_model).forEach(v => g.carModels.add(v))
    }
    independents.forEach(c => {
      const root = find(c.id)
      if (!groupInfo.has(root)) groupInfo.set(root, {
        cids: [], childCids: [], names: new Set(), phones: new Set(), emails: new Set(), addresses: new Set(),
        phoneMainlands: new Set(), carMakes: new Set(), carModels: new Set(),
      })
      const g = groupInfo.get(root)
      g.cids.push(c.id)
      absorb(g, c)
      // 把規則 2 合併的子記錄吸進來（注意：absorb(g,c) 後必須跟分號或 const，否則 ASI 把下一行括號當函數調用 absorb 的返回值，會炸）
      const children = childrenByParent.get(c.id) || []
      children.forEach(child => {
        g.childCids.push(child.id)
        absorb(g, child)
      })
    })
    // 預先算每個 group 的 primaryCid，讓 virtualC.id 直接用 primaryCid（避免 root 跟 primary 不一致導致 parent_id 引用錯亂）
    const rootToPrimary = new Map()
    groupInfo.forEach((info, root) => {
      const primaryCid = info.cids.find(cid => {
        const x = idToCustomer.get(cid)
        return x && (x.name || "").trim()
      }) || info.cids[0]
      rootToPrimary.set(root, primaryCid)
    })
    const idToGroup = new Map()
    independents.forEach(c => {
      const root = find(c.id)
      idToGroup.set(c.id, rootToPrimary.get(root) || root)
    })
    // 子記錄 → 指向其 parent 所在的 group primary
    uniqueCustomers.forEach(c => {
      if (c.parent_id && !idToGroup.has(c.id)) {
        const mapped = idToGroup.get(c.parent_id)
        if (mapped) idToGroup.set(c.id, mapped)
      }
    })
    // 構造 virtualCustomers：每組合併成一條，主信息取組內第一個有 name 的
    const virtualCustomers = []
    groupInfo.forEach((info, root) => {
      const primaryCid = rootToPrimary.get(root)
      const primary = idToCustomer.get(primaryCid) || {}
      const earliestCreated = info.cids
        .map(cid => idToCustomer.get(cid)?.created_at)
        .filter(Boolean)
        .sort()[0]
      const allNames = Array.from(info.names)
      const allPhones = Array.from(info.phones)
      const allEmails = Array.from(info.emails)
      const allAddresses = Array.from(info.addresses)
      const allPhoneMainlands = Array.from(info.phoneMainlands)
      const allCarMakes = Array.from(info.carMakes)
      const allCarModels = Array.from(info.carModels)
      virtualCustomers.push({
        ...primary,
        id: primaryCid,                // 用 primaryCid 而非 union-find root，让 parent_id 引用稳定
        groupCids: info.cids,          // rule 1 虛擬合併（獨立 customer id 列表）
        mergedChildCids: info.childCids, // rule 2 物理合併的子記錄 id
        allCids: [...info.cids, ...info.childCids], // 查發票用：包含所有相關 customer_id
        allNames,
        allPhones,
        allEmails,
        allAddresses,
        allPhoneMainlands,
        allCarMakes,
        allCarModels,
        name: (primary.name || "").trim() || allNames[0] || "",
        phone: (primary.phone || "").trim() || allPhones[0] || "",
        email: (primary.email || "").trim() || allEmails[0] || "",
        address: (primary.address || "").trim() || allAddresses[0] || "",
        phone_mainland: allPhoneMainlands.join("\n") || primary.phone_mainland || "",
        car_make: allCarMakes.join("\n") || primary.car_make || "",
        car_model: allCarModels.join("\n") || primary.car_model || "",
        created_at: earliestCreated,
      })
    })
    return { idToGroup, groupInfo, virtualCustomers }
  }, [customers])

  // 保修提醒（dashboard 用「30 天內到期」短期版）
  const warrantyItems = useMemo(() => {
    const today = new Date()
    const in30 = new Date(today); in30.setDate(in30.getDate() + 30)
    const results = []
    for (const inv of invoices) {
      if (!Array.isArray(inv.items) || !inv.date) continue
      const cust = customers.find(c => c.id === inv.customer_id)
      for (const item of inv.items) {
        if (isNonWarrantyItem(item.name)) continue
        const prod = products.find(p => p.name === item.name)
        const months = itemWarrantyMonths(item, prod)
        if (!months) continue
        const wEnd = new Date(inv.date)
        wEnd.setMonth(wEnd.getMonth() + months)
        if (wEnd >= today && wEnd <= in30) {
          results.push({ customer: cust, customerName: cust?.name || "—", productName: item.name, invoiceNum: fmtInvNum(inv), invoiceDate: inv.date, warrantyEnd: wEnd.toISOString().slice(0, 10), daysLeft: Math.ceil((wEnd - today) / (1000 * 60 * 60 * 24)) })
        }
      }
    }
    return results.sort((a, b) => {
      if (!!a.customer !== !!b.customer) return a.customer ? -1 : 1
      return a.daysLeft - b.daysLeft
    })
  }, [invoices, products, customers])

  // 庫存不足 SKU（活 SKU + 非父 + 非停售 + 非虛擬 + 所有倉庫合計 <= 0）
  const outOfStockSkus = useMemo(() => {
    if (!products.length) return []
    const parentIds = new Set(products.filter(x => x.parent_product_id).map(x => x.parent_product_id))
    const byProd = new Map()
    for (const s of stocks) {
      byProd.set(s.product_id, (byProd.get(s.product_id) || 0) + (s.qty || 0))
    }
    return products.filter(p => {
      if (p.category === '_archived') return false
      if (parentIds.has(p.id)) return false
      if ((p.status || 'active') === 'discontinued') return false
      if (p.is_virtual === true) return false
      return (byProd.get(p.id) || 0) <= 0
    })
  }, [products, stocks])

  // 庫存預警 SKU（活 SKU + 非父 + 非停售 + 非虛擬 + 合計 < 50）
  const lowStockSkus = useMemo(() => {
    if (!products.length) return []
    const parentIds = new Set(products.filter(x => x.parent_product_id).map(x => x.parent_product_id))
    const byProd = new Map()
    for (const s of stocks) {
      byProd.set(s.product_id, (byProd.get(s.product_id) || 0) + (s.qty || 0))
    }
    return products.filter(p => {
      if (p.category === '_archived') return false
      if (parentIds.has(p.id)) return false
      if ((p.status || 'active') === 'discontinued') return false
      if (p.is_virtual === true) return false
      return (byProd.get(p.id) || 0) < LOW_STOCK_THRESHOLD
    }).map(p => ({ ...p, _stockQty: byProd.get(p.id) || 0 }))
  }, [products, stocks])

  // 全量保修條目：涵蓋過期 30 天內 + 未來 365 天內，用於獨立「保修」tab + sidebar 紅標
  // 僅顯示有客戶記錄的，無名客戶排除（無法聯繫不顯示）
  const allWarrantyItems = useMemo(() => {
    const today = new Date()
    const expiredCutoff = new Date(today); expiredCutoff.setDate(expiredCutoff.getDate() - 30)
    const upcomingCutoff = new Date(today); upcomingCutoff.setDate(upcomingCutoff.getDate() + 365)
    const results = []
    for (const inv of invoices) {
      if (!Array.isArray(inv.items) || !inv.date) continue
      const cust = customers.find(c => c.id === inv.customer_id)
      if (!cust) continue
      for (const item of inv.items) {
        if (isNonWarrantyItem(item.name)) continue
        const prod = products.find(p => p.name === item.name)
        const months = itemWarrantyMonths(item, prod)
        if (!months) continue
        const wEnd = new Date(inv.date)
        wEnd.setMonth(wEnd.getMonth() + months)
        if (wEnd >= expiredCutoff && wEnd <= upcomingCutoff) {
          const daysLeft = Math.ceil((wEnd - today) / (1000 * 60 * 60 * 24))
          let bucket
          if (daysLeft < 0) bucket = "expired"
          else if (daysLeft <= 7) bucket = "week"
          else if (daysLeft <= 30) bucket = "soon"
          else if (daysLeft <= 90) bucket = "near"
          else bucket = "far"
          results.push({
            customer: cust,
            customerName: cust.name || "—",
            customerPhone: cust.phone || "",
            productName: item.name,
            invoiceNum: fmtInvNum(inv),
            invoiceId: inv.id,
            invoiceDate: inv.date,
            warrantyEnd: wEnd.toISOString().slice(0, 10),
            daysLeft,
            bucket,
          })
        }
      }
    }
    return results.sort((a, b) => a.daysLeft - b.daysLeft)
  }, [invoices, products, customers])

  // 從發票反推庫存：按產品聚合已售數量（dashboard 反推庫存卡用）
  const derivedInventory = useMemo(() => {
    const map = {}
    for (const inv of invoices) {
      if (!Array.isArray(inv.items)) continue
      const cust = customers.find(c => c.id === inv.customer_id)
      for (const item of inv.items) {
        const prod = products.find(p => p.name === item.name)
        const key = item.name
        if (!map[key]) map[key] = { productName: key, productId: prod?.id, totalSold: 0, stock: prod?.stock ?? 0, warrantyMonths: prod?.warranty_months, records: [] }
        map[key].totalSold += (item.qty || 1)
        map[key].records.push({ customerName: cust?.name || "—", date: inv.date, qty: item.qty || 1, invoiceNum: fmtInvNum(inv) })
      }
    }
    const values = Object.values(map)
    for (const v of values) v.stock = Math.max((v.stock || 0) - v.totalSold, 0)
    return values.sort((a, b) => b.totalSold - a.totalSold)
  }, [invoices, products, customers])

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
    shopifySettings, setShopifySettings,
    shopifyVariantLinks, setShopifyVariantLinks,
    qProducts, qWarehouses, qStocks, qSuppliers,
    qCustomers, qLineItemAliases,
    qInvoices, qInventory,
    qEmployees, qTasks, qTaskAssignees,
    qFeedbacks, qUpdateLogs, qLogComments,
    qWaSettings, qWaWhitelist, qWaMessages, qWaPending, qWaUnresolved,
    qCompanies, qWaReports, qWaHeartbeat, qWaLogs, qWaClients,
    qShopifySettings, qShopifyVariantLinks,
    qTaskPending,
    // 跨 view 共用的派生 helper
    customerGroups,
    warrantyItems,
    outOfStockSkus,
    lowStockSkus,
    allWarrantyItems,
    derivedInventory,
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
