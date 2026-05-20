import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabaseClient.js'
import { c, radius, S, Pill, fmtDateTime } from '../styles.jsx'
import AssigneeChipEditor from './AssigneeChipEditor.jsx'
import { useT } from '../i18n.jsx'
import {
  isAwaitingApproval,
  getTaskCompanyId,
  uploadAttachment,
  empDoneFor,
  empIdsInCompany,
} from '../lib/taskHelpers.js'

export default function EditTaskModal({ task: initial, data, me, userId, onClose, ctx }) {
  const { t } = useT()
  const { employees, tasks, feedbacks, assigneesByTask, departments, empDepts, empCompanies } = data
  const queryClient = useQueryClient()
  const [tk, setTk] = useState(initial)
  // 切到不同 task 時 reset。同 task 內部由本地 state 主導，後台 query 刷新不會吞用戶輸入
  useEffect(() => { setTk(initial) }, [initial.id])

  const tkList = assigneesByTask.get(tk.id) || []
  const isAssignee = tkList.some(a => a.employee_id === me.id)
  const isCreator = tk.creator_employee_id === me.id
  // RBAC：super/company admin / 有 can_edit_others_tasks / 創建人本人 → 可編輯
  const canEdit = ctx?.isSuperAdmin || ctx?.isAdminOfActive || isCreator || ctx?.hasPermission?.('can_edit_others_tasks')
  const canAssignOthers = ctx?.isSuperAdmin || ctx?.isAdminOfActive || ctx?.hasPermission?.('can_assign_others')
  const ro = !canEdit
  // ro 觸發提示：替代之前頂部 banner，浮窗 toast 樣式，3 秒自動消失
  const [roToast, setRoToast] = useState(false)
  const roToastTimer = useRef(null)
  const roAlert = () => {
    setRoToast(true)
    if (roToastTimer.current) clearTimeout(roToastTimer.current)
    roToastTimer.current = setTimeout(() => setRoToast(false), 3000)
  }
  const roBlur = (e) => { e.target.blur(); roAlert() }
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

  const saveTitle = async () => {
    if (ro) return
    if ((tk.title || '') === (initial.title || '')) return
    const patch = { title: tk.title }
    if (!isCreator) {
      patch.title_edited_by = me.id
      patch.title_edited_at = new Date().toISOString()
    }
    await updateField(patch)
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

  const canDelete = ctx?.isSuperAdmin || ctx?.isAdminOfActive || isCreator || (isAssignee && tkList.length === 1 && !tk.needs_approval) || ctx?.hasPermission?.('can_delete_others_tasks')
  const canValidate = ctx?.isSuperAdmin || ctx?.isAdminOfActive || isCreator || ctx?.hasPermission?.('can_validate_task')

  return (
    <div style={S.modal} onClick={onClose}>
      <div style={{ ...S.modalCard(600), position: 'relative' }} onClick={e => e.stopPropagation()}>
        {roToast && (
          <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#1f2937', color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 100, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            {t('您不是發布人，不能修改內容')}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ v: 'high', l: t('高優'), c: c.red }, { v: 'mid', l: t('中優'), c: c.amber }, { v: 'low', l: t('低優'), c: c.green }].map(opt => {
              const on = tk.priority === opt.v || (opt.v === 'low' && (tk.priority === 'none' || !tk.priority))
              return <button key={opt.v} onClick={ro ? roAlert : (() => updateField({ priority: opt.v }))} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, border: `1px solid ${on ? opt.c : c.border}`, background: on ? opt.c + '18' : c.card, color: on ? opt.c : c.textMuted, cursor: 'pointer' }}>{opt.l}</button>
            })}
          </div>
          <button onClick={onClose} style={S.iconBtn}>×</button>
        </div>

        <input value={tk.title || ''} onFocus={ro ? roBlur : undefined} onChange={e => setTk({ ...tk, title: e.target.value })} onBlur={saveTitle} style={{ width: '100%', padding: '8px 0', fontSize: 20, fontWeight: 700, border: 'none', outline: 'none', background: 'transparent', marginBottom: 8, color: c.text }} />

        {isAwaitingApproval(tk, assigneesByTask) && (
          <div style={{ background: c.amberBg, border: '1px solid #fde68a', borderRadius: radius.sm, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 12, color: '#a16207', fontWeight: 600 }}>⏳ {t('此任務全員已結算')}{canValidate ? t('，待你核驗') : t('，等待發布人核驗')}</div>
            {canValidate && <button onClick={approve} style={{ background: c.amber, color: '#fff', border: 'none', borderRadius: radius.sm, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✓ {t('核驗通過')}</button>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: c.textMuted }}>{t('截止')}</span>
          <input type="date" value={tk.due_date || ''} onFocus={ro ? roBlur : undefined} onChange={e => setTk({ ...tk, due_date: e.target.value || null })} onBlur={() => updateField({ due_date: tk.due_date || null })} style={{ padding: '4px 8px', borderRadius: radius.sm, border: `1px solid ${c.border}`, fontSize: 12 }} />
          <span style={{ fontSize: 11, color: c.textMuted, marginLeft: 6 }}>{t('發佈範圍')}</span>
          {(() => {
            const allCoDepts = (departments || []).filter(d => d.company_id === (tk.company_id || scopeCompanyId))
            // 普通員工只能選自己加入的部門；admin / super admin / 任務當前所在部門（保留以便看到當前值）不限
            const myDeptIds = new Set((empDepts || []).filter(ed => ed.employee_id === me.id).map(ed => ed.department_id))
            const coDepts = (ctx?.isSuperAdmin || ctx?.isAdminOfActive)
              ? allCoDepts
              : allCoDepts.filter(d => myDeptIds.has(d.id) || d.id === tk.department_id)
            if (ro) {
              const cur = (departments || []).find(d => d.id === tk.department_id)
              return cur
                ? <span style={{ background: '#f3e8ff', color: '#7c3aed', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{cur.name} {t('部門')}</span>
                : <span style={{ color: c.textFaint, fontSize: 11 }}>{t('公司內可見')}</span>
            }
            const onDeptChange = async (newDeptId) => {
              // 切到部門時：把不在新部門的 assignees 提示後一起清掉，避免「鬼任務」（看不見但還在 assignee 列）
              if (newDeptId) {
                const memberSet = new Set((empDepts || []).filter(ed => ed.department_id === newDeptId).map(ed => ed.employee_id))
                const ghosts = tkList.filter(a => !memberSet.has(a.employee_id))
                if (ghosts.length > 0) {
                  const names = ghosts.map(a => (employees.find(e => e.id === a.employee_id) || {}).name || '?').join(', ')
                  if (!confirm(t('以下 assignee 不在新部門，切換後他們將失去任務訪問：') + names + '\n' + t('繼續？'))) return
                  // 把不在 dept 的 assignee 從 task_assignees 移除（一致性）
                  const ghostIds = ghosts.map(g => g.employee_id)
                  await supabase.from('task_assignees').delete().eq('task_id', tk.id).in('employee_id', ghostIds)
                  // 如果主 assignee 被清掉，把剩下第一個提上來
                  const remaining = tkList.filter(a => memberSet.has(a.employee_id))
                  if (remaining.length > 0 && ghostIds.includes(tk.employee_id)) {
                    await supabase.from('employee_tasks').update({ employee_id: remaining[0].employee_id }).eq('id', tk.id)
                  }
                  queryClient.invalidateQueries({ queryKey: ['admin', 'task_assignees'] })
                  queryClient.invalidateQueries({ queryKey: ['admin', 'employee_tasks'] })
                }
              }
              await updateField({ department_id: newDeptId || null })
            }
            return (
              <select value={tk.department_id || ''} onChange={e => onDeptChange(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: radius.sm, border: `1px solid ${c.border}`, fontSize: 12, background: c.card }}>
                <option value="">{t('公司內可見')}</option>
                {coDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )
          })()}
        </div>

        <AssigneeEditor tk={tk} tkList={tkList} employees={employees} empCompanies={empCompanies} canManage={canEdit && canAssignOthers} setAssignees={setAssignees} scopeCompanyId={scopeCompanyId} onForbidden={roAlert} />

        {canEdit ? (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 12, color: c.textMuted, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!tk.needs_approval} onChange={e => updateField({ needs_approval: e.target.checked })} />{t('完成後需發布人核驗')}
          </label>
        ) : tk.needs_approval ? (
          <div style={{ marginTop: 8, fontSize: 12, color: '#a16207' }}>⏳ {t('完成後需發布人核驗')}</div>
        ) : null}

        <div style={{ fontSize: 11, color: c.textMuted, marginTop: 14, marginBottom: 4 }}>{t('描述 / 備註')}</div>
        <textarea value={tk.note || ''} onFocus={ro ? roBlur : undefined} onChange={e => setTk({ ...tk, note: e.target.value })} onBlur={() => updateField({ note: tk.note || null })} style={{ ...S.input, minHeight: 60, resize: 'vertical' }} />

        <AttachmentList tk={tk} ro={ro} onUpdate={updateField} onForbidden={roAlert} />

        <SubtaskList tk={tk} subtasks={subtasks} employees={employees} empCompanies={empCompanies} feedbacks={feedbacks} assigneesByTask={assigneesByTask} me={me} canEdit={canEdit} scopeCompanyId={scopeCompanyId} ctx={ctx} onForbidden={roAlert} />

        <FeedbackThread tk={tk} fbList={fbList} employees={employees} empCompanies={empCompanies} me={me} userId={userId} scopeCompanyId={scopeCompanyId} ctx={ctx} />

        <div style={{ fontSize: 10, color: c.textFaint, marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>{t('添加於')} {fmtDateTime(tk.created_at)}</span>
          {tk.status === 'done' && tk.completed_at && <span style={{ color: c.green }}>✓ {t('完成於')} {fmtDateTime(tk.completed_at)}</span>}
          {tk.status === 'abandoned' && tk.completed_at && <span>✗ {t('放棄於')} {fmtDateTime(tk.completed_at)}</span>}
          {tk.title_edited_at && (
            <span>{t('標題由 {name} 編輯於 {time}', { name: (employees.find(e => e.id === tk.title_edited_by) || {}).name || '?', time: fmtDateTime(tk.title_edited_at) })}</span>
          )}
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

function AssigneeEditor({ tk, tkList, employees, empCompanies = [], canManage, setAssignees, scopeCompanyId, onForbidden = () => {} }) {
  const { t } = useT()
  const cur = tkList.map(a => a.employee_id)
  const empIdsInScope = useMemo(
    () => empIdsInCompany(empCompanies, scopeCompanyId),
    [empCompanies, scopeCompanyId]
  )
  const sameCo = (e) => scopeCompanyId ? empIdsInScope.has(e.id) : true
  const cands = employees.filter(e => e.active !== false && sameCo(e) && !cur.includes(e.id))
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 11, color: c.textMuted }}>{t('分配給')} · {cur.length}</span>
        {tk.creator_employee_id && (() => {
          const cr = employees.find(e => e.id === tk.creator_employee_id)
          return cr ? <span style={{ fontSize: 11, color: c.textMuted, marginLeft: 'auto' }}>{t('發布人:')} <span style={{ color: c.accent, fontWeight: 600 }}>{cr.name}</span></span> : null
        })()}
      </div>
      <AssigneeChipEditor value={cur} onChange={setAssignees} candidates={cands} employees={employees} readOnly={!canManage} onForbidden={onForbidden} placeholder={t('@ 加成員')} />
    </div>
  )
}

function AttachmentList({ tk, ro, onUpdate, onForbidden = () => {} }) {
  const { t } = useT()
  const fileRef = useRef(null)
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
              <button onClick={async () => {
                if (ro) return onForbidden()
                if (!confirm(t('確定移除？'))) return
                const rest = tk.attachments.filter((_, j) => j !== i)
                await onUpdate({ attachments: rest.length > 0 ? rest : null })
              }} style={{ background: 'none', border: 'none', color: c.textFaint, cursor: 'pointer', fontSize: 13 }}>×</button>
            </div>
          )
        })}
        <button type="button" onClick={() => { if (ro) return onForbidden(); fileRef.current?.click() }} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 10px', background: c.bg, border: `1px dashed ${c.border}`, borderRadius: radius.sm, fontSize: 10, color: c.accent, cursor: 'pointer' }}>＋ {t('添加')}</button>
        <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={async e => {
          const fs = Array.from(e.target.files || [])
          e.target.value = ''
          if (fs.length === 0) return
          try {
            const newOnes = await Promise.all(fs.map(f => uploadAttachment(f, tk.id)))
            const merged = [...(Array.isArray(tk.attachments) ? tk.attachments : []), ...newOnes]
            await onUpdate({ attachments: merged })
          } catch (err) { alert(t('上傳失敗：') + err.message) }
        }} />
      </div>
    </div>
  )
}

