import React, { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabaseClient.js'
import { c, radius, font, S, fetchAllTable, useIsMobile, Center, Empty, Field, Section, fmtDateTime } from './styles.jsx'
import AdminApp, { CommissionView } from './admin.jsx'

// ============================================================
//  Team Honnmono — 任務管理子應用
//  普通員工視角（admin 走 AdminApp）
// ============================================================

const HELEN_EMAIL = 'a1017339632@gmail.com'

export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [view, setView] = useState('tasks')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => { setSession(s); setAuthLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (authLoading) return <Center>正在載入…</Center>
  if (!session) return <AuthPage />
  return <AfterAuth session={session} view={view} setView={setView} />
}

// ====================  AUTH  ====================
function AuthPage() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        if (!email || !password || !name || !companyName) throw new Error('請填寫郵箱、密碼、姓名、所屬公司')
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        const { error: pErr } = await supabase.from('task_pending').insert({
          email, name, company_name: companyName.trim(), note: note.trim() || null, user_id: data.user?.id,
        })
        if (pErr) throw new Error('註冊申請寫入失敗：' + pErr.message)
        setDone(true)
      }
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  if (done) return (
    <Center>
      <div style={{ fontSize: 24, fontWeight: 600, color: c.text }}>申請已提交</div>
      <div style={{ color: c.textMuted, fontSize: 14, maxWidth: 380, textAlign: 'center', lineHeight: 1.6, marginTop: 8 }}>
        管理員審核通過後你會收到通知。可以關閉這個頁面，審核通過後再回來登入。
      </div>
      <button onClick={() => { setDone(false); setMode('signin') }} style={S.btnPrimary}>返回登入</button>
    </Center>
  )

  return (
    <div style={{ minHeight: '100vh', background: c.bg, fontFamily: font.ui, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400, background: c.card, borderRadius: radius.lg, border: `1px solid ${c.border}`, padding: 32 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: c.text, marginBottom: 4 }}>Honnmono Team</div>
        <div style={{ fontSize: 13, color: c.textMuted, marginBottom: 24 }}>{mode === 'signin' ? '登入帳號' : '提交註冊申請'}</div>

        <div style={{ display: 'flex', gap: 4, padding: 4, background: c.bg, borderRadius: radius.md, marginBottom: 20 }}>
          <button onClick={() => setMode('signin')} style={S.segmentBtn(mode === 'signin')}>登入</button>
          <button onClick={() => setMode('signup')} style={S.segmentBtn(mode === 'signup')}>註冊</button>
        </div>

        <form onSubmit={submit}>
          {mode === 'signup' && <Field label="姓名"><input value={name} onChange={e => setName(e.target.value)} style={S.input} placeholder="必填" /></Field>}
          <Field label="郵箱"><input type="email" value={email} onChange={e => setEmail(e.target.value)} style={S.input} /></Field>
          <Field label="密碼"><input type="password" value={password} onChange={e => setPassword(e.target.value)} style={S.input} /></Field>
          {mode === 'signup' && (
            <>
              <Field label="所屬公司"><input value={companyName} onChange={e => setCompanyName(e.target.value)} style={S.input} placeholder="管理員會綁定到公司列表" /></Field>
              <Field label="備註（可選）"><textarea value={note} onChange={e => setNote(e.target.value)} style={{ ...S.input, minHeight: 56, resize: 'vertical' }} /></Field>
            </>
          )}
          {err && <div style={{ color: c.red, fontSize: 13, padding: 10, background: c.redBg, borderRadius: radius.sm, marginTop: 4 }}>{err}</div>}
          <button type="submit" disabled={busy} style={{ ...S.btnPrimary, width: '100%', marginTop: 12 }}>{busy ? '處理中…' : (mode === 'signin' ? '登入' : '提交申請')}</button>
        </form>
        <div style={{ fontSize: 12, color: c.textFaint, marginTop: 16, textAlign: 'center' }}>
          {mode === 'signup' ? '註冊需管理員審核' : '新用戶請點上方「註冊」'}
        </div>
      </div>
    </div>
  )
}

