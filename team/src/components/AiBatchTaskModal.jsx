import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabaseClient.js'
import { c, radius, S, Pill } from '../styles.jsx'
import { useT } from '../i18n.jsx'
import AssigneeChipEditor from './AssigneeChipEditor.jsx'

const PRIORITIES = ['high', 'mid', 'low']

function cleanPriority(value) {
  return PRIORITIES.includes(value) ? value : 'low'
}

function cleanDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : ''
}

function normalizeDepartmentName(value) {
  return String(value || '').trim().toLowerCase()
}

function useIsNarrow() {
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 760)
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 760)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isNarrow
}

export default function AiBatchTaskModal({
  onClose,
  onCreated,
  me,
  companyId,
  departments = [],
  empDepts = [],
  employees = [],
  defaultAssigneeIds = [],
  canAssignOthers = true,
}) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const isNarrow = useIsNarrow()
  const [stage, setStage] = useState('input')
  const [text, setText] = useState('')
  const [parseBusy, setParseBusy] = useState(false)
  const [error, setError] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [cards, setCards] = useState([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [expandedId, setExpandedId] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)
  const touchStartX = useRef(null)

  const deptByName = useMemo(() => {
    const map = new Map()
    for (const d of departments) map.set(normalizeDepartmentName(d.name), d.id)
    return map
  }, [departments])
  const deptMembersById = useMemo(() => {
    const map = new Map()
    for (const row of empDepts) {
      const set = map.get(row.department_id) || new Set()
      set.add(row.employee_id)
      map.set(row.department_id, set)
    }
    return map
  }, [empDepts])

  const activeCard = cards[activeIndex] || null
  const confirmDisabled = createBusy || cards.length === 0 || cards.some(card => !card.title.trim() || (card.assigneeIds || []).length === 0)

  const updateCard = (id, patch) => {
    setCards(prev => prev.map(card => card.id === id ? { ...card, ...patch } : card))
  }

  const employeesForCard = (card) => {
    const memberSet = card?.department_id ? deptMembersById.get(card.department_id) : null
    return memberSet ? employees.filter(e => memberSet.has(e.id)) : employees
  }

  const updateCardDepartment = (card, departmentId) => {
    const memberSet = departmentId ? deptMembersById.get(departmentId) : null
    const allowed = memberSet ? new Set([...memberSet]) : null
    const nextAssigneeIds = allowed ? (card.assigneeIds || []).filter(id => allowed.has(id)) : (card.assigneeIds || [])
    updateCard(card.id, { department_id: departmentId, assigneeIds: nextAssigneeIds })
  }

  const parseTasks = async () => {
    if (!text.trim()) {
      setError(t('請先輸入任務文案'))
      return
    }
    setError('')
    setParseBusy(true)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      if (!token) throw new Error(t('需要登入後才能使用 AI 整理'))
      const res = await fetch('/api/parse-tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: text.trim() }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || payload?.message || `${res.status}`)
      const parsed = Array.isArray(payload?.tasks) ? payload.tasks : []
      if (parsed.length === 0) throw new Error(t('未解析到任務，請補充更多內容'))
      const next = parsed.map((task, idx) => {
        const deptId = deptByName.get(normalizeDepartmentName(task.department_name)) || ''
        return {
          id: `ai-${Date.now()}-${idx}`,
          title: String(task.title || '').trim(),
          description: String(task.description || '').trim(),
          department_id: deptId,
          due_date: cleanDate(task.due_date),
          priority: cleanPriority(task.priority),
          assigneeIds: defaultAssigneeIds.length > 0 ? [...defaultAssigneeIds] : [],
        }
      }).filter(task => task.title)
      if (next.length === 0) throw new Error(t('未解析到任務，請補充更多內容'))
      setCards(next)
      setActiveIndex(0)
      setExpandedId(next[0]?.id || null)
      setStage('preview')
    } catch (e) {
      setError(t('AI 整理失敗：') + (e.message || String(e)))
    } finally {
      setParseBusy(false)
    }
  }

  const moveActive = (delta) => {
    if (cards.length === 0) return
    setActiveIndex(prev => {
      const next = Math.max(0, Math.min(cards.length - 1, prev + delta))
      setExpandedId(cards[next]?.id || null)
      return next
    })
  }

  const handleTouchEnd = (e) => {
    if (touchStartX.current == null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(dx) < 45) return
    moveActive(dx < 0 ? 1 : -1)
  }

  const requestClose = () => {
    if (cards.length > 0 && !window.confirm(t('關閉會丟失整理結果，確認嗎？'))) return
    onClose()
  }

  const handleCardClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    moveActive(x < rect.width / 2 ? -1 : 1)
  }

  const submit = async () => {
    if (confirmDisabled) return
    if (!companyId) {
      alert(t('未選定公司，請先在右上角切換公司再新增任務'))
      return
    }
    const clean = cards.map(card => ({
      title: card.title.trim(),
      description: card.description.trim(),
      department_id: card.department_id || null,
      due_date: card.due_date || null,
      priority: cleanPriority(card.priority),
      assigneeIds: card.assigneeIds || [],
    })).filter(card => card.title && card.assigneeIds.length > 0)
    if (clean.length === 0) {
      alert(t('請為每張卡指定至少一位負責人'))
      return
    }
    setCreateBusy(true)
    try {
      const taskRows = clean.map(card => ({
        employee_id: card.assigneeIds[0],
        creator_employee_id: me.id,
        needs_approval: false,
        title: card.title,
        priority: card.priority,
        note: card.description || null,
        due_date: card.due_date || null,
        company_id: companyId,
        department_id: card.department_id || null,
      }))
      const { data: inserted, error } = await supabase.from('employee_tasks').insert(taskRows).select('id')
      if (error) throw error
      if (!Array.isArray(inserted) || inserted.length !== clean.length) {
        throw new Error(t('任務建立數量不一致，請刷新後檢查'))
      }
      const assigneeRows = []
      inserted.forEach((row, idx) => {
        for (const eid of clean[idx].assigneeIds) assigneeRows.push({ task_id: row.id, employee_id: eid })
      })
      const { error: ae } = await supabase.from('task_assignees').insert(assigneeRows)
      if (ae) throw ae
      queryClient.invalidateQueries({ queryKey: ['admin', 'employee_tasks'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'task_assignees'] })
      alert(t('已建立 {count} 個任務', { count: clean.length }))
      onCreated?.(clean)
      onClose()
    } catch (e) {
      alert(t('建立批量任務失敗：') + (e.message || String(e)))
    } finally {
      setCreateBusy(false)
    }
  }

  const stack = (
    <div
      onTouchStart={e => { touchStartX.current = e.touches[0].clientX }}
      onTouchEnd={handleTouchEnd}
      style={{ position: 'relative', isolation: 'isolate', minHeight: isNarrow ? 230 : 360, height: isNarrow ? undefined : '100%', marginTop: isNarrow ? 6 : 0 }}
    >
      {cards.map((card, idx) => {
        const offset = idx - activeIndex
        const distance = Math.abs(offset)
        const isActive = idx === activeIndex
        const isHovered = hoveredId === card.id
        const hidden = distance > 3
        return (
          <button
            key={card.id}
            type="button"
            onMouseEnter={() => setHoveredId(card.id)}
            onMouseLeave={() => setHoveredId(prev => prev === card.id ? null : prev)}
            onClick={handleCardClick}
            style={{
              position: 'absolute',
              inset: isNarrow ? '0 10px auto' : '8px 18px auto',
              minHeight: isNarrow ? 190 : 250,
              height: isNarrow ? undefined : 'calc(100% - 60px)',
              transform: isNarrow
                ? `translateX(${offset * 14}px) translateY(${distance * 8 - (isHovered ? 4 : 0)}px) rotate(${offset * 1.5}deg)`
                : `translateX(${offset * 6}px) translateY(${distance * 6 - (isHovered ? 4 : 0)}px) rotate(${offset * 0.8}deg)`,
              opacity: hidden ? 0 : 1 - distance * 0.18,
              zIndex: 20 - distance,
              pointerEvents: hidden ? 'none' : 'auto',
              transition: 'transform 180ms ease, opacity 180ms ease, box-shadow 180ms ease',
              width: 'calc(100% - 36px)',
              textAlign: 'left',
              background: c.card,
              border: `1px solid ${isActive ? c.accent : c.border}`,
              borderRadius: radius.lg,
              padding: 16,
              cursor: 'pointer',
              boxShadow: isActive
                ? (isHovered ? '0 22px 52px rgba(37,99,235,0.2)' : '0 18px 45px rgba(37,99,235,0.16)')
                : (isHovered ? '0 14px 34px rgba(0,0,0,0.13)' : '0 8px 22px rgba(0,0,0,0.08)'),
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Pill tone={card.priority === 'high' ? 'red' : card.priority === 'mid' ? 'amber' : 'green'}>
                {card.priority === 'high' ? t('高') : card.priority === 'mid' ? t('中') : t('低')}
              </Pill>
              <span style={{ fontSize: 11, color: c.textFaint }}>{t('任務 {index} / {total}', { index: idx + 1, total: cards.length })}</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.35, color: c.text, marginBottom: 10 }}>{card.title || t('未命名任務')}</div>
            <div style={{ fontSize: 12, color: c.textMuted, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: expandedId === card.id ? 6 : 3, WebkitBoxOrient: 'vertical' }}>
              {card.description || t('沒有描述')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, fontSize: 11, color: c.textMuted }}>
              <span>{departments.find(d => d.id === card.department_id)?.name || t('公司內可見')}</span>
              <span>{card.due_date || t('未排期')}</span>
              <span>{(card.assigneeIds || []).length} {t('負責人')}</span>
            </div>
          </button>
        )
      })}
    </div>
  )

  const editor = activeCard ? (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: radius.lg, padding: 14 }}>
      <div style={{ fontSize: 12, color: c.textMuted, fontWeight: 700, marginBottom: 10 }}>{t('編輯抽出的卡片')}</div>
      <FieldLabel label={t('標題')}>
        <input value={activeCard.title} onChange={e => updateCard(activeCard.id, { title: e.target.value })} style={S.input} />
      </FieldLabel>
      <FieldLabel label={t('描述')}>
        <textarea value={activeCard.description} onChange={e => updateCard(activeCard.id, { description: e.target.value })} style={{ ...S.input, minHeight: 86, resize: 'vertical' }} />
      </FieldLabel>
      <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 1fr', gap: 8 }}>
        <FieldLabel label={t('優先級')}>
          <select value={activeCard.priority} onChange={e => updateCard(activeCard.id, { priority: cleanPriority(e.target.value) })} style={S.input}>
            <option value="high">{t('高')}</option>
            <option value="mid">{t('中')}</option>
            <option value="low">{t('低')}</option>
          </select>
        </FieldLabel>
        <FieldLabel label={t('截止日期')}>
          <input type="date" value={activeCard.due_date} onChange={e => updateCard(activeCard.id, { due_date: e.target.value })} style={S.input} />
        </FieldLabel>
      </div>
      {departments.length > 0 && (
        <FieldLabel label={t('部門')}>
          <select value={activeCard.department_id} onChange={e => updateCardDepartment(activeCard, e.target.value)} style={S.input}>
            <option value="">{t('不指定部門')}</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </FieldLabel>
      )}
      {(() => {
        const cardEmployees = employeesForCard(activeCard)
        return (
      <FieldLabel label={t('負責人')}>
        <AssigneeChipEditor
          value={activeCard.assigneeIds || []}
          onChange={next => updateCard(activeCard.id, { assigneeIds: next })}
          candidates={cardEmployees.filter(e => !(activeCard.assigneeIds || []).includes(e.id))}
          employees={cardEmployees}
          readOnly={!canAssignOthers}
          placeholder={t('@ 加成員')}
        />
      </FieldLabel>
        )
      })()}
    </div>
  ) : null

  return (
    <div style={S.modal}>
      <div style={{ ...S.modalCard(980), padding: 0, overflowY: 'auto' }}>
        <div style={{ padding: '18px 20px', borderBottom: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{t('AI 整理發布任務')}</div>
            <div style={{ fontSize: 12, color: c.textMuted, marginTop: 4 }}>{t('AI 只整理內容，不會自動指定負責人。請在預覽卡片手動 @ 成員。')}</div>
          </div>
          <button type="button" onClick={requestClose} style={{ ...S.iconBtn, fontSize: 20 }} title={t('取消')}>×</button>
        </div>

        {stage === 'input' ? (
          <div style={{ padding: 20 }}>
            <div style={{ fontSize: 12, color: c.textMuted, fontWeight: 700, marginBottom: 8 }}>{t('任務文案')}</div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              autoFocus
              placeholder={t('貼上要整理的任務文案')}
              style={{ ...S.input, minHeight: 240, resize: 'vertical', lineHeight: 1.6 }}
            />
            {error && <div style={{ color: c.red, background: c.redBg, border: `1px solid #fecaca`, borderRadius: radius.sm, padding: 9, fontSize: 12, marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={requestClose} style={S.btnGhost}>{t('取消')}</button>
              <button type="button" onClick={parseTasks} disabled={parseBusy || !text.trim()} style={{ ...S.btnPrimary, opacity: parseBusy || !text.trim() ? 0.45 : 1 }}>
                {parseBusy ? t('整理中…') : t('AI 整理')}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{t('抽卡預覽')}</div>
                <div style={{ fontSize: 12, color: c.textMuted, marginTop: 3 }}>{t('點擊卡片左半切上一張，右半切下一張；手機可左右滑動切換')}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => moveActive(-1)} disabled={activeIndex === 0} style={{ ...S.btnGhostSm, opacity: activeIndex === 0 ? 0.4 : 1 }}>{t('上一張')}</button>
                <button type="button" onClick={() => moveActive(1)} disabled={activeIndex >= cards.length - 1} style={{ ...S.btnGhostSm, opacity: activeIndex >= cards.length - 1 ? 0.4 : 1 }}>{t('下一張')}</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : 'minmax(310px, 0.9fr) minmax(360px, 1.1fr)', gap: 18, alignItems: isNarrow ? 'start' : 'stretch' }}>
              {stack}
              {editor}
            </div>
            {cards.some(card => (card.assigneeIds || []).length === 0) && (
              <div style={{ marginTop: 12, color: c.amber, background: c.amberBg, border: `1px solid #fde68a`, borderRadius: radius.sm, padding: 9, fontSize: 12 }}>{t('請為每張卡指定至少一位負責人')}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setStage('input')} style={S.btnGhost}>{t('返回修改文案')}</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={requestClose} style={S.btnGhost}>{t('取消')}</button>
                <button type="button" onClick={submit} disabled={confirmDisabled} style={{ ...S.btnPrimary, opacity: confirmDisabled ? 0.45 : 1 }}>
                  {createBusy ? t('正在建立…') : t('確認建立')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FieldLabel({ label, children }) {
  return (
    <label style={{ display: 'block', fontSize: 11, color: c.textMuted, fontWeight: 700, marginBottom: 6 }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  )
}
