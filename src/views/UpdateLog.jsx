import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'
import MarkdownText from '../components/MarkdownText.jsx'

const MARKDOWN_LOG_AUTHORS = new Set(["1267481a-503f-4154-829e-bc97788b4567"])
const MARKDOWN_COMMENT_AUTHORS = new Set(["2f88a573-c4db-4b93-aadc-2a56106c5f9c"])

export default function UpdateLogView() {
  const { t } = useT()
  const { employees, currentEmployee, isBfAdmin, userId, session, updateLogs, setUpdateLogs, logComments, setLogComments } = useAppContext()
  const queryClient = useQueryClient()

  const [newLogDraft, setNewLogDraft] = useState({ summary: "", detail: "" })
  const [editingLogId, setEditingLogId] = useState(null)
  const [editingLogDraft, setEditingLogDraft] = useState({ summary: "", detail: "" })
  const [editingLogComment, setEditingLogComment] = useState(null)
  const [newLogCommentDraft, setNewLogCommentDraft] = useState({})
  const [replyingToLogComment, setReplyingToLogComment] = useState(null)
  const [expandedLogIds, setExpandedLogIds] = useState(() => new Set())
  const [logsVisibleCount, setLogsVisibleCount] = useState(20)

  async function handleAddUpdateLog(employeeId, summary, detail) {
    if (!summary || !summary.trim()) return
    const { data, error } = await supabase.from("employee_update_logs").insert({
      employee_id: employeeId,
      summary: summary.trim(),
      detail: (detail || "").trim() || null,
    }).select().single()
    if (error) { alert(`${t("新增失敗")}：${error.message}`); return }
    setUpdateLogs(prev => [data, ...prev])
    queryClient.setQueryData(["bf", "employee_update_logs"], (old) => Array.isArray(old) ? [data, ...old] : [data])
    return data
  }

  async function handleUpdateUpdateLog(logId, patch) {
    const finalPatch = { ...patch, updated_at: new Date().toISOString() }
    const { data, error } = await supabase.from("employee_update_logs").update(finalPatch).eq("id", logId).select().single()
    if (error) { alert(`${t("保存失敗")}：${error.message}`); return }
    setUpdateLogs(prev => prev.map(l => l.id === logId ? data : l))
    queryClient.setQueryData(["bf", "employee_update_logs"], (old) => Array.isArray(old) ? old.map(l => l.id === logId ? data : l) : old)
  }

  async function handleDeleteUpdateLog(logId) {
    if (!window.confirm(t("確定刪除此更新及所有評論？"))) return
    const { error } = await supabase.from("employee_update_logs").delete().eq("id", logId)
    if (error) { alert(`${t("刪除失敗")}：${error.message}`); return }
    setUpdateLogs(prev => prev.filter(l => l.id !== logId))
    setLogComments(prev => prev.filter(c => c.update_log_id !== logId))
    queryClient.setQueryData(["bf", "employee_update_logs"], (old) => Array.isArray(old) ? old.filter(l => l.id !== logId) : old)
    queryClient.setQueryData(["bf", "employee_update_log_comments"], (old) => Array.isArray(old) ? old.filter(c => c.update_log_id !== logId) : old)
  }

  async function handleAddLogComment(updateLogId, body, parentCommentId = null) {
    if (!body || !body.trim() || !userId) return
    const authorName = currentEmployee?.name || (session?.user?.email ? session.user.email.split("@")[0] : "user")
    const { data, error } = await supabase.from("employee_update_log_comments").insert({
      update_log_id: updateLogId,
      author_user_id: userId,
      author_name: authorName,
      body: body.trim(),
      parent_comment_id: parentCommentId,
    }).select().single()
    if (error) { alert(`${t("發送失敗")}：${error.message}`); return }
    setLogComments(prev => [...prev, data])
    queryClient.setQueryData(["bf", "employee_update_log_comments"], (old) => Array.isArray(old) ? [...old, data] : [data])
    return data
  }

  async function handleUpdateLogComment(commentId, body) {
    if (!body || !body.trim()) return
    const { data, error } = await supabase.from("employee_update_log_comments").update({ body: body.trim(), updated_at: new Date().toISOString() }).eq("id", commentId).select().single()
    if (error) { alert(`${t("保存失敗")}：${error.message}`); return }
    setLogComments(prev => prev.map(c => c.id === commentId ? data : c))
    queryClient.setQueryData(["bf", "employee_update_log_comments"], (old) => Array.isArray(old) ? old.map(c => c.id === commentId ? data : c) : old)
  }

  async function handleDeleteLogComment(commentId) {
    if (!window.confirm(t("確定刪除此評論？"))) return
    const { error } = await supabase.from("employee_update_log_comments").delete().eq("id", commentId)
    if (error) { alert(`${t("刪除失敗")}：${error.message}`); return }
    setLogComments(prev => prev.filter(c => c.id !== commentId))
    queryClient.setQueryData(["bf", "employee_update_log_comments"], (old) => Array.isArray(old) ? old.filter(c => c.id !== commentId) : old)
  }

  const helenEmp = employees.find(e => MARKDOWN_LOG_AUTHORS.has(e.id)) || employees.find(e => e.show_update_log === true)
  if (!helenEmp) {
    return <div style={{ background: "#fff", border: "1px dashed #e0e0e0", borderRadius: 12, padding: 60, textAlign: "center", color: "#aaa" }}>{t("未配置 show_update_log 員工")}</div>
  }
  const canEditHelen = isBfAdmin || (currentEmployee && currentEmployee.id === helenEmp.id)
  const allMyLogs = updateLogs.filter(l => l.employee_id === helenEmp.id)
  const myLogs = allMyLogs.slice(0, logsVisibleCount)
  const hasMore = allMyLogs.length > myLogs.length
  const fmtFull = (iso) => {
    const d = new Date(iso)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const dd = String(d.getDate()).padStart(2, "0")
    let h = d.getHours()
    const min = String(d.getMinutes()).padStart(2, "0")
    const ampm = h >= 12 ? "PM" : "AM"
    h = h % 12; if (h === 0) h = 12
    return `${yyyy}/${mm}/${dd} ${String(h).padStart(2, "0")}:${min} ${ampm}`
  }
  const renderCommentTree = (logId, parentId, depth) => {
    const list = logComments.filter(c => c.update_log_id === logId && (c.parent_comment_id || null) === parentId)
    return list.map(c => {
      const isOwn = c.author_user_id === userId
      const canEditCmt = isOwn || isBfAdmin
      const isEditing = editingLogComment && editingLogComment.id === c.id
      const isReplyingHere = replyingToLogComment && replyingToLogComment.parentId === c.id
      return (
        <div key={c.id} style={{ marginLeft: depth * 20, marginTop: 8, paddingLeft: depth > 0 ? 10 : 0, borderLeft: depth > 0 ? "2px solid #eef2ff" : "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
            <div style={{ fontSize: 11, color: "#888" }}>
              <strong style={{ color: "#3b58d4" }}>{c.author_name || t("未知")}</strong>
              <span style={{ marginLeft: 6 }}>{new Date(c.created_at).toLocaleString("zh-HK", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              {c.updated_at && c.updated_at !== c.created_at && <span style={{ marginLeft: 4, color: "#bbb" }}>·{t("已編輯")}</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setReplyingToLogComment(isReplyingHere ? null : { logId, parentId: c.id })} style={{ background: "none", border: "none", color: "#6382ff", fontSize: 11, cursor: "pointer", padding: 0 }}>{isReplyingHere ? t("取消") : `↩ ${t("回復")}`}</button>
              {canEditCmt && !isEditing && <button onClick={() => setEditingLogComment({ id: c.id, body: c.body })} style={{ background: "none", border: "none", color: "#888", fontSize: 11, cursor: "pointer", padding: 0 }}>✏</button>}
              {canEditCmt && <button onClick={() => handleDeleteLogComment(c.id)} style={{ background: "none", border: "none", color: "#e53935", fontSize: 11, cursor: "pointer", padding: 0 }}>×</button>}
            </div>
          </div>
          {isEditing ? (
            <div>
              <textarea value={editingLogComment.body} onChange={e => setEditingLogComment({ ...editingLogComment, body: e.target.value })} style={{ width: "100%", minHeight: 50, padding: "6px 8px", borderRadius: 6, border: "1px solid #6382ff", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box", resize: "vertical" }} />
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button onClick={async () => { await handleUpdateLogComment(c.id, editingLogComment.body); setEditingLogComment(null); }} style={{ padding: "4px 10px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>{t("保存")}</button>
                <button onClick={() => setEditingLogComment(null)} style={{ padding: "4px 10px", background: "#fff", color: "#888", border: "1px solid #e0e0e0", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>{t("取消")}</button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#333", lineHeight: 1.5, whiteSpace: MARKDOWN_COMMENT_AUTHORS.has(c.author_user_id) ? "normal" : "pre-wrap" }}>
              {MARKDOWN_COMMENT_AUTHORS.has(c.author_user_id) ? <MarkdownText text={c.body} fontSize={12} /> : c.body}
            </div>
          )}
          {isReplyingHere && (
            <div style={{ marginTop: 6 }}>
              <textarea
                value={newLogCommentDraft[`reply:${logId}:${c.id}`] || ""}
                onChange={e => setNewLogCommentDraft({ ...newLogCommentDraft, [`reply:${logId}:${c.id}`]: e.target.value })}
                placeholder={t("回復")}
                style={{ width: "100%", minHeight: 40, padding: "6px 8px", borderRadius: 6, border: "1px solid #6382ff", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box", resize: "vertical" }}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button onClick={async () => { const k = `reply:${logId}:${c.id}`; await handleAddLogComment(logId, newLogCommentDraft[k] || "", c.id); setNewLogCommentDraft({ ...newLogCommentDraft, [k]: "" }); setReplyingToLogComment(null); }} style={{ padding: "4px 10px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>{t("發送")}</button>
              </div>
            </div>
          )}
          {renderCommentTree(logId, c.id, depth + 1)}
        </div>
      )
    })
  }
  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 20 }}>{t("更新日誌")}</h1>
      {/* 新增更新區（僅本人，admin 在別人頁面也不能寫） */}
      {currentEmployee && helenEmp.id === currentEmployee.id && (
        <div style={{ background: "#fafbff", border: "1px solid #eef0fa", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#3b58d4", marginBottom: 10 }}>＋ {t("新增更新")}</div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{t("簡略（必填）")}</div>
          <textarea value={newLogDraft.summary} onChange={e => setNewLogDraft({ ...newLogDraft, summary: e.target.value })} placeholder={t("一句話概括今天做了什麼...")} rows={2} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", marginBottom: 10, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
          <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{t("詳細（可選，展開後顯示）")}</div>
          <textarea value={newLogDraft.detail} onChange={e => setNewLogDraft({ ...newLogDraft, detail: e.target.value })} placeholder={t("詳細描述...")} style={{ width: "100%", minHeight: 100, padding: "8px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 12, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", marginBottom: 10 }} />
          <button onClick={async () => { if (!newLogDraft.summary.trim()) return; await handleAddUpdateLog(helenEmp.id, newLogDraft.summary, newLogDraft.detail); setNewLogDraft({ summary: "", detail: "" }); }} disabled={!newLogDraft.summary.trim()} style={{ padding: "8px 18px", background: newLogDraft.summary.trim() ? "#6382ff" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: newLogDraft.summary.trim() ? "pointer" : "not-allowed" }}>{t("保存")}</button>
        </div>
      )}
      {/* 時間軸 */}
      {allMyLogs.length === 0 ? (
        <div style={{ background: "#fff", border: "1px dashed #e0e0e0", borderRadius: 12, padding: 60, textAlign: "center", color: "#aaa", fontSize: 13 }}>{t("暫無更新記錄")}</div>
      ) : (<>
        <div style={{ position: "relative", paddingLeft: 24 }}>
          <div style={{ position: "absolute", left: 7, top: 6, bottom: 6, width: 2, background: "#eef2ff" }} />
          {myLogs.map(log => {
            const isExpanded = expandedLogIds.has(log.id)
            const isEditingThis = editingLogId === log.id
            const cmtCount = logComments.filter(c => c.update_log_id === log.id).length
            const isReplyingTopHere = replyingToLogComment && replyingToLogComment.logId === log.id && replyingToLogComment.parentId === null
            return (
              <div key={log.id} style={{ position: "relative", marginBottom: 18 }}>
                <div style={{ position: "absolute", left: -22, top: 8, width: 12, height: 12, borderRadius: "50%", background: "#6382ff", border: "2px solid #fff", boxShadow: "0 0 0 2px #6382ff" }} />
                <div style={{ background: "#fff", border: "1px solid #eef0fa", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>{fmtFull(log.created_at)}{log.updated_at && log.updated_at !== log.created_at && <span style={{ marginLeft: 6, color: "#bbb", fontWeight: 400 }}>·{t("已編輯")} {fmtFull(log.updated_at)}</span>}</div>
                    {canEditHelen && !isEditingThis && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => { setEditingLogId(log.id); setEditingLogDraft({ summary: log.summary || "", detail: log.detail || "" }); }} style={{ background: "none", border: "none", color: "#888", fontSize: 12, cursor: "pointer", padding: 0 }}>✏ {t("編輯")}</button>
                        <button onClick={() => handleDeleteUpdateLog(log.id)} style={{ background: "none", border: "none", color: "#e53935", fontSize: 12, cursor: "pointer", padding: 0 }}>× {t("刪除")}</button>
                      </div>
                    )}
                  </div>
                  {isEditingThis ? (
                    <div>
                      <textarea value={editingLogDraft.summary} onChange={e => setEditingLogDraft({ ...editingLogDraft, summary: e.target.value })} placeholder={t("簡略")} rows={2} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #6382ff", fontSize: 13, outline: "none", marginBottom: 8, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
                      <textarea value={editingLogDraft.detail} onChange={e => setEditingLogDraft({ ...editingLogDraft, detail: e.target.value })} placeholder={t("詳細")} style={{ width: "100%", minHeight: 100, padding: "8px 10px", borderRadius: 6, border: "1px solid #6382ff", fontSize: 12, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", marginBottom: 8 }} />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={async () => { if (!editingLogDraft.summary.trim()) return; await handleUpdateUpdateLog(log.id, { summary: editingLogDraft.summary.trim(), detail: editingLogDraft.detail.trim() || null }); setEditingLogId(null); }} style={{ padding: "5px 12px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>{t("保存")}</button>
                        <button onClick={() => setEditingLogId(null)} style={{ padding: "5px 12px", background: "#fff", color: "#888", border: "1px solid #e0e0e0", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>{t("取消")}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div onClick={() => { setExpandedLogIds(prev => { const n = new Set(prev); if (n.has(log.id)) n.delete(log.id); else n.add(log.id); return n; }); }} style={{ fontSize: 14, color: "#222", lineHeight: 1.5, cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <span style={{ color: "#6382ff", fontSize: 11, marginTop: 3 }}>{isExpanded ? "▼" : "▶"}</span>
                        <span style={{ flex: 1, whiteSpace: MARKDOWN_LOG_AUTHORS.has(log.employee_id) ? "normal" : "pre-wrap" }}>
                          {MARKDOWN_LOG_AUTHORS.has(log.employee_id) ? <MarkdownText text={log.summary} fontSize={14} /> : log.summary}
                        </span>
                      </div>
                      {isExpanded && log.detail && (
                        <div style={{ marginTop: 10, padding: "10px 12px", background: "#fafbff", borderRadius: 8, fontSize: 12, color: "#444", lineHeight: 1.6, whiteSpace: MARKDOWN_LOG_AUTHORS.has(log.employee_id) ? "normal" : "pre-wrap" }}>
                          {MARKDOWN_LOG_AUTHORS.has(log.employee_id) ? <MarkdownText text={log.detail} fontSize={12} /> : log.detail}
                        </div>
                      )}
                    </>
                  )}
                  {/* 評論區 */}
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #eef0fa" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 11, color: "#888" }}>💬 {t("評論")} <span style={{ color: "#aaa" }}>{cmtCount}</span></div>
                      {!isReplyingTopHere && <button onClick={() => setReplyingToLogComment({ logId: log.id, parentId: null })} style={{ background: "none", border: "none", color: "#6382ff", fontSize: 11, cursor: "pointer", padding: 0 }}>+ {t("評論")}</button>}
                    </div>
                    {isReplyingTopHere && (
                      <div style={{ marginTop: 6 }}>
                        <textarea
                          value={newLogCommentDraft[`reply:${log.id}:null`] || ""}
                          onChange={e => setNewLogCommentDraft({ ...newLogCommentDraft, [`reply:${log.id}:null`]: e.target.value })}
                          placeholder={t("發表評論...")}
                          style={{ width: "100%", minHeight: 50, padding: "6px 8px", borderRadius: 6, border: "1px solid #6382ff", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box", resize: "vertical" }}
                        />
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button onClick={async () => { const k = `reply:${log.id}:null`; await handleAddLogComment(log.id, newLogCommentDraft[k] || ""); setNewLogCommentDraft({ ...newLogCommentDraft, [k]: "" }); setReplyingToLogComment(null); }} style={{ padding: "4px 10px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>{t("發送")}</button>
                          <button onClick={() => setReplyingToLogComment(null)} style={{ padding: "4px 10px", background: "#fff", color: "#888", border: "1px solid #e0e0e0", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>{t("取消")}</button>
                        </div>
                      </div>
                    )}
                    <div>{renderCommentTree(log.id, null, 0)}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {hasMore && (
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <button onClick={() => setLogsVisibleCount(c => c + 20)} style={{ padding: "8px 20px", background: "#fff", border: "1px solid #6382ff", color: "#6382ff", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              {t("加載更多")}（{t("剩餘")} {allMyLogs.length - myLogs.length}）
            </button>
          </div>
        )}
      </>)}
    </div>
  )
}
