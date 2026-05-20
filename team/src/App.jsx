import React, { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabaseClient.js'
import { c, radius, font, S, Center, Field } from './styles.jsx'
import AdminApp from './admin.jsx'
import { useT } from './i18n.jsx'

// ============================================================
//  Team Honnmono — 任務管理子應用
//  所有角色都走 AdminApp（內部按 me.is_admin / me.role 顯示對應板塊）
// ============================================================

export default function App() {
  const { t } = useT()
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [view, setView] = useState('tasks')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => { setSession(s); setAuthLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (authLoading) return <Center>{t('正在載入…')}</Center>
  if (!session) return <AuthPage />
  return <AfterAuth session={session} view={view} setView={setView} />
}

// ====================  AUTH  ====================
function AuthPage() {
  const { t } = useT()
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
        if (!email || !password || !name || !companyName) throw new Error(t('請填寫郵箱、密碼、姓名、所屬公司'))
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        const { error: pErr } = await supabase.from('task_pending').insert({
          email, name, company_name: companyName.trim(), note: note.trim() || null, user_id: data.user?.id,
        })
        if (pErr) throw new Error(t('註冊申請寫入失敗：') + pErr.message)
        setDone(true)
      }
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  if (done) return (
    <Center>
      <div style={{ fontSize: 24, fontWeight: 600, color: c.text }}>{t('申請已提交')}</div>
      <div style={{ color: c.textMuted, fontSize: 14, maxWidth: 380, textAlign: 'center', lineHeight: 1.6, marginTop: 8 }}>
        {t('管理員審核通過後你會收到通知。可以關閉這個頁面，審核通過後再回來登入。')}
      </div>
      <button onClick={() => { setDone(false); setMode('signin') }} style={S.btnPrimary}>{t('返回登入')}</button>
    </Center>
  )

  return (
    <div style={{ minHeight: '100vh', background: c.bg, fontFamily: font.ui, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400, background: c.card, borderRadius: radius.lg, border: `1px solid ${c.border}`, padding: 32 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: c.text, marginBottom: 4 }}>Honnmono Team</div>
        <div style={{ fontSize: 13, color: c.textMuted, marginBottom: 24 }}>{mode === 'signin' ? t('登入帳號') : t('提交註冊申請')}</div>

        <div style={{ display: 'flex', gap: 4, padding: 4, background: c.bg, borderRadius: radius.md, marginBottom: 20 }}>
          <button onClick={() => setMode('signin')} style={S.segmentBtn(mode === 'signin')}>{t('登入')}</button>
          <button onClick={() => setMode('signup')} style={S.segmentBtn(mode === 'signup')}>{t('註冊')}</button>
        </div>

        <form onSubmit={submit}>
          {mode === 'signup' && <Field label={t('姓名')}><input value={name} onChange={e => setName(e.target.value)} style={S.input} placeholder={t('必填')} /></Field>}
          <Field label={t('郵箱')}><input type="email" value={email} onChange={e => setEmail(e.target.value)} style={S.input} /></Field>
          <Field label={t('密碼')}><input type="password" value={password} onChange={e => setPassword(e.target.value)} style={S.input} /></Field>
          {mode === 'signup' && (
            <>
              <Field label={t('所屬公司')}><input value={companyName} onChange={e => setCompanyName(e.target.value)} style={S.input} placeholder={t('管理員會綁定到公司列表')} /></Field>
              <Field label={t('備註（可選）')}><textarea value={note} onChange={e => setNote(e.target.value)} style={{ ...S.input, minHeight: 56, resize: 'vertical' }} /></Field>
            </>
          )}
          {err && <div style={{ color: c.red, fontSize: 13, padding: 10, background: c.redBg, borderRadius: radius.sm, marginTop: 4 }}>{err}</div>}
          <button type="submit" disabled={busy} style={{ ...S.btnPrimary, width: '100%', marginTop: 12 }}>{busy ? t('處理中…') : (mode === 'signin' ? t('登入') : t('提交申請'))}</button>
        </form>
        <div style={{ fontSize: 12, color: c.textFaint, marginTop: 16, textAlign: 'center' }}>
          {mode === 'signup' ? t('註冊需管理員審核') : t('新用戶請點上方「註冊」')}
        </div>
      </div>
    </div>
  )
}

// ====================  AFTER AUTH ROUTER  ====================
function AfterAuth({ session, view, setView }) {
  const { t } = useT()
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

  if (qEmp.isLoading) return <Center>{t('正在載入…')}</Center>
  const me = qEmp.data
  if (!me) return <PendingPage pending={qPending.data} session={session} />

  // admin 兜底：老板 email 也算
  const isAdmin = me.is_admin === true || session.user.email === 'samyung2011@gmail.com'
  const meEnhanced = { ...me, is_admin: isAdmin }

  // 所有人都走 AdminApp（內部按 is_admin / role 顯示對應板塊）
  // 普通員工：左側看本公司同事任務看板（沿用 bizflow 邏輯：所有人可看本公司任務，但只能改自己的）
  return <AdminApp me={meEnhanced} session={session} view={view} setView={setView} />
}

function PendingPage({ pending, session }) {
  const { t } = useT()
  const userEmail = session.user.email
  const signOutBtn = <button onClick={() => supabase.auth.signOut()} style={{ ...S.btnGhost, marginTop: 12 }}>{t('登出')}</button>
  if (!pending) return (
    <Center>
      <div style={{ fontSize: 22, fontWeight: 600, color: c.text }}>{t('找不到註冊申請')}</div>
      <div style={{ color: c.textMuted, fontSize: 13, marginTop: 6 }}>{userEmail}</div>
      <div style={{ color: c.textFaint, fontSize: 13, marginTop: 12, maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>
        {t('你的帳號已登入但找不到 task_pending 申請。如果你是現有 bizflow 員工，管理員可能還沒綁定 employees。請聯繫管理員。')}
      </div>
      {signOutBtn}
    </Center>
  )
  if (pending.approved == null) return (
    <Center>
      <div style={{ fontSize: 22, fontWeight: 600, color: c.text }}>{t('等待管理員審核')}</div>
      <div style={{ color: c.textMuted, fontSize: 14, marginTop: 12, maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>
        {t('申請公司：')}<strong style={{ color: c.text }}>{pending.company_name}</strong>
        <br />
        {t('申請時間：')}{new Date(pending.requested_at).toLocaleString('zh-HK')}
      </div>
      {signOutBtn}
    </Center>
  )
  if (pending.approved === false) return (
    <Center>
      <div style={{ fontSize: 22, fontWeight: 600, color: c.red }}>{t('申請已被拒絕')}</div>
      {pending.reject_reason && <div style={{ color: c.textMuted, fontSize: 14, marginTop: 10 }}>{t('理由：')}{pending.reject_reason}</div>}
      {signOutBtn}
    </Center>
  )
  return null
}