function SubtaskList({ tk, subtasks, employees, empCompanies = [], feedbacks, assigneesByTask, me, canEdit, scopeCompanyId, ctx, onForbidden = () => {} }) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const [subTitle, setSubTitle] = useState('')
  const [subAssignees, setSubAssignees] = useState(null)

  const parentAssignees = (assigneesByTask.get(tk.id) || []).map(a => a.employee_id)
  const effectiveSub = subAssignees === null ? parentAssignees : subAssignees
  const empIdsInScope = useMemo(
    () => empIdsInCompany(empCompanies, scopeCompanyId),
    [empCompanies, scopeCompanyId]
  )
  const sameCo = (e) => scopeCompanyId ? empIdsInScope.has(e.id) : true
  const subCands = employees.filter(e => e.active !== false && sameCo(e) && !effectiveSub.includes(e.id))

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
        const canTick = ctx?.isSuperAdmin || ctx?.isAdminOfActive || tk.creator_employee_id === me.id || stIsMine || ctx?.hasPermission?.('can_validate_task')
        const stAssignees = (assigneesByTask.get(st.id) || []).map(a => employees.find(e => e.id === a.employee_id)).filter(Boolean)
        return (
          <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: `1px solid ${c.border}` }}>
            <input type="checkbox" checked={st.status === 'done' || empDoneFor(st, me.id, assigneesByTask)} disabled={!canTick} onChange={() => canTick && toggleSubDone(st)} style={{ width: 14, height: 14, cursor: canTick ? 'pointer' : 'not-allowed' }} />
            <span style={{ flex: 1, fontSize: 12, color: st.status === 'done' ? c.textMuted : c.text, textDecoration: st.status === 'done' ? 'line-through' : 'none' }}>{st.title}</span>
            <span style={{ display: 'inline-flex', gap: 3, flexWrap: 'wrap' }}>
              {stAssignees.length === 0
                ? <span style={{ fontSize: 9, color: c.red, fontWeight: 600 }}>{t('未分配')}</span>
                : stAssignees.map(e2 => (
                    <span key={e2.id} style={{ padding: '1px 6px', background: c.accentBg, color: c.accent, borderRadius: 9, fontSize: 9, fontWeight: 600 }}>@{e2.name}</span>
                  ))}
            </span>
            {fbCount > 0 && <span style={{ fontSize: 10, color: c.amber }}>💬 {fbCount}</span>}
            <button onClick={canEdit ? (() => deleteSub(st)) : onForbidden} style={{ background: 'none', border: 'none', color: c.textFaint, cursor: 'pointer', fontSize: 13 }}>×</button>
          </div>
        )
      })}
      <div style={{ marginTop: 8, padding: '8px 10px', border: `1px dashed ${c.border}`, borderRadius: radius.sm, background: c.bg }}>
        <div style={{ fontSize: 10, color: c.textMuted, marginBottom: 3 }}>{t('分配給')}</div>
        <div style={{ marginBottom: 5 }}>
          <AssigneeChipEditor value={effectiveSub} onChange={setSubAssignees} candidates={subCands} employees={employees} readOnly={!canEdit} onForbidden={onForbidden} size="sm" placeholder={t('@ 加')} />
        </div>
        <form onSubmit={e => { e.preventDefault(); if (!canEdit) return onForbidden(); addSub() }}>
          <input value={subTitle} onChange={canEdit ? (e => setSubTitle(e.target.value)) : undefined} onFocus={canEdit ? undefined : (e => { e.target.blur(); onForbidden() })} placeholder={t('＋ 子任務（Enter 確認）')} style={{ width: '100%', padding: '6px 8px', borderRadius: radius.sm, border: `1px solid ${c.border}`, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
        </form>
      </div>
    </div>
  )
}

