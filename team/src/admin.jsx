import React, { useState } from 'react'
import { supabase } from './supabaseClient.js'
import { c, font, S, useIsMobile } from './styles.jsx'
import { useT } from './i18n.jsx'
import { useAdminData, useMyContext } from './lib/adminHooks.js'
import ProfileModal from './components/ProfileModal.jsx'
import UpdateLogView from './views/UpdateLog.jsx'
import TasksView from './views/Tasks.jsx'
import EmployeesView from './views/Employees.jsx'
import AccountReviewView from './views/AccountReview.jsx'
import CompaniesView from './views/Companies.jsx'
import CommissionView from './views/Commission.jsx'
import RolesAndDepartmentsView from './views/RolesAndDepartments.jsx'

// ============================================================
//  AdminApp — 路由 + 頂部導航。各 view 已分別拆到 views/*
// ============================================================

// ====================  ADMIN APP ROOT  ====================
export default function AdminApp({ me, session, view, setView }) {
  const { t } = useT()
  const isMobile = useIsMobile()
  const data = useAdminData()
  const ctx = useMyContext(me, data)
  const [showProfile, setShowProfile] = useState(false)

  // view 按權限 fallback
  const isSales = me.role === '銷售'
  const canEmployees = ctx.isSuperAdmin || ctx.isAdminOfAny || ctx.hasPermission('can_manage_employees')
  const canCompanies = ctx.isSuperAdmin
  const canAccountReview = ctx.isSuperAdmin || ctx.isAdminOfAny || ctx.hasPermission('can_approve_registration')
  const canCommission = ctx.isSuperAdmin || ctx.hasPermission('can_view_commission') || isSales
  const canManageRoles = ctx.isSuperAdmin || ctx.isAdminOfActive || ctx.hasPermission('can_manage_roles')
  const allowedViews = ['tasks', 'updatelog']
  if (canEmployees) allowedViews.push('employees')
  if (canCompanies) allowedViews.push('companies')
  if (canManageRoles) allowedViews.push('roles')
  if (canAccountReview) allowedViews.push('accountreview')
  if (canCommission) allowedViews.push('commission')
  const safeView = allowedViews.includes(view) ? view : 'tasks'

  return (
    <div style={{ minHeight: '100vh', background: c.bg, fontFamily: font.ui, color: c.text, WebkitFontSmoothing: 'antialiased' }}>
      <AdminTopBar me={me} ctx={ctx} data={data} view={safeView} setView={setView} isMobile={isMobile} pendingCount={data.pendings.filter(p => p.approved == null).length} onProfileClick={() => setShowProfile(true)} canEmployees={canEmployees} canCompanies={canCompanies} canAccountReview={canAccountReview} canCommission={canCommission} canManageRoles={canManageRoles} />
      <main style={{ maxWidth: 1500, margin: '0 auto', padding: isMobile ? '12px 12px' : '18px 24px' }}>
        {safeView === 'tasks' && <TasksView data={data} me={me} session={session} isMobile={isMobile} ctx={ctx} />}
        {safeView === 'employees' && canEmployees && <EmployeesView data={data} me={me} isMobile={isMobile} ctx={ctx} />}
        {safeView === 'companies' && canCompanies && <CompaniesView data={data} />}
        {safeView === 'accountreview' && canAccountReview && <AccountReviewView data={data} me={me} session={session} />}
        {safeView === 'commission' && canCommission && (
          <CommissionView employees={ctx.isSuperAdmin ? data.employees : [me]} me={me} lockedEmpId={ctx.isSuperAdmin ? null : me.id} />
        )}
        {safeView === 'roles' && canManageRoles && <RolesAndDepartmentsView data={data} ctx={ctx} />}
        {safeView === 'updatelog' && <UpdateLogView me={me} session={session} isMobile={isMobile} />}
      </main>
      {showProfile && <ProfileModal me={me} data={data} onClose={() => setShowProfile(false)} />}
    </div>
  )
}

