import React, { useState } from 'react'
import { c, radius } from '../styles.jsx'

// 通用 assignee chip 編輯器：顯示已選 chip + @ 搜索 popover
// 之前 team/ 內有 4 份重複實現（NewTaskForm / NewSubtaskRow / EditTaskModal AssigneeEditor / SubtaskList）
//
// props:
//   value: string[]             — 當前選中 employee id 陣列
//   onChange: (ids[]) => void   — 改動回調（增刪都走這個）
//   candidates: Employee[]      — 可選列表（caller 自己過濾好 active/公司/部門/已選）
//   employees: Employee[]       — 用於查 name 渲染 chip（候選之外也可能要顯示，比如「老 assignee 不在當前 candidates 也要顯示」）
//   readOnly?: boolean          — true → 不能改，點擊觸發 onForbidden
//   onForbidden?: () => void
//   placeholder?: string
//   size?: 'sm' | 'md'          — sm 用於子任務密集場景
//   rightSlot?: ReactNode       — chip 列右側額外節點（例：「發布人: XXX」）
export default function AssigneeChipEditor({
  value, onChange, candidates, employees,
  readOnly = false, onForbidden = () => {},
  placeholder = '@ 加成員', size = 'md', rightSlot = null,
}) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const q = input.replace(/^@/, '').toLowerCase()
  const filtered = q ? candidates.filter(e => (e.name || '').toLowerCase().includes(q)) : candidates

  const cs = size === 'sm' ? STYLE_SM : STYLE_MD

  const remove = (id) => readOnly ? onForbidden() : onChange(value.filter(x => x !== id))
  const add = (id) => { onChange([...value, id]); setInput('') }

  return (
    <div style={{ position: 'relative', border: `1px solid ${c.border}`, borderRadius: radius.sm, padding: cs.containerPad, display: 'flex', flexWrap: 'wrap', gap: 3, minHeight: cs.minHeight, background: c.card, opacity: readOnly ? 0.7 : 1 }}>
      {value.map(id => {
        const e2 = employees.find(x => x.id === id)
        return (
          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: cs.chipPad, background: c.accentBg, color: c.accent, borderRadius: 9, fontSize: cs.chipFs, fontWeight: 600 }}>
            @{e2?.name || '?'}
            <button type="button" onClick={() => remove(id)} style={{ background: 'none', border: 'none', color: c.accent, cursor: 'pointer', fontSize: cs.chipFs + 1 }}>×</button>
          </span>
        )
      })}
      <input
        value={input}
        onChange={readOnly ? undefined : (e => { setInput(e.target.value); setOpen(true) })}
        onFocus={readOnly ? (e => { e.target.blur(); onForbidden() }) : (() => setOpen(true))}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={placeholder}
        style={{ flex: 1, minWidth: 50, border: 'none', outline: 'none', fontSize: cs.inputFs, background: 'transparent' }}
      />
      {!readOnly && open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 3, background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.sm, boxShadow: '0 4px 14px rgba(0,0,0,0.1)', padding: 3, width: '100%', maxHeight: 180, overflowY: 'auto', zIndex: 30 }}>
          {filtered.map(e2 => (
            <button key={e2.id} type="button" onMouseDown={ev => { ev.preventDefault(); add(e2.id) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', background: 'none', border: 'none', fontSize: cs.popFs, color: c.text, cursor: 'pointer', borderRadius: 3 }}>
              {e2.name}{e2.role && <span style={{ color: c.textFaint, marginLeft: 4, fontSize: cs.popFs - 2 }}>{e2.role}</span>}
            </button>
          ))}
        </div>
      )}
      {rightSlot}
    </div>
  )
}

const STYLE_MD = { containerPad: '4px 6px', minHeight: 28, chipPad: '2px 6px', chipFs: 10, inputFs: 11, popFs: 11 }
const STYLE_SM = { containerPad: '2px 4px', minHeight: 22, chipPad: '1px 5px', chipFs: 9, inputFs: 10, popFs: 10 }
