import React, { useState, useMemo } from 'react'
import { c, radius, S } from '../styles.jsx'
import { useT } from '../i18n.jsx'
import { isTaskAssignedTo, empDoneFor, empAbandonedFor } from '../lib/taskHelpers.js'

// 月曆視圖：6 行 x 7 列，任務按 start_date → due_date 渲染為跨天橫條
// props: tasks (已過濾)、employees、assigneesByTask、me、setEditingTask

const MS_PER_DAY = 86400000

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function ymd(d) {
  const x = startOfDay(d)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseYmd(s) {
  if (!s) return null
  const [y, m, d] = String(s).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

// 周一為起點：JS getDay 周日=0，轉換為 0=周一..6=周日
function weekdayMonFirst(d) {
  const wd = d.getDay()
  return wd === 0 ? 6 : wd - 1
}

// 生成從 anchorDate 所在月份的「日曆網格」：6 週 x 7 天 = 42 個日期
function buildGrid(anchorDate) {
  const year = anchorDate.getFullYear()
  const month = anchorDate.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  const offset = weekdayMonFirst(firstOfMonth)  // 月首前面要補幾天上月
  const gridStart = new Date(year, month, 1 - offset)
  const cells = []
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(year, month, 1 - offset + i))
  }
  return { year, month, gridStart, gridEnd: cells[41], cells }
}

// 計算任務的開始/結束日（純 date 字串範圍，含端點）
function getTaskRange(task) {
  const sd = task.start_date ? parseYmd(task.start_date) : null
  const dd = task.due_date ? parseYmd(task.due_date) : null
  if (!sd && !dd) return null
  const start = sd || dd
  const end = dd || sd
  if (start.getTime() > end.getTime()) return { start: end, end: start }  // 防呆
  return { start, end }
}

// 任務在某一週的可見區間（與週交集），返回該週內列索引 [colStart, colEnd]，無交集返回 null
function intersectWeek(taskRange, weekStart) {
  const weekEnd = new Date(weekStart.getTime() + 6 * MS_PER_DAY)
  if (taskRange.end.getTime() < weekStart.getTime()) return null
  if (taskRange.start.getTime() > weekEnd.getTime()) return null
  const visStart = taskRange.start.getTime() < weekStart.getTime() ? weekStart : taskRange.start
  const visEnd = taskRange.end.getTime() > weekEnd.getTime() ? weekEnd : taskRange.end
  const colStart = Math.round((visStart.getTime() - weekStart.getTime()) / MS_PER_DAY)
  const colEnd = Math.round((visEnd.getTime() - weekStart.getTime()) / MS_PER_DAY)
  return { colStart, colEnd, leftOpen: taskRange.start.getTime() < weekStart.getTime(), rightOpen: taskRange.end.getTime() > weekEnd.getTime() }
}

// 貪心 lane 分配：把該週任務按 colStart 排序後分行，每行任務不重疊
function layoutLanes(items) {
  const sorted = [...items].sort((a, b) => a.colStart - b.colStart || a.colEnd - b.colEnd)
  const lanes = []  // lanes[i] = 該行最後一個任務的 colEnd
  const placed = []
  for (const it of sorted) {
    let lane = -1
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] < it.colStart) { lane = i; break }
    }
    if (lane === -1) { lane = lanes.length; lanes.push(it.colEnd) }
    else lanes[lane] = it.colEnd
    placed.push({ ...it, lane })
  }
  return placed
}

function pillTone(task, isDone, isAb) {
  if (isAb) return { bg: '#f1f5f9', fg: c.textFaint, border: '#cbd5e1' }
  if (isDone) return { bg: '#f1f5f9', fg: c.textMuted, border: '#cbd5e1' }
  if (task.priority === 'high') return { bg: c.redBg, fg: c.red, border: '#fecaca' }
  if (task.priority === 'mid') return { bg: c.amberBg, fg: c.amber, border: '#fde68a' }
  return { bg: c.accentBg, fg: c.accent, border: '#bfdbfe' }
}

const MONTH_LABEL = {
  zh: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'],
}

function formatMonthLabel(lang, year, monthIdx) {
  const m = (MONTH_LABEL[lang] || MONTH_LABEL.zh)[monthIdx]
  if (lang === 'zh') return `${year}年 ${m}`
  return `${m} ${year}`
}