function FeedbackThread({ tk, fbList, employees, empCompanies = [], me, userId, scopeCompanyId, ctx }) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState([])
  const [replying, setReplying] = useState(null)
  const [mentionPop, setMentionPop] = useState({ open: false, query: '', atIdx: -1 })
  const [files, setFiles] = useState([])
  const [previews, setPreviews] = useState([])  // 與 files 同序，圖片有 object URL，非圖片為 null
  const [editingFb, setEditingFb] = useState(null)  // { id, body } — 正在編輯的反饋本地草稿
  useEffect(() => {
    const next = files.map(f => (f.type || '').startsWith('image/') ? URL.createObjectURL(f) : null)
    setPreviews(next)
    return () => { next.forEach(u => { if (u) URL.revokeObjectURL(u) }) }
  }, [files])
  const saveEdit = async () => {
    if (!editingFb || !editingFb.body.trim()) return
    const { error } = await supabase.from('employee_task_feedbacks').update({ body: editingFb.body.trim(), updated_at: new Date().toISOString() }).eq('id', editingFb.id)
    if (error) return alert(error.message)
    setEditingFb(null)
    queryClient.invalidateQueries({ queryKey: ['admin', 'feedbacks'] })
  }

  const empIdsInScope = useMemo(
    () => empIdsInCompany(empCompanies, scopeCompanyId),
    [empCompanies, scopeCompanyId]
  )
  const sameCo = (e) => scopeCompanyId ? empIdsInScope.has(e.id) : true
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

  const handlePaste = (e) => {
    const items = e.clipboardData?.items
    if (!items || items.length === 0) return
    const imgs = []
    for (const item of items) {
      if (item.kind === 'file' && (item.type || '').startsWith('image/')) {
        const blob = item.getAsFile()
        if (!blob) continue
        const mime = blob.type || 'image/png'
        const ext = (mime.split('/')[1] || 'png').split(';')[0].split('+')[0]
        const renamed = new File([blob], `pasted-${Date.now()}-${imgs.length}.${ext}`, { type: mime })
        imgs.push(renamed)
      }
    }
    if (imgs.length === 0) return
    e.preventDefault()
    setFiles(prev => [...prev, ...imgs])
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
    // 回復別人的反饋 → 自動 @ 原作者（除非自己回自己），讓原作者收到 bizflow 主端的反饋 toast
    const finalMentions = [...mentions]
    if (replying) {
      const parent = fbList.find(f => f.id === replying)
      if (parent && parent.author_user_id && parent.author_user_id !== userId && !finalMentions.includes(parent.author_user_id)) {
        finalMentions.push(parent.author_user_id)
      }
    }
    const { error } = await supabase.from('employee_task_feedbacks').insert({
      task_id: tk.id, author_user_id: userId, author_name: me.name, body: body.trim() || null,
      parent_feedback_id: replying, mentioned_user_ids: finalMentions.length > 0 ? finalMentions : null, attachments,
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
          const canDel = isOwn || ctx?.isSuperAdmin || ctx?.isAdminOfActive
          const isReply = !!fb.parent_feedback_id
          const parent = isReply ? fbList.find(p => p.id === fb.parent_feedback_id) : null
          return (
            <div key={fb.id} style={{ background: c.card, border: '1px solid #fde68a', borderRadius: radius.sm, padding: '6px 9px', marginBottom: 5, marginLeft: isReply ? 18 : 0 }}>
              {isReply && <div style={{ fontSize: 9, color: '#b88a00', marginBottom: 2, fontStyle: 'italic' }}>↪ {t('回覆')} <b>{parent?.author_name || '?'}</b>: {(parent?.body || '').slice(0, 28)}...</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#a16207' }}>{fb.author_name || '?'}<span style={{ fontWeight: 400, marginLeft: 5, color: c.textFaint }}>{fmtDateTime(fb.created_at)}{fb.updated_at && new Date(fb.updated_at) - new Date(fb.created_at) > 2000 ? ` (${t('已編輯')})` : ''}</span></span>
                <div style={{ display: 'flex', gap: 5 }}>
                  {editingFb?.id !== fb.id && <button onClick={() => setReplying(fb.id)} style={{ background: 'none', border: 'none', color: '#b88a00', cursor: 'pointer', fontSize: 10 }}>↩ {t('回覆')}</button>}
                  {isOwn && editingFb?.id !== fb.id && <button onClick={() => setEditingFb({ id: fb.id, body: fb.body || '' })} style={{ background: 'none', border: 'none', color: '#b88a00', cursor: 'pointer', fontSize: 10 }}>✎ {t('編輯')}</button>}
                  {canDel && editingFb?.id !== fb.id && <button onClick={() => delFb(fb.id)} style={{ background: 'none', border: 'none', color: c.textFaint, cursor: 'pointer', fontSize: 12 }}>×</button>}
                </div>
              </div>
              {editingFb?.id === fb.id ? (
                <div>
                  <textarea value={editingFb.body} onChange={e => setEditingFb({ ...editingFb, body: e.target.value })} onKeyDown={e => { if (e.key === 'Escape') setEditingFb(null); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit() } }} rows={2} autoFocus style={{ width: '100%', padding: '6px 8px', borderRadius: radius.sm, border: '1px solid #fde68a', fontSize: 12, outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, justifyContent: 'flex-end' }}>
                    <button onClick={() => setEditingFb(null)} style={{ background: 'none', border: `1px solid ${c.border}`, color: c.textMuted, borderRadius: radius.sm, padding: '3px 10px', fontSize: 10, cursor: 'pointer' }}>{t('取消')}</button>
                    <button onClick={saveEdit} disabled={!editingFb.body.trim()} style={{ background: c.amber, color: '#fff', border: 'none', borderRadius: radius.sm, padding: '3px 10px', fontSize: 10, fontWeight: 700, cursor: editingFb.body.trim() ? 'pointer' : 'not-allowed', opacity: editingFb.body.trim() ? 1 : 0.4 }}>{t('保存')}</button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: c.text, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{fb.body}</div>
              )}
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
        <textarea value={body} onChange={handleChange} onPaste={handlePaste} onKeyDown={e => { if (e.key === 'Escape') setMentionPop({ open: false, query: '', atIdx: -1 }); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} rows={2} placeholder={t('追加反饋… @ 提醒；可粘貼圖片；Cmd+Enter 發送')} style={{ flex: 1, padding: '7px 9px', borderRadius: radius.sm, border: '1px solid #fde68a', fontSize: 11, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
          {files.map((f, i) => {
            const url = previews[i]
            const remove = () => setFiles(prev => prev.filter((_, j) => j !== i))
            if (url) {
              return (
                <span key={i} style={{ position: 'relative', display: 'inline-block', borderRadius: 4, border: '1px solid #fde68a', background: '#fff4d6', padding: 2 }}>
                  <img src={url} alt={f.name} style={{ display: 'block', maxWidth: 70, maxHeight: 50, borderRadius: 3 }} />
                  <button type="button" onClick={remove} title={t('移除')} style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: '50%', background: '#a16207', color: '#fff', border: '1px solid #fff', cursor: 'pointer', fontSize: 10, lineHeight: 1, padding: 0 }}>×</button>
                </span>
              )
            }
            return (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 6px', background: '#fff4d6', borderRadius: radius.sm, fontSize: 10, color: '#a16207', border: '1px solid #fde68a' }}>📎 {f.name}<button type="button" onClick={remove} style={{ background: 'none', border: 'none', color: '#a16207', cursor: 'pointer', fontSize: 11 }}>×</button></span>
            )
          })}
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
