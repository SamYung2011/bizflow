import React, { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabaseClient.js'
import { c, radius, font, S, fetchAllTable, Center, Empty, Field, Section, fmtDateTime } from './styles.jsx'
import AdminApp from './admin.jsx'

// ============================================================
//  Team Honnmono — 任務管理子應用
//  所有角色都走 AdminApp（內部按 me.is_admin / me.role 顯示對應板塊）
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

  // admin 兜底：老板 email 也算
  const isAdmin = me.is_admin === true || session.user.email === 'samyung2011@gmail.com'
  const meEnhanced = { ...me, is_admin: isAdmin }

  // 所有人都走 AdminApp（內部按 is_admin / role 顯示對應板塊）
  // 普通員工：左側看本公司同事任務看板（沿用 bizflow 邏輯：所有人可看本公司任務，但只能改自己的）
  return <AdminApp me={meEnhanced} session={session} view={view} setView={setView} />
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
