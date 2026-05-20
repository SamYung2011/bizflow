import React, { useState, useMemo, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabaseClient.js'
import { c, radius, S, useToggleSet, Empty, Pill, fmtShort, fmtDateTime } from '../styles.jsx'
import { useT } from '../i18n.jsx'
import { isTaskAssignedTo, empDoneFor, empAbandonedFor, isAwaitingApproval, uploadAttachment, empIdsInCompany } from '../lib/taskHelpers.js'
import EditTaskModal from '../components/EditTaskModal.jsx'
import AssigneeChipEditor from '../components/AssigneeChipEditor.jsx'
import CalendarView from '../components/CalendarView.jsx'

// ============================================================
//  任務模組：員工側欄 + 任務總覽 + 單員工任務看板 + 新建任務表單 + 反饋面板
// ============================================================

export default function TasksView({ data, me, session, isMobile, ctx }) {
  const { t } = useT()
  const { employees: allEmployees, empCompanies, tasks: allTasks, assigneesByTask } = data
  const userId = session.user.id

  // 按當前活躍公司（ctx.activeCompanyId）過濾員工 + 任務
  const empIdsInActive = useMemo(
    () => empIdsInCompany(empCompanies, ctx.activeCompanyId),
    [empCompanies, ctx.activeCompanyId]
  )
  const employees = useMemo(
    () => allEmployees.filter(e => e.active !== false && empIdsInActive.has(e.id)),
    [allEmployees, empIdsInActive]
  )
  const tasksByCompany = useMemo(
    () => allTasks.filter(t => t.company_id === ctx.activeCompanyId),
    [allTasks, ctx.activeCompanyId]
  )

  // 視圖模式 + 「僅看我發布的」toggle，sessionStorage 持久化
  const [viewMode, setViewMode] = useState(() => sessionStorage.getItem('team-tasks-view-mode') || 'board')
  const [onlyMyCreated, setOnlyMyCreated] = useState(() => sessionStorage.getItem('team-tasks-only-mine') === '1')
  useEffect(() => { sessionStorage.setItem('team-tasks-view-mode', viewMode) }, [viewMode])
  useEffect(() => { sessionStorage.setItem('team-tasks-only-mine', onlyMyCreated ? '1' : '0') }, [onlyMyCreated])

  // 「僅看我發布的」toggle → 對所有下游視圖（看板/日曆/總覽）生效
  const tasks = useMemo(
    () => onlyMyCreated ? tasksByCompany.filter(tk => tk.creator_employee_id === me.id) : tasksByCompany,
    [tasksByCompany, onlyMyCreated, me.id]
  )
  // 日曆視圖：只看「跟我相關」（assignee=me 或 creator=me）
  const myRelatedTasks = useMemo(
    () => tasks.filter(tk => tk.creator_employee_id === me.id || isTaskAssignedTo(tk, me.id, assigneesByTask)),
    [tasks, me.id, assigneesByTask]
  )
  // 包裝 data 給子組件用（任務/員工已按公司過濾 + onlyMyCreated 過濾）
  const scopedData = useMemo(
    () => ({ ...data, tasks, employees }),
    [data, tasks, employees]
  )
  const visibleEmployees = employees  // 別名兼容

  // mode：super admin 預設 overview；其他人預設選自己
  const [mode, setMode] = useState(ctx.isSuperAdmin || ctx.isAdminOfActive ? 'overview' : 'list')
  const [selectedEmpId, setSelectedEmpId] = useState(ctx.isSuperAdmin || ctx.isAdminOfActive ? null : me.id)
  const [editingTask, setEditingTask] = useState(null)
  const [overviewExpanded, toggleOverviewExpanded] = useToggleSet()

  const selectedEmp = selectedEmpId ? employees.find(e => e.id === selectedEmpId) : null

  // 視圖切換 + toggle 控件（看板/日曆共用）
  const viewHeader = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
      <div style={{ display: 'inline-flex', background: c.card, borderRadius: radius.sm, border: `1px solid ${c.border}`, overflow: 'hidden' }}>
        <button onClick={() => setViewMode('board')} style={{ padding: '6px 16px', background: viewMode === 'board' ? c.accent : 'transparent', color: viewMode === 'board' ? '#fff' : c.textMuted, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{t('看板')}</button>
        <button onClick={() => setViewMode('calendar')} style={{ padding: '6px 16px', background: viewMode === 'calendar' ? c.accent : 'transparent', color: viewMode === 'calendar' ? '#fff' : c.textMuted, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{t('日曆')}</button>
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.textMuted, cursor: 'pointer' }}>
        <input type="checkbox" checked={onlyMyCreated} onChange={e => setOnlyMyCreated(e.target.checked)} />
        {t('僅看我發布的')}
      </label>
    </div>
  )

  // 日曆視圖：全寬，不顯示員工側欄
  if (viewMode === 'calendar') {
    return (
      <div>
        {viewHeader}
        <CalendarView tasks={myRelatedTasks} employees={visibleEmployees} assigneesByTask={assigneesByTask} me={me} setEditingTask={setEditingTask} />
        {editingTask && <EditTaskModal task={editingTask} data={scopedData} me={me} userId={userId} onClose={() => setEditingTask(null)} ctx={ctx} />}
      </div>
    )
  }

  if (isMobile) {
    return (
      <div>
        {viewHeader}
        {selectedEmp ? (
          <div>
            <button onClick={() => setSelectedEmpId(null)} style={{ ...S.btnGhostSm, marginBottom: 12 }}>← {t('返回員工列表')}</button>
            <TaskBoard emp={selectedEmp} data={scopedData} me={me} userId={userId} setEditingTask={setEditingTask} companyId={ctx.activeCompanyId} ctx={ctx} compact />
          </div>
        ) : (
          <EmpListMobile employees={visibleEmployees} tasks={tasks} assigneesByTask={assigneesByTask} onSelect={(e) => setSelectedEmpId(e.id)} me={me} />
        )}
        {editingTask && <EditTaskModal task={editingTask} data={scopedData} me={me} userId={userId} onClose={() => setEditingTask(null)} ctx={ctx} />}
      </div>
    )
  }

  return (
    <div>
      {viewHeader}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 18, minHeight: 'calc(100vh - 80px)' }}>
        <EmpSidebar
          employees={visibleEmployees}
          mode={mode} setMode={setMode} selectedEmpId={selectedEmpId} setSelectedEmpId={setSelectedEmpId}
          tasks={tasks} assigneesByTask={assigneesByTask} me={me}
        />
        <div>
          {mode === 'overview' ? (
            <OverviewView employees={visibleEmployees} tasks={tasks} assigneesByTask={assigneesByTask} expanded={overviewExpanded} toggleExpanded={toggleOverviewExpanded} setEditingTask={setEditingTask} />
          ) : selectedEmp ? (
            <TaskBoard emp={selectedEmp} data={scopedData} me={me} userId={userId} setEditingTask={setEditingTask} companyId={ctx.activeCompanyId} ctx={ctx} />
          ) : (
            <Empty>← {t('從左側選擇員工查看任務看板')}</Empty>
          )}
        </div>
      </div>
      {editingTask && <EditTaskModal task={editingTask} data={scopedData} me={me} userId={userId} onClose={() => setEditingTask(null)} ctx={ctx} />}
    </div>
  )
}

