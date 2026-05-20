import React from 'react'
import { c, radius } from '../styles.jsx'

// 公司卡片：頭部「▶/▼ 公司名 · 副標」+ 折疊內容區。
// 用於 EmployeesView / RolesView / DepartmentsView 等「按公司分組」場景。
//
// props:
//   collapsed: boolean       — 是否折疊
//   onToggle: () => void     — 點頭部觸發
//   name: string             — 公司名
//   subLabel?: ReactNode     — 副標（例：「3 個職位」「5 人」）
//   children: ReactNode      — 展開時內容
//   contentPadding?: number  — 內容區 padding，默認 14（DepartmentsView 用 0）
export default function CompanyCollapseCard({ collapsed, onToggle, name, subLabel, children, contentPadding = 14 }) {
  return (
    <div style={{ marginBottom: 14, background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: 'pointer', borderBottom: collapsed ? 'none' : `1px solid ${c.border}`, background: c.bg }}>
        <span style={{ fontSize: 11, color: c.textMuted, width: 12 }}>{collapsed ? '▶' : '▼'}</span>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{name}</span>
        {subLabel != null && <span style={{ fontSize: 11, color: c.textFaint }}>{subLabel}</span>}
      </div>
      {!collapsed && (contentPadding === 0 ? children : <div style={{ padding: contentPadding }}>{children}</div>)}
    </div>
  )
}