export default function CalendarView({ tasks, employees, assigneesByTask, me, setEditingTask }) {
  const { t, lang } = useT()
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [expanded, setExpanded] = useState(null)  // ymd 字符串：當週日期被展開看全部任務
  const grid = useMemo(() => buildGrid(anchor), [anchor])
  const todayYmd = ymd(new Date())

  // 把任務按週分組 + lane 佈局
  const weeks = useMemo(() => {
    const rows = []
    for (let w = 0; w < 6; w++) {
      const weekStart = startOfDay(grid.cells[w * 7])
      const items = []
      for (const task of tasks) {
        if (task.parent_task_id) continue  // 子任務暫不入日曆
        const range = getTaskRange(task)
        if (!range) continue
        const seg = intersectWeek(range, weekStart)
        if (!seg) continue
        items.push({ task, ...seg })
      }
      rows.push({ weekStart, days: grid.cells.slice(w * 7, w * 7 + 7), items: layoutLanes(items) })
    }
    return rows
  }, [grid, tasks])

  // 「未排期」抽屜：沒填 start/due 的進行中任務（已完成 / 已放棄不顯示，避免堆積垃圾）
  const unscheduled = useMemo(() => tasks.filter(tk => {
    if (tk.parent_task_id || tk.start_date || tk.due_date) return false
    const myRow = (assigneesByTask.get(tk.id) || []).find(a => a.employee_id === me.id)
    const isDone = myRow ? myRow.completed_at != null : tk.status === 'done'
    const isAb = myRow ? myRow.abandoned_at != null : tk.status === 'abandoned'
    return !isDone && !isAb
  }), [tasks, assigneesByTask, me.id])

  const prevMonth = () => setAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const nextMonth = () => setAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  const goToday = () => setAnchor(startOfDay(new Date()))

  const MAX_LANES_PER_WEEK = 3  // 每週可見任務行數，再多顯示「+N」
  const LANE_HEIGHT = 20
  const LANE_GAP = 2
  const DATE_HEADER_HEIGHT = 22
  const OVERFLOW_ROW_HEIGHT = 18  // 「+N 更多」單獨佔一行避免跟最後一條任務重疊
  const ROW_HEIGHT = DATE_HEADER_HEIGHT + (LANE_HEIGHT + LANE_GAP) * MAX_LANES_PER_WEEK + OVERFLOW_ROW_HEIGHT
  const OVERFLOW_TOP = DATE_HEADER_HEIGHT + MAX_LANES_PER_WEEK * (LANE_HEIGHT + LANE_GAP) + 2

  const weekdayLabels = [t('週一'), t('週二'), t('週三'), t('週四'), t('週五'), t('週六'), t('週日')]
  const monthLabel = formatMonthLabel(lang, grid.year, grid.month)

  return (
    <div>
      {/* 月份切換 header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3, margin: 0 }}>{monthLabel}</h2>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button onClick={prevMonth} style={{ ...S.btnGhostSm || S.btnPrimary, background: c.card, color: c.textMuted, border: `1px solid ${c.border}`, padding: '5px 12px' }}>{t('上月')}</button>
          <button onClick={goToday} style={{ background: c.accent, color: '#fff', border: 'none', padding: '5px 14px', borderRadius: radius.sm, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>{t('今天')}</button>
          <button onClick={nextMonth} style={{ background: c.card, color: c.textMuted, border: `1px solid ${c.border}`, padding: '5px 12px', borderRadius: radius.sm, fontSize: 12, cursor: 'pointer' }}>{t('下月')}</button>
        </div>
      </div>

      {/* 星期表頭 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, border: `1px solid ${c.border}`, borderBottom: 'none', borderRadius: `${radius.md}px ${radius.md}px 0 0`, overflow: 'hidden', background: c.card }}>
        {weekdayLabels.map((wd, i) => (
          <div key={i} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600, color: c.textMuted, borderRight: i < 6 ? `1px solid ${c.border}` : 'none' }}>{wd}</div>
        ))}
      </div>

      {/* 6 週網格 */}
      <div style={{ border: `1px solid ${c.border}`, borderRadius: `0 0 ${radius.md}px ${radius.md}px`, overflow: 'hidden', background: c.card }}>
        {weeks.map((row, wi) => {
          const overflowByCol = Array(7).fill(0)
          for (const it of row.items) {
            if (it.lane >= MAX_LANES_PER_WEEK) {
              for (let col = it.colStart; col <= it.colEnd; col++) overflowByCol[col]++
            }
          }
          return (
            <div key={wi} style={{ position: 'relative', height: ROW_HEIGHT, borderTop: wi > 0 ? `1px solid ${c.border}` : 'none', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {/* 日期格背景 */}
              {row.days.map((day, di) => {
                const inMonth = day.getMonth() === grid.month
                const isToday = ymd(day) === todayYmd
                return (
                  <div key={di} style={{ borderRight: di < 6 ? `1px solid ${c.border}` : 'none', padding: '4px 6px', position: 'relative', background: inMonth ? 'transparent' : '#f8fafc' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, fontSize: 11, fontWeight: isToday ? 700 : 500, color: isToday ? '#fff' : inMonth ? c.text : c.textFaint, background: isToday ? c.accent : 'transparent', borderRadius: '50%', padding: isToday ? '0 6px' : 0 }}>{day.getDate()}</div>
                  </div>
                )
              })}
              {/* 「+N 更多」按鈕：放在週 row absolute layer，固定 top，按列定 left，避免跟任務條 lane 重疊 */}
              {row.days.map((day, di) => overflowByCol[di] > 0 && (
                <button key={`ov-${di}`} onClick={() => setExpanded(ymd(day))}
                  style={{ position: 'absolute', top: OVERFLOW_TOP, left: `calc(${(di / 7) * 100}% + 8px)`, background: 'none', border: 'none', color: c.textMuted, fontSize: 10, cursor: 'pointer', padding: 0, fontWeight: 600 }}>
                  +{overflowByCol[di]} {t('更多')}
                </button>
              ))}
              {/* 任務條（絕對定位） */}
              {row.items.filter(it => it.lane < MAX_LANES_PER_WEEK).map(({ task, colStart, colEnd, lane, leftOpen, rightOpen }) => {
                const myRow = (assigneesByTask.get(task.id) || []).find(a => a.employee_id === me.id)
                const isDone = myRow ? myRow.completed_at != null : task.status === 'done'
                const isAb = myRow ? myRow.abandoned_at != null : task.status === 'abandoned'
                const tone = pillTone(task, isDone, isAb)
                const widthPct = ((colEnd - colStart + 1) / 7) * 100
                const leftPct = (colStart / 7) * 100
                const top = DATE_HEADER_HEIGHT + lane * (LANE_HEIGHT + LANE_GAP) + 4
                return (
                  <div key={task.id}
                    onClick={() => setEditingTask(task)}
                    title={task.title}
                    style={{
                      position: 'absolute',
                      top, left: `calc(${leftPct}% + 4px)`, width: `calc(${widthPct}% - 8px)`, height: LANE_HEIGHT,
                      background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`,
                      borderTopLeftRadius: leftOpen ? 0 : radius.sm, borderBottomLeftRadius: leftOpen ? 0 : radius.sm,
                      borderTopRightRadius: rightOpen ? 0 : radius.sm, borderBottomRightRadius: rightOpen ? 0 : radius.sm,
                      padding: '0 8px', fontSize: 11, fontWeight: 600,
                      display: 'flex', alignItems: 'center', gap: 4,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      textDecoration: isAb ? 'line-through' : 'none',
                      cursor: 'pointer',
                    }}>
                    {leftOpen && <span style={{ opacity: 0.6 }}>‹</span>}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{isDone ? '✓ ' : ''}{task.title}</span>
                    {rightOpen && <span style={{ opacity: 0.6 }}>›</span>}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* 未排期任務抽屜 */}
      {unscheduled.length > 0 && (
        <details style={{ marginTop: 14, background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.md, padding: '8px 12px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: c.textMuted }}>{t('未排期')} <span style={{ color: c.textFaint, fontWeight: 400 }}>· {unscheduled.length}</span></summary>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {unscheduled.map(tk => {
              const myRow = (assigneesByTask.get(tk.id) || []).find(a => a.employee_id === me.id)
              const isDone = myRow ? myRow.completed_at != null : tk.status === 'done'
              const isAb = myRow ? myRow.abandoned_at != null : tk.status === 'abandoned'
              const tone = pillTone(tk, isDone, isAb)
              return (
                <div key={tk.id} onClick={() => setEditingTask(tk)} style={{ background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`, borderRadius: radius.sm, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', textDecoration: isAb ? 'line-through' : 'none' }}>{isDone ? '✓ ' : ''}{tk.title}</div>
              )
            })}
          </div>
        </details>
      )}

      {/* 「更多」彈層：點 +N 顯示該天全部任務 */}
      {expanded && (
        <div onClick={() => setExpanded(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: c.card, borderRadius: radius.lg, padding: 18, minWidth: 320, maxWidth: 480, maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{expanded}</h3>
              <button onClick={() => setExpanded(null)} style={{ marginLeft: 'auto', ...S.iconBtn || { background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: c.textMuted } }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tasks.filter(tk => {
                if (tk.parent_task_id) return false
                const r = getTaskRange(tk)
                if (!r) return false
                const target = parseYmd(expanded)
                return target.getTime() >= startOfDay(r.start).getTime() && target.getTime() <= startOfDay(r.end).getTime()
              }).map(tk => {
                const myRow = (assigneesByTask.get(tk.id) || []).find(a => a.employee_id === me.id)
                const isDone = myRow ? myRow.completed_at != null : tk.status === 'done'
                const isAb = myRow ? myRow.abandoned_at != null : tk.status === 'abandoned'
                const tone = pillTone(tk, isDone, isAb)
                const cr = employees.find(e => e.id === tk.creator_employee_id)
                return (
                  <div key={tk.id} onClick={() => { setExpanded(null); setEditingTask(tk) }} style={{ background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`, borderRadius: radius.sm, padding: '8px 12px', cursor: 'pointer', textDecoration: isAb ? 'line-through' : 'none' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{isDone ? '✓ ' : ''}{tk.title}</div>
                    <div style={{ fontSize: 10, color: c.textMuted, marginTop: 3 }}>
                      {tk.start_date && tk.due_date && tk.start_date !== tk.due_date ? `${tk.start_date} → ${tk.due_date}` : (tk.due_date || tk.start_date)}
                      {cr && ` · ${cr.name}`}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