// ====================  員工側欄  ====================
function EmpSidebar({ employees, mode, setMode, selectedEmpId, setSelectedEmpId, tasks, assigneesByTask, me }) {
  const { t } = useT()
  return (
    <aside style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg, padding: 14, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 100px)' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{t('員工')} <span style={{ fontSize: 11, color: c.textFaint, fontWeight: 400 }}>{employees.length}</span></div>
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

function EmpListMobile({ employees, tasks, assigneesByTask, onSelect, me }) {
  const { t } = useT()
  return (
    <div>
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
function OverviewView({ employees, tasks, assigneesByTask, expanded, toggleExpanded, setEditingTask }) {
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
              <div onClick={() => toggleExpanded(e.id)} style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
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
function TaskBoard({ emp, data, me, userId, setEditingTask, compact, companyId, ctx }) {
  const { t } = useT()
  const { employees, tasks, feedbacks, assigneesByTask, departments, empDepts, empCompanies } = data
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

  // 發布人在任務列表上 toggle 自己創建的任務。
  // 勾上：未勾 assignee 一併標完成；task done；needs_approval 時順便核驗通過。
  // 反勾：只清 task 表狀態，不動 task_assignees，保留 assignee 自己標的進度。
  const creatorToggleDone = async (task) => {
    if (task.status === 'done') {
      const { error } = await supabase.from('employee_tasks').update({ status: 'open', completed_at: null, approved_at: null, approved_by: null }).eq('id', task.id)
      if (error) return alert(error.message)
    } else {
      const list = assigneesByTask.get(task.id) || []
      const now = new Date().toISOString()
      const pendingIds = list.filter(a => a.completed_at == null && a.abandoned_at == null).map(a => a.employee_id)
      if (pendingIds.length > 0) {
        const { error } = await supabase.from('task_assignees').update({ completed_at: now }).eq('task_id', task.id).in('employee_id', pendingIds)
        if (error) return alert(error.message)
      }
      const patch = { status: 'done', completed_at: now }
      if (task.needs_approval) { patch.approved_at = now; patch.approved_by = me.id }
      const { error } = await supabase.from('employee_tasks').update(patch).eq('id', task.id)
      if (error) return alert(error.message)
    }
    queryClient.invalidateQueries({ queryKey: ['admin', 'task_assignees'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'employee_tasks'] })
  }

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
    const isMeCreator = task.creator_employee_id === me.id
    const isDone = isEmpAssignee ? eDone(task) : task.status === 'done'
    const isAb = isEmpAssignee ? eAb(task) : task.status === 'abandoned'
    // 列表勾的權限：assignee 雙向 toggle 自己 row；creator 雙向 toggle 整個 task
    const canTick = isEmpAssignee || (isMeCreator && !isAb)
    const onTick = () => {
      if (isEmpAssignee) return toggleDone(task)
      if (isMeCreator && !isAb) return creatorToggleDone(task)
    }
    const subtasks = tasks.filter(s => s.parent_task_id === task.id)
    const subDone = subtasks.filter(s => s.status === 'done').length
    const fbCount = feedbacks.filter(f => f.task_id === task.id).length
    const list = assigneesByTask.get(task.id) || []
    return (
      <div key={task.id} onClick={(e) => { if (e.target.tagName !== 'INPUT') setEditingTask(task) }} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.md, padding: '9px 11px', marginBottom: 6, opacity: (isDone || isAb) ? 0.55 : 1, cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <input type="checkbox" checked={isDone} disabled={!canTick} onChange={onTick} onClick={e => e.stopPropagation()} style={{ width: 14, height: 14, marginTop: 2, cursor: canTick ? 'pointer' : 'not-allowed' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {task.parent_task_id && (() => {
              const parent = tasks.find(p => p.id === task.parent_task_id)
              return parent ? <div style={{ fontSize: 10, color: c.textFaint, marginBottom: 2 }}>↳ {parent.title}</div> : null
            })()}
            <div style={{ fontSize: 13, fontWeight: 500, textDecoration: isDone ? 'line-through' : 'none', color: (isDone || isAb) ? c.textMuted : c.text, lineHeight: 1.4 }}>{task.title}</div>
            <div style={{ fontSize: 10, color: c.textFaint, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {task.creator_employee_id && task.creator_employee_id !== emp.id && (() => {
                const cr = employees.find(x => x.id === task.creator_employee_id)
                return cr ? <Pill>{cr.name} {t('分配')}</Pill> : null
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
                return <Pill tone="amber">{t('等待')} {cr?.name || t('發布人')} {t('核驗')}</Pill>
              })()}
              {task.department_id && (() => {
                const d = (departments || []).find(x => x.id === task.department_id)
                return d ? <Pill tone="purple">{d.name} {t('部門')}</Pill> : null
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

  // 新增任務權限：super/company admin / 有 can_create_task / 自己給自己（永遠允許）
  const canCreate = ctx?.isSuperAdmin || ctx?.isAdminOfActive || ctx?.hasPermission?.('can_create_task') || emp.id === me.id
  const newTaskBlock = canCreate
    ? <NewTaskForm emp={emp} me={me} employees={employees} companyId={companyId} departments={departments} empDepts={empDepts} empCompanies={empCompanies} ctx={ctx} />
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
  const [expanded, toggle] = useToggleSet()
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
function NewTaskForm({ emp, me, employees, companyId, departments = [], empDepts = [], empCompanies = [], ctx }) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('low')
  const [note, setNote] = useState('')
  const [assigneeIds, setAssigneeIds] = useState(null)  // null = default 用 emp
  const [needsApproval, setNeedsApproval] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  // 子任務：[{ title, assignees }]。assignees=null 沿用父任務；否則自定義
  const [subtaskItems, setSubtaskItems] = useState([])
  const [departmentId, setDepartmentId] = useState('')  // '' = 公司內可見；非空 = 部門專屬

  // 任務所屬公司：companyId prop → emp.company_id → me.company_id
  const taskCompanyId = companyId || emp?.company_id || me.company_id
  // 該公司的部門列表 — 普通員工只能選自己加入的部門，admin / super admin 看全部
  const coDepartments = useMemo(() => {
    const all = departments.filter(d => d.company_id === taskCompanyId)
    if (ctx?.isSuperAdmin || ctx?.isAdminOfActive) return all
    const myDeptIds = new Set(empDepts.filter(ed => ed.employee_id === me.id).map(ed => ed.department_id))
    return all.filter(d => myDeptIds.has(d.id))
  }, [departments, taskCompanyId, ctx?.isSuperAdmin, ctx?.isAdminOfActive, empDepts, me.id])
  // 選中部門時的成員 id set（過濾候選 assignee 用）
  const deptMemberIds = useMemo(() => {
    if (!departmentId) return null
    return new Set(empDepts.filter(ed => ed.department_id === departmentId).map(ed => ed.employee_id))
  }, [departmentId, empDepts])

  const effective = assigneeIds === null ? [emp.id] : assigneeIds
  // 候選限「任務所屬公司」的 binding 成員（跨公司綁定靠 employee_companies，不能用 employees.company_id 老字段）
  const empIdsInScope = useMemo(
    () => empIdsInCompany(empCompanies, taskCompanyId),
    [empCompanies, taskCompanyId]
  )
  const sameCo = (e) => taskCompanyId ? empIdsInScope.has(e.id) : true
  let activeEmps = employees.filter(e => e.active !== false && sameCo(e))
  // 選了部門 → 候選再過濾為該部門成員
  if (deptMemberIds) activeEmps = activeEmps.filter(e => deptMemberIds.has(e.id))
  // can_assign_others：沒這個權限 → 候選列表空 + 鎖住現有 assignee 不能刪（強制只能自己）
  const canAssignOthers = ctx?.isSuperAdmin || ctx?.isAdminOfActive || ctx?.hasPermission?.('can_assign_others')
  const candidates = activeEmps.filter(e => !effective.includes(e.id))

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
        start_date: startDate || null,
        due_date: dueDate || null,
        company_id: effectiveCompanyId,
        department_id: departmentId || null,
      }).select().single()
      if (error) throw error
      const rows = effective.map(eid => ({ task_id: data.id, employee_id: eid }))
      const { error: ae } = await supabase.from('task_assignees').insert(rows)
      if (ae) throw ae
      if (files.length > 0) {
        const attachments = await Promise.all(files.map(f => uploadAttachment(f, data.id)))
        await supabase.from('employee_tasks').update({ attachments }).eq('id', data.id)
      }
      // 子任務：assignees=null 沿用父；否則用自定義列表
      const cleanSubs = subtaskItems
        .map(s => ({ title: s.title.trim(), assignees: s.assignees }))
        .filter(s => s.title)
      for (const { title: subTitle, assignees: subAssignees } of cleanSubs) {
        const eff = subAssignees && subAssignees.length > 0 ? subAssignees : effective
        const { data: sub, error: se } = await supabase.from('employee_tasks').insert({
          employee_id: eff[0],
          creator_employee_id: me.id,
          needs_approval: needsApproval,
          title: subTitle,
          priority: 'none',
          parent_task_id: data.id,
          company_id: effectiveCompanyId,
          department_id: departmentId || null,
        }).select().single()
        if (se) { console.error('子任務新增失敗', se); continue }
        await supabase.from('task_assignees').insert(eff.map(eid => ({ task_id: sub.id, employee_id: eid })))
      }
      setTitle(''); setNote(''); setPriority('low'); setAssigneeIds(null); setNeedsApproval(false); setStartDate(''); setDueDate(''); setFiles([]); setSubtaskItems([]); setDepartmentId('')
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
      {coDepartments.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 4 }}>{t('發佈範圍')}</div>
          <select
            value={departmentId}
            onChange={e => {
              const newDeptId = e.target.value
              setDepartmentId(newDeptId)
              if (newDeptId) {
                const memberSet = new Set(empDepts.filter(ed => ed.department_id === newDeptId).map(ed => ed.employee_id))
                if (assigneeIds !== null) {
                  const pruned = assigneeIds.filter(id => memberSet.has(id))
                  setAssigneeIds(pruned.length > 0 ? pruned : null)
                }
                // 子任務的自定義 assignees 也要過濾，否則部門 trigger 會卡 INSERT
                setSubtaskItems(prev => prev.map(it => {
                  if (it.assignees === null) return it
                  const pruned = it.assignees.filter(id => memberSet.has(id))
                  return { ...it, assignees: pruned.length > 0 ? pruned : null }
                }))
              }
            }}
            style={{ ...S.input, marginBottom: 8 }}>
            <option value="">{t('公司內可見（默認）')}</option>
            {coDepartments.map(d => (
              <option key={d.id} value={d.id}>{d.name} {t('（部門專屬）')}</option>
            ))}
          </select>
        </>
      )}
      <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 4 }}>{t('分配給')} · {effective.length}{!canAssignOthers && <span style={{ color: c.textFaint, marginLeft: 6, fontSize: 10 }}>{t('（無權分配他人）')}</span>}</div>
      <div style={{ marginBottom: 8 }}>
        <AssigneeChipEditor value={effective} onChange={setAssigneeIds} candidates={candidates} employees={employees} readOnly={!canAssignOthers} placeholder={t('@ 加成員')} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10, fontSize: 11, color: c.textMuted, cursor: 'pointer' }}>
        <input type="checkbox" checked={needsApproval} onChange={e => setNeedsApproval(e.target.checked)} />{t('完成後需我核驗')}
      </label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('任務標題...')} style={{ ...S.input, marginBottom: 8 }} />
      <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={t('描述 / 備註（可選）')} style={{ ...S.input, minHeight: 60, resize: 'vertical' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: c.textMuted }}>{t('起始：')}</span>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: '4px 8px', borderRadius: radius.sm, border: `1px solid ${c.border}`, fontSize: 11 }} />
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

      {/* 子任務：assignees 默認沿用父任務，可單獨改 */}
      <div style={{ marginBottom: 10, paddingTop: 8, borderTop: `1px dashed ${c.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: c.textMuted }}>{t('子任務（可選）')}{subtaskItems.length > 0 && <span style={{ color: c.textFaint, marginLeft: 4 }}>· {subtaskItems.length}</span>}</span>
          <button type="button" onClick={() => setSubtaskItems(prev => [...prev, { title: '', assignees: null }])} style={{ background: c.bg, border: `1px dashed ${c.border}`, borderRadius: radius.sm, padding: '2px 8px', fontSize: 10, color: c.accent, cursor: 'pointer' }}>＋ {t('加子任務')}</button>
        </div>
        {subtaskItems.map((item, i) => (
          <NewSubtaskRow key={i} index={i} item={item}
            setItem={(next) => setSubtaskItems(prev => prev.map((v, j) => j === i ? next : v))}
            removeItem={() => setSubtaskItems(prev => prev.filter((_, j) => j !== i))}
            parentEffective={effective} activeEmps={activeEmps} canAssignOthers={canAssignOthers} />
        ))}
      </div>

      <button onClick={submit} disabled={busy || !title.trim() || effective.length === 0} style={{ ...S.btnPrimary, width: '100%', opacity: (busy || !title.trim() || effective.length === 0) ? 0.4 : 1 }}>{busy ? t('處理中…') : t('新增任務')}</button>
    </div>
  )
}

// NewTaskForm 的子任務一行：title + 獨立 assignee chip editor（默認沿用父）
function NewSubtaskRow({ index, item, setItem, removeItem, parentEffective, activeEmps, canAssignOthers }) {
  const { t } = useT()
  const eff = item.assignees ?? parentEffective
  const inherited = item.assignees === null
  const onChange = (next) => {
    // × 到空 → 回到 null（沿用父任務），避免提交時走 fallback 走得不明顯
    setItem({ ...item, assignees: next.length === 0 ? null : next })
  }
  return (
    <div style={{ marginBottom: 6, padding: '6px 8px', border: `1px solid ${c.border}`, borderRadius: radius.sm, background: c.bg }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 9, color: c.textFaint, width: 14 }}>{index + 1}.</span>
        <input value={item.title} onChange={e => setItem({ ...item, title: e.target.value })} placeholder={t('子任務標題')} style={{ flex: 1, padding: '5px 8px', borderRadius: radius.sm, border: `1px solid ${c.border}`, fontSize: 11, outline: 'none', boxSizing: 'border-box' }} />
        <button type="button" onClick={removeItem} style={{ background: 'none', border: 'none', color: c.textFaint, cursor: 'pointer', fontSize: 13 }}>×</button>
      </div>
      {canAssignOthers && (
        <div style={{ opacity: inherited ? 0.85 : 1 }}>
          <AssigneeChipEditor value={eff} onChange={onChange} candidates={activeEmps.filter(e => !eff.includes(e.id))} employees={activeEmps} size="sm" placeholder={inherited ? t('沿用父任務 · @ 改') : t('@ 加')} />
        </div>
      )}
    </div>
  )
}