// ====================  AFTER AUTH ROUTER  ====================
function AfterAuth({ session, view, setView }) {
  const userId = session.user.id
  const qEmp = useQuery({
    queryKey: ['team', 'employees', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('*').eq('user_id', userId).maybeSingle()
      if (error) throw error
      return data
    },
    refetchInterval: 30000,
  })
  const qPending = useQuery({
    queryKey: ['team', 'task_pending_self', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('task_pending').select('*').eq('user_id', userId).order('requested_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data
    },
    enabled: qEmp.data === null,
    refetchInterval: 15000,
  })

  if (qEmp.isLoading) return <Center>正在載入…</Center>
  const me = qEmp.data
  if (!me) return <PendingPage pending={qPending.data} session={session} />

  // admin 分流：DB is_admin 字段 OR 老板 email（兜底）
  const isAdmin = me.is_admin === true || session.user.email === 'samyung2011@gmail.com'
  if (isAdmin) {
    const meWithAdmin = { ...me, is_admin: true }
    return <AdminApp me={meWithAdmin} session={session} view={view} setView={setView} />
  }

  // 普通員工 view 範圍：tasks / updatelog / commission（後者僅銷售）
  const allowed = ['tasks', 'updatelog']
  if (me.role === '銷售') allowed.push('commission')
  const empView = allowed.includes(view) ? view : 'tasks'
  return <EmployeeApp me={me} session={session} view={empView} setView={setView} />
}

function PendingPage({ pending, session }) {
  const userEmail = session.user.email
  const signOutBtn = <button onClick={() => supabase.auth.signOut()} style={{ ...S.btnGhost, marginTop: 12 }}>登出</button>
  if (!pending) return (
    <Center>
      <div style={{ fontSize: 22, fontWeight: 600, color: c.text }}>找不到註冊申請</div>
      <div style={{ color: c.textMuted, fontSize: 13, marginTop: 6 }}>{userEmail}</div>
      <div style={{ color: c.textFaint, fontSize: 13, marginTop: 12, maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>
        你的帳號已登入但找不到 task_pending 申請。如果你是現有 bizflow 員工，管理員可能還沒綁定 employees。請聯繫管理員。
      </div>
      {signOutBtn}
    </Center>
  )
  if (pending.approved == null) return (
    <Center>
      <div style={{ fontSize: 22, fontWeight: 600, color: c.text }}>等待管理員審核</div>
      <div style={{ color: c.textMuted, fontSize: 14, marginTop: 12, maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>
        申請公司：<strong style={{ color: c.text }}>{pending.company_name}</strong>
        <br />
        申請時間：{new Date(pending.requested_at).toLocaleString('zh-HK')}
      </div>
      {signOutBtn}
    </Center>
  )
  if (pending.approved === false) return (
    <Center>
      <div style={{ fontSize: 22, fontWeight: 600, color: c.red }}>申請已被拒絕</div>
      {pending.reject_reason && <div style={{ color: c.textMuted, fontSize: 14, marginTop: 10 }}>理由：{pending.reject_reason}</div>}
      {signOutBtn}
    </Center>
  )
  return null
}

// ====================  EMPLOYEE APP（普通員工/task 用戶視角）====================
function EmployeeApp({ me, session, view, setView }) {
  const isMobile = useIsMobile()
  return (
    <div style={{ minHeight: '100vh', background: c.bg, fontFamily: font.ui, color: c.text, WebkitFontSmoothing: 'antialiased' }}>
      <TopBar me={me} view={view} setView={setView} isMobile={isMobile} />
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '16px 14px' : '24px 32px' }}>
        {view === 'tasks' && <TasksView me={me} session={session} isMobile={isMobile} />}
        {view === 'updatelog' && <UpdateLogView me={me} session={session} isMobile={isMobile} />}
        {view === 'commission' && me.role === '銷售' && <CommissionView employees={[me]} me={me} lockedEmpId={me.id} />}
      </main>
    </div>
  )
}

function TopBar({ me, view, setView, isMobile }) {
  return (
    <header style={{ background: c.card, borderBottom: `1px solid ${c.border}`, padding: isMobile ? '10px 14px' : '12px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 32 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: c.text, letterSpacing: -0.2 }}>Honnmono Team</div>
        <nav style={{ display: 'flex', gap: 2 }}>
          <button onClick={() => setView('tasks')} style={S.navBtn(view === 'tasks')}>任務</button>
          {me.role === '銷售' && <button onClick={() => setView('commission')} style={S.navBtn(view === 'commission')}>我的佣金</button>}
          <button onClick={() => setView('updatelog')} style={S.navBtn(view === 'updatelog')}>更新日誌</button>
        </nav>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 12, color: c.textMuted, display: isMobile ? 'none' : 'block' }}>
          <span style={{ color: c.text, fontWeight: 600 }}>{me.name}</span>
          <span style={{ marginLeft: 6, color: c.textFaint }}>{me.kind || 'employee'}</span>
        </div>
        <button onClick={() => supabase.auth.signOut()} style={S.btnGhostSm}>登出</button>
      </div>
    </header>
  )
}

// ====================  TASKS (普通員工)  ====================
function TasksView({ me, session, isMobile }) {
  const queryClient = useQueryClient()
  const userId = session.user.id

  const qEmployees = useQuery({ queryKey: ['team', 'employees_all'], queryFn: () => fetchAllTable('employees', 'name'), refetchInterval: 30000 })
  const qTasks = useQuery({ queryKey: ['team', 'tasks'], queryFn: () => fetchAllTable('employee_tasks', 'created_at', false), refetchInterval: 5000 })
  const qAssignees = useQuery({ queryKey: ['team', 'task_assignees'], queryFn: () => fetchAllTable('task_assignees', 'created_at'), refetchInterval: 5000 })
  const qFeedbacks = useQuery({ queryKey: ['team', 'feedbacks'], queryFn: () => fetchAllTable('employee_task_feedbacks', 'created_at'), refetchInterval: 5000 })

  const employees = qEmployees.data || []
  const tasks = qTasks.data || []
  const assignees = qAssignees.data || []
  const feedbacks = qFeedbacks.data || []

  const visibleTasks = useMemo(() => {
    if (me.is_admin) return tasks
    const sameCo = new Set(employees.filter(e => e.company_id === me.company_id).map(e => e.id))
    sameCo.add(me.id)
    const visIds = new Set()
    for (const a of assignees) if (sameCo.has(a.employee_id)) visIds.add(a.task_id)
    for (const t of tasks) if (t.creator_employee_id && sameCo.has(t.creator_employee_id)) visIds.add(t.id)
    return tasks.filter(t => visIds.has(t.id))
  }, [tasks, assignees, employees, me])

  const myAssigneeRows = useMemo(() => assignees.filter(a => a.employee_id === me.id), [assignees, me.id])
  const myAssigneeByTask = useMemo(() => new Map(myAssigneeRows.map(a => [a.task_id, a])), [myAssigneeRows])
  const myTasks = useMemo(() => visibleTasks.filter(t => myAssigneeByTask.has(t.id)), [visibleTasks, myAssigneeByTask])
  const myTaskTree = useMemo(() => buildTaskTree(myTasks), [myTasks])

  const openTasks = myTaskTree.filter(({ task }) => {
    const a = myAssigneeByTask.get(task.id)
    return task.status === 'open' && a && !a.completed_at && !a.abandoned_at
  })
  const doneTasks = myTaskTree.filter(({ task }) => myAssigneeByTask.get(task.id)?.completed_at)
  const abandonedTasks = myTaskTree.filter(({ task }) => {
    const a = myAssigneeByTask.get(task.id)
    return a?.abandoned_at && !a.completed_at
  })

  const [selectedId, setSelectedId] = useState(null)
  const selectedTask = visibleTasks.find(t => t.id === selectedId)
  const selectedAssignee = myAssigneeByTask.get(selectedId)

  const handleClick = (taskId) => {
    if (isMobile) setSelectedId(selectedId === taskId ? null : taskId)
    else setSelectedId(taskId)
  }

  const markCompleted = async (taskId) => {
    const { error } = await supabase.from('task_assignees').update({ completed_at: new Date().toISOString(), abandoned_at: null }).eq('task_id', taskId).eq('employee_id', me.id)
    if (error) return alert(error.message)
    queryClient.invalidateQueries({ queryKey: ['team', 'task_assignees'] })
  }
  const markAbandoned = async (taskId) => {
    if (!confirm('確定放棄此任務？')) return
    const { error } = await supabase.from('task_assignees').update({ abandoned_at: new Date().toISOString(), completed_at: null }).eq('task_id', taskId).eq('employee_id', me.id)
    if (error) return alert(error.message)
    queryClient.invalidateQueries({ queryKey: ['team', 'task_assignees'] })
  }
  const reopen = async (taskId) => {
    const { error } = await supabase.from('task_assignees').update({ completed_at: null, abandoned_at: null }).eq('task_id', taskId).eq('employee_id', me.id)
    if (error) return alert(error.message)
    queryClient.invalidateQueries({ queryKey: ['team', 'task_assignees'] })
  }

  const renderList = () => (
    <div>
      <TaskSection title="進行中" items={openTasks} selectedId={selectedId} onClick={handleClick} employees={employees} myAssigneeByTask={myAssigneeByTask} isMobile={isMobile}
        renderDetail={isMobile ? (t, a) => <TaskDetail task={t} assignee={a} me={me} userId={userId} employees={employees} feedbacks={feedbacks} taskAssignees={assignees} onMarkCompleted={() => markCompleted(t.id)} onMarkAbandoned={() => markAbandoned(t.id)} onReopen={() => reopen(t.id)} compact /> : null}
      />
      <TaskSection title="已完成" items={doneTasks} selectedId={selectedId} onClick={handleClick} employees={employees} myAssigneeByTask={myAssigneeByTask} isMobile={isMobile} dim
        renderDetail={isMobile ? (t, a) => <TaskDetail task={t} assignee={a} me={me} userId={userId} employees={employees} feedbacks={feedbacks} taskAssignees={assignees} onMarkCompleted={() => markCompleted(t.id)} onMarkAbandoned={() => markAbandoned(t.id)} onReopen={() => reopen(t.id)} compact /> : null}
      />
      <TaskSection title="已放棄" items={abandonedTasks} selectedId={selectedId} onClick={handleClick} employees={employees} myAssigneeByTask={myAssigneeByTask} isMobile={isMobile} dim
        renderDetail={isMobile ? (t, a) => <TaskDetail task={t} assignee={a} me={me} userId={userId} employees={employees} feedbacks={feedbacks} taskAssignees={assignees} onMarkCompleted={() => markCompleted(t.id)} onMarkAbandoned={() => markAbandoned(t.id)} onReopen={() => reopen(t.id)} compact /> : null}
      />
      {myTaskTree.length === 0 && <Empty>還沒有被分配任何任務</Empty>}
    </div>
  )

  if (isMobile) return renderList()

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24 }}>
      <aside>{renderList()}</aside>
      <section style={{ position: 'sticky', top: 76, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' }}>
        {!selectedTask ? (
          <Empty>選擇左側任務查看詳情</Empty>
        ) : (
          <TaskDetail task={selectedTask} assignee={selectedAssignee} me={me} userId={userId} employees={employees} feedbacks={feedbacks} taskAssignees={assignees}
            onMarkCompleted={() => markCompleted(selectedTask.id)} onMarkAbandoned={() => markAbandoned(selectedTask.id)} onReopen={() => reopen(selectedTask.id)} />
        )}
      </section>
    </div>
  )
}

function buildTaskTree(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const result = []
  const seen = new Set()
  for (const t of tasks) {
    if (seen.has(t.id)) continue
    if (t.parent_task_id && byId.has(t.parent_task_id)) continue
    result.push({ task: t, isChild: false })
    seen.add(t.id)
    const children = tasks.filter(c => c.parent_task_id === t.id)
    for (const cd of children) {
      result.push({ task: cd, isChild: true })
      seen.add(cd.id)
    }
  }
  for (const t of tasks) {
    if (!seen.has(t.id)) {
      result.push({ task: t, isChild: true, orphan: true })
      seen.add(t.id)
    }
  }
  return result
}

function TaskSection({ title, items, selectedId, onClick, employees, myAssigneeByTask, isMobile, dim, renderDetail }) {
  const [collapsed, setCollapsed] = useState(false)
  if (items.length === 0) return null
  return (
    <div style={{ marginBottom: 18, opacity: dim ? 0.7 : 1 }}>
      <button onClick={() => setCollapsed(!collapsed)} style={{ ...S.sectionHeader }}>
        <span style={{ color: c.textFaint, fontSize: 10, marginRight: 6 }}>{collapsed ? '▶' : '▼'}</span>
        {title}
        <span style={{ color: c.textFaint, fontWeight: 400, marginLeft: 6 }}>{items.length}</span>
      </button>
      {!collapsed && items.map(({ task, isChild, orphan }) => {
        const a = myAssigneeByTask.get(task.id)
        const isSel = selectedId === task.id
        return (
          <React.Fragment key={task.id}>
            <TaskCard task={task} isChild={isChild} orphan={orphan} isSelected={isSel} onClick={() => onClick(task.id)} employees={employees} assignee={a} />
            {isMobile && isSel && renderDetail && (
              <div style={{ marginLeft: isChild ? 16 : 0, marginBottom: 12, padding: 14, background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.md }}>
                {renderDetail(task, a)}
              </div>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

function TaskCard({ task, isChild, orphan, isSelected, onClick, employees, assignee }) {
  const creator = employees.find(e => e.id === task.creator_employee_id)
  const due = task.due_date ? new Date(task.due_date) : null
  const overdue = due && due < new Date() && !assignee?.completed_at
  const parentName = orphan && task.parent_task_id ? '父任務' : null
  return (
    <div onClick={onClick} style={{
      background: isSelected ? c.accentBg : c.card,
      border: `1px solid ${isSelected ? c.accent : c.border}`,
      borderRadius: radius.md,
      padding: '10px 12px',
      marginBottom: 6,
      marginLeft: isChild ? 16 : 0,
      cursor: 'pointer',
      transition: 'border-color 0.1s',
    }}>
      {(isChild || parentName) && <div style={{ fontSize: 10, color: c.textFaint, marginBottom: 2 }}>↳ {parentName || '子任務'}</div>}
      <div style={{ fontSize: 13.5, fontWeight: 500, color: c.text, lineHeight: 1.4 }}>{task.title}</div>
      <div style={{ fontSize: 11, color: c.textFaint, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {creator && <span>· {creator.name}</span>}
        {due && <span style={{ color: overdue ? c.red : c.textFaint }}>· 截止 {due.toLocaleDateString('zh-HK', { month: '2-digit', day: '2-digit' })}</span>}
        <PriorityChip p={task.priority} />
      </div>
    </div>
  )
}

function PriorityChip({ p }) {
  if (!p || p === 'none') return null
  const label = p === 'high' ? '高' : p === 'mid' ? '中' : '低'
  const color = p === 'high' ? c.red : p === 'mid' ? c.amber : c.textMuted
  return <span style={{ color, fontWeight: 600 }}>· {label}</span>
}

// ====================  TASK DETAIL（普通員工）  ====================
function TaskDetail({ task, assignee, me, userId, employees, feedbacks, taskAssignees, onMarkCompleted, onMarkAbandoned, onReopen, compact }) {
  const [newFb, setNewFb] = useState('')
  const [pendingMentions, setPendingMentions] = useState([])
  const queryClient = useQueryClient()

  const tFb = feedbacks.filter(f => f.task_id === task.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const tAs = taskAssignees.filter(a => a.task_id === task.id)
  const mentionPeople = useMemo(() => {
    const ids = new Set(tAs.map(a => a.employee_id))
    if (task.creator_employee_id) ids.add(task.creator_employee_id)
    return employees.filter(e => ids.has(e.id) && e.user_id && e.id !== me.id).map(e => ({ user_id: e.user_id, name: e.name }))
  }, [tAs, task.creator_employee_id, employees, me.id])

  const submit = async () => {
    const body = newFb.trim()
    if (!body) return
    const { error } = await supabase.from('employee_task_feedbacks').insert({
      task_id: task.id, author_user_id: userId, author_name: me.name, body, mentioned_user_ids: pendingMentions.map(m => m.user_id),
    })
    if (error) return alert(error.message)
    setNewFb(''); setPendingMentions([])
    queryClient.invalidateQueries({ queryKey: ['team', 'feedbacks'] })
  }

  return (
    <div>
      <div>
        <div style={{ fontSize: compact ? 15 : 20, fontWeight: 600, color: c.text, marginBottom: 4 }}>{task.title}</div>
        <div style={{ fontSize: 12, color: c.textMuted, marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <PriorityChip p={task.priority} />
          {task.due_date && <span>截止 {new Date(task.due_date).toLocaleDateString('zh-HK')}</span>}
          {assignee?.completed_at && <span style={{ color: c.green, fontWeight: 600 }}>✓ 已完成</span>}
          {assignee?.abandoned_at && !assignee?.completed_at && <span style={{ color: c.red, fontWeight: 600 }}>✗ 已放棄</span>}
        </div>
      </div>

      {task.note && (
        <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: radius.md, padding: 12, marginBottom: 14, fontSize: 13, color: c.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{task.note}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {!assignee?.completed_at && !assignee?.abandoned_at && (
          <>
            <button onClick={onMarkCompleted} style={{ ...S.btnSuccess }}>✓ 標記完成</button>
            <button onClick={onMarkAbandoned} style={S.btnDanger}>放棄</button>
          </>
        )}
        {(assignee?.completed_at || assignee?.abandoned_at) && (
          <button onClick={onReopen} style={S.btnGhost}>撤回</button>
        )}
      </div>

      <Section label="負責人">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tAs.map(a => {
            const e = employees.find(x => x.id === a.employee_id)
            if (!e) return null
            const done = !!a.completed_at, giveup = !!a.abandoned_at && !done
            return (
              <span key={`${a.task_id}-${a.employee_id}`} style={{ fontSize: 12, padding: '3px 9px', background: done ? c.greenBg : giveup ? c.redBg : c.bg, color: done ? c.green : giveup ? c.red : c.text, border: `1px solid ${c.border}`, borderRadius: 12 }}>
                {done ? '✓ ' : giveup ? '✗ ' : ''}{e.name}
              </span>
            )
          })}
        </div>
      </Section>

      <Section label={`反饋 (${tFb.length})`}>
        {tFb.length === 0 && <div style={{ color: c.textFaint, fontSize: 12 }}>還沒有任何反饋</div>}
        {tFb.map(f => (
          <div key={f.id} style={{ borderLeft: `2px solid ${c.border}`, paddingLeft: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 2 }}>
              <strong style={{ color: c.text }}>{f.author_name || '匿名'}</strong>
              <span style={{ marginLeft: 6, color: c.textFaint }}>{fmtDateTime(f.created_at)}</span>
            </div>
            <div style={{ fontSize: 13, color: c.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{f.body}</div>
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <textarea value={newFb} onChange={e => setNewFb(e.target.value)} placeholder="留言…" style={{ ...S.input, minHeight: 60, resize: 'vertical' }} />
          {mentionPeople.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              <span style={{ fontSize: 11, color: c.textFaint, marginRight: 4 }}>提及：</span>
              {mentionPeople.map(p => {
                const on = pendingMentions.find(m => m.user_id === p.user_id)
                return (
                  <button key={p.user_id} type="button" onClick={() => {
                    setNewFb(prev => prev + '@' + p.name + ' ')
                    if (!on) setPendingMentions(prev => [...prev, p])
                  }} style={{ background: on ? c.accent : c.card, color: on ? '#fff' : c.accent, border: `1px solid ${c.accent}`, borderRadius: 12, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>@{p.name}</button>
                )
              })}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button onClick={submit} disabled={!newFb.trim()} style={{ ...S.btnPrimary, opacity: newFb.trim() ? 1 : 0.4, padding: '6px 14px', fontSize: 12 }}>發送</button>
          </div>
        </div>
      </Section>
    </div>
  )
}

// ====================  UPDATE LOG  ====================
export function UpdateLogView({ me, session, isMobile }) {
  const queryClient = useQueryClient()
  const userId = session.user.id
  const canWrite = session.user.email === HELEN_EMAIL || me.is_admin === true

  const qLogs = useQuery({ queryKey: ['team', 'team_update_logs'], queryFn: () => fetchAllTable('team_update_logs', 'created_at', false), refetchInterval: 15000 })
  const qCmts = useQuery({ queryKey: ['team', 'team_update_log_comments'], queryFn: () => fetchAllTable('team_update_log_comments', 'created_at'), refetchInterval: 15000 })

  const [draft, setDraft] = useState({ summary: '', detail: '' })
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({ summary: '', detail: '' })
  const [expanded, setExpanded] = useState(new Set())
  const [cmtDraft, setCmtDraft] = useState({})

  const logs = qLogs.data || []
  const comments = qCmts.data || []

  const add = async () => {
    if (!draft.summary.trim()) return
    const { error } = await supabase.from('team_update_logs').insert({ summary: draft.summary.trim(), detail: draft.detail.trim() || null, author_user_id: userId })
    if (error) return alert(error.message)
    setDraft({ summary: '', detail: '' })
    queryClient.invalidateQueries({ queryKey: ['team', 'team_update_logs'] })
  }
  const save = async (id) => {
    const { error } = await supabase.from('team_update_logs').update({ summary: editDraft.summary.trim(), detail: editDraft.detail.trim() || null, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return alert(error.message)
    setEditingId(null)
    queryClient.invalidateQueries({ queryKey: ['team', 'team_update_logs'] })
  }
  const del = async (id) => {
    if (!confirm('確定刪除？')) return
    const { error } = await supabase.from('team_update_logs').delete().eq('id', id)
    if (error) return alert(error.message)
    queryClient.invalidateQueries({ queryKey: ['team', 'team_update_logs'] })
  }
  const cmt = async (lid) => {
    const body = (cmtDraft[lid] || '').trim()
    if (!body) return
    const { error } = await supabase.from('team_update_log_comments').insert({ update_log_id: lid, author_user_id: userId, author_name: me.name, body })
    if (error) return alert(error.message)
    setCmtDraft(prev => ({ ...prev, [lid]: '' }))
    queryClient.invalidateQueries({ queryKey: ['team', 'team_update_log_comments'] })
  }
  const delCmt = async (id) => {
    const { error } = await supabase.from('team_update_log_comments').delete().eq('id', id)
    if (error) return alert(error.message)
    queryClient.invalidateQueries({ queryKey: ['team', 'team_update_log_comments'] })
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 18, letterSpacing: -0.3 }}>更新日誌</h1>

      {canWrite && (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg, padding: 14, marginBottom: 24 }}>
          <input value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value })} placeholder="標題（必填）" style={S.input} />
          <textarea value={draft.detail} onChange={e => setDraft({ ...draft, detail: e.target.value })} placeholder="詳細（可選）" style={{ ...S.input, minHeight: 60, resize: 'vertical' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={add} disabled={!draft.summary.trim()} style={{ ...S.btnPrimary, opacity: draft.summary.trim() ? 1 : 0.4 }}>發布</button>
          </div>
        </div>
      )}

      {logs.length === 0 ? <Empty>還沒有任何更新</Empty> : (
        <div>
          {logs.map(log => {
            const exp = expanded.has(log.id)
            const isEdit = editingId === log.id
            const lcs = comments.filter(co => co.update_log_id === log.id)
            return (
              <div key={log.id} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg, padding: 16, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: c.textMuted }}>{new Date(log.created_at).toLocaleString('zh-HK')}</div>
                  {canWrite && !isEdit && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { setEditingId(log.id); setEditDraft({ summary: log.summary, detail: log.detail || '' }) }} style={S.iconBtn}>✏</button>
                      <button onClick={() => del(log.id)} style={{ ...S.iconBtn, color: c.red }}>×</button>
                    </div>
                  )}
                </div>
                {isEdit ? (
                  <div>
                    <input value={editDraft.summary} onChange={e => setEditDraft({ ...editDraft, summary: e.target.value })} style={S.input} />
                    <textarea value={editDraft.detail} onChange={e => setEditDraft({ ...editDraft, detail: e.target.value })} style={{ ...S.input, minHeight: 80, resize: 'vertical' }} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => save(log.id)} style={S.btnPrimary}>保存</button>
                      <button onClick={() => setEditingId(null)} style={S.btnGhost}>取消</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div onClick={() => setExpanded(p => { const n = new Set(p); n.has(log.id) ? n.delete(log.id) : n.add(log.id); return n })} style={{ cursor: log.detail ? 'pointer' : 'default', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      {log.detail && <span style={{ color: c.textFaint, fontSize: 10, marginTop: 5 }}>{exp ? '▼' : '▶'}</span>}
                      <div style={{ fontSize: 14, fontWeight: 500, color: c.text, whiteSpace: 'pre-wrap', flex: 1 }}>{log.summary}</div>
                    </div>
                    {exp && log.detail && <div style={{ marginTop: 10, padding: 12, background: c.bg, borderRadius: radius.md, fontSize: 13, color: c.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{log.detail}</div>}
                  </>
                )}

                <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${c.border}` }}>
                  {lcs.map(co => (
                    <div key={co.id} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 11, color: c.textMuted, display: 'flex', justifyContent: 'space-between' }}>
                        <span><strong style={{ color: c.text }}>{co.author_name}</strong> · {fmtDateTime(co.created_at)}</span>
                        {(co.author_user_id === userId || me.is_admin) && <button onClick={() => delCmt(co.id)} style={{ ...S.iconBtn, color: c.red, fontSize: 11 }}>×</button>}
                      </div>
                      <div style={{ fontSize: 12, color: c.text, marginTop: 2, whiteSpace: 'pre-wrap' }}>{co.body}</div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <input value={cmtDraft[log.id] || ''} onChange={e => setCmtDraft(p => ({ ...p, [log.id]: e.target.value }))} placeholder="評論…" style={{ ...S.input, marginBottom: 0, flex: 1 }} />
                    <button onClick={() => cmt(log.id)} disabled={!(cmtDraft[log.id] || '').trim()} style={{ ...S.btnPrimary, padding: '6px 12px', fontSize: 12, opacity: (cmtDraft[log.id] || '').trim() ? 1 : 0.4 }}>發送</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