function AdminTopBar({ me, ctx, data, view, setView, isMobile, pendingCount, onProfileClick, canEmployees, canCompanies, canAccountReview, canCommission, canManageRoles }) {
  const { t, lang, setLang } = useT()
  const isSales = me.role === '銷售'
  // 只 Honnmono 公司可以跳 bizflow 主端（其他公司沒有 bizflow 後台）
  // 且 employees.bizflow_main_access = true 的人才有入口（白名單，跟主端 RLS 一致）
  // super admin 在任意公司視角看 Honnmono 也算（兜底）
  const isHonnmonoActive = ctx.activeCompany?.name === 'Honnmono'
  const isBizflowWhitelisted = me?.bizflow_main_access === true || ctx.isSuperAdmin
  const canGoBizflow = (isHonnmonoActive || ctx.isSuperAdmin) && isBizflowWhitelisted
  const navs = [
    ['tasks', t('任務'), true],
    ['employees', t('員工管理'), canEmployees],
    ['companies', t('公司管理'), canCompanies],
    ['roles', t('職位 / 權限 / 部門管理'), canManageRoles],
    ['accountreview', t('帳號審核'), canAccountReview],
    ['commission', ctx.isSuperAdmin ? t('佣金') : t('我的佣金'), canCommission],
    ['updatelog', t('更新日誌'), true],
  ].filter(([, , show]) => show)

  // 顯示當前公司名（多公司綁定的人才能切換）
  const titleNode = canGoBizflow ? (
    <a href={import.meta.env.VITE_BIZFLOW_URL || 'https://bizflowhonnmono.vercel.app'} style={{ fontSize: 15, fontWeight: 700, color: c.text, letterSpacing: -0.2, whiteSpace: 'nowrap', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }} title={t('返回 bizflow 主端')}>
      <span style={{ fontSize: 13, color: c.textMuted }}>←</span>
      Honnmono Team
    </a>
  ) : (
    <span style={{ fontSize: 15, fontWeight: 700, color: c.text, letterSpacing: -0.2, whiteSpace: 'nowrap' }}>
      {ctx.activeCompany?.name || 'Team'}
    </span>
  )

  return (
    <header style={{ background: c.card, borderBottom: `1px solid ${c.border}`, padding: isMobile ? '10px 14px' : '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 28, overflowX: 'auto' }}>
        {titleNode}
        {ctx.hasMultipleCompanies && (
          <select value={ctx.activeCompanyId || ''} onChange={e => ctx.setActiveCompanyId(e.target.value)}
            style={{ fontSize: 12, padding: '4px 8px', border: `1px solid ${c.border}`, borderRadius: 6, background: c.bg, color: c.text, fontFamily: font.ui, cursor: 'pointer' }}>
            {ctx.switchableCompanies.map(b => {
              const co = data.companies.find(co => co.id === b.company_id)
              return <option key={b.company_id} value={b.company_id}>{co?.name || '?'}{b.is_default ? ' ★' : ''}</option>
            })}
          </select>
        )}
        <nav style={{ display: 'flex', gap: 2 }}>
          {navs.map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} style={{ ...S.navBtn(view === k), position: 'relative', whiteSpace: 'nowrap' }}>
              {label}
              {k === 'accountreview' && pendingCount > 0 && <span style={{ position: 'absolute', top: -2, right: -4, background: c.red, color: '#fff', fontSize: 9, borderRadius: 8, padding: '1px 5px', fontWeight: 700 }}>{pendingCount}</span>}
            </button>
          ))}
        </nav>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', gap: 2, padding: 2, background: c.bg, borderRadius: 6 }}>
          {[{ v: 'zh', l: '繁' }, { v: 'en', l: 'EN' }, { v: 'fr', l: 'FR' }].map(opt => (
            <button key={opt.v} onClick={() => setLang(opt.v)}
              style={{ padding: '3px 8px', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: lang === opt.v ? c.accent : 'transparent', color: lang === opt.v ? '#fff' : c.textMuted, fontFamily: font.ui }}>
              {opt.l}
            </button>
          ))}
        </div>
        <button onClick={onProfileClick} title={t('編輯個人資料')} style={{ fontSize: 12, color: c.text, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: isMobile ? 'none' : 'inline', fontFamily: font.ui, textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>{me.name}</button>
        <button onClick={() => supabase.auth.signOut()} style={S.btnGhostSm}>{t('登出')}</button>
      </div>
    </header>
  )
}



