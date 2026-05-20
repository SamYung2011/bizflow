import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabaseClient.js'
import { c, radius, S, fetchAllTable, useToggleSet, Empty, fmtDateTime } from '../styles.jsx'
import { useT } from '../i18n.jsx'
import MarkdownText from '../MarkdownText.jsx'

const HELEN_EMAIL = 'a1017339632@gmail.com'
// 個人偏好：markdown 渲染白名單（更新日誌 + 評論）。author_user_id 命中即走 MarkdownText
const MARKDOWN_AUTHORS = new Set(['2f88a573-c4db-4b93-aadc-2a56106c5f9c'])

export default function UpdateLogView({ me, session, isMobile }) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const userId = session.user.id
  const canWrite = session.user.email === HELEN_EMAIL || me.is_admin === true

  const qLogs = useQuery({ queryKey: ['team', 'team_update_logs'], queryFn: () => fetchAllTable('team_update_logs', 'created_at', false), refetchInterval: 15000 })
  const qCmts = useQuery({ queryKey: ['team', 'team_update_log_comments'], queryFn: () => fetchAllTable('team_update_log_comments', 'created_at'), refetchInterval: 15000 })

  const [draft, setDraft] = useState({ summary: '', detail: '' })
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({ summary: '', detail: '' })
  const [expanded, toggleExpanded] = useToggleSet()
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
    if (!confirm(t('確定刪除？'))) return
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
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 18, letterSpacing: -0.3 }}>{t('更新日誌')}</h1>

      {canWrite && (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: radius.lg, padding: 14, marginBottom: 24 }}>
          <input value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value })} placeholder={t('標題（必填）')} style={S.input} />
          <textarea value={draft.detail} onChange={e => setDraft({ ...draft, detail: e.target.value })} placeholder={t('詳細（可選）')} style={{ ...S.input, minHeight: 60, resize: 'vertical' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={add} disabled={!draft.summary.trim()} style={{ ...S.btnPrimary, opacity: draft.summary.trim() ? 1 : 0.4 }}>{t('發布')}</button>
          </div>
        </div>
      )}

      {logs.length === 0 ? <Empty>{t('還沒有任何更新')}</Empty> : (
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
                      <button onClick={() => save(log.id)} style={S.btnPrimary}>{t('保存')}</button>
                      <button onClick={() => setEditingId(null)} style={S.btnGhost}>{t('取消')}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div onClick={() => toggleExpanded(log.id)} style={{ cursor: log.detail ? 'pointer' : 'default', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      {log.detail && <span style={{ color: c.textFaint, fontSize: 10, marginTop: 5 }}>{exp ? '▼' : '▶'}</span>}
                      <div style={{ fontSize: 14, fontWeight: 500, color: c.text, whiteSpace: MARKDOWN_AUTHORS.has(log.author_user_id) ? 'normal' : 'pre-wrap', flex: 1 }}>
                        {MARKDOWN_AUTHORS.has(log.author_user_id) ? <MarkdownText text={log.summary} fontSize={14} /> : log.summary}
                      </div>
                    </div>
                    {exp && log.detail && (
                      <div style={{ marginTop: 10, padding: 12, background: c.bg, borderRadius: radius.md, fontSize: 13, color: c.text, lineHeight: 1.6, whiteSpace: MARKDOWN_AUTHORS.has(log.author_user_id) ? 'normal' : 'pre-wrap' }}>
                        {MARKDOWN_AUTHORS.has(log.author_user_id) ? <MarkdownText text={log.detail} fontSize={13} /> : log.detail}
                      </div>
                    )}
                  </>
                )}

                <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${c.border}` }}>
                  {lcs.map(co => (
                    <div key={co.id} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 11, color: c.textMuted, display: 'flex', justifyContent: 'space-between' }}>
                        <span><strong style={{ color: c.text }}>{co.author_name}</strong> · {fmtDateTime(co.created_at)}</span>
                        {(co.author_user_id === userId || me.is_admin) && <button onClick={() => delCmt(co.id)} style={{ ...S.iconBtn, color: c.red, fontSize: 11 }}>×</button>}
                      </div>
                      <div style={{ fontSize: 12, color: c.text, marginTop: 2, whiteSpace: MARKDOWN_AUTHORS.has(co.author_user_id) ? 'normal' : 'pre-wrap' }}>
                        {MARKDOWN_AUTHORS.has(co.author_user_id) ? <MarkdownText text={co.body} fontSize={12} /> : co.body}
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <input value={cmtDraft[log.id] || ''} onChange={e => setCmtDraft(p => ({ ...p, [log.id]: e.target.value }))} placeholder={t('評論…')} style={{ ...S.input, marginBottom: 0, flex: 1 }} />
                    <button onClick={() => cmt(log.id)} disabled={!(cmtDraft[log.id] || '').trim()} style={{ ...S.btnPrimary, padding: '6px 12px', fontSize: 12, opacity: (cmtDraft[log.id] || '').trim() ? 1 : 0.4 }}>{t('發送')}</button>
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
