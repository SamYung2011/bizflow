import { memberT } from "./members-i18n.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import {
  createTeamUpdateComment,
  createTeamUpdateLog,
  deleteTeamUpdateComment,
  deleteTeamUpdateLog,
  updateTeamUpdateComment,
  updateTeamUpdateLog
} from "../data/live-update-log-writes.js";

export const UPDATE_LOG_PAGE_SIZE = 20;

export function formatUpdateTimestamp(input = new Date()) {
  const text = String(input ?? "").trim();
  const formatted = text.match(/^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})/);
  if (formatted && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    return `${formatted[1]}/${formatted[2]}/${formatted[3]} ${formatted[4]}:${formatted[5]}`;
  }
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return text || "—";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}/${value.month}/${value.day} ${value.hour}:${value.minute}`;
}

function timestampValue(value) {
  const text = String(value || "").trim();
  const formatted = text.match(/^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})/);
  if (formatted) return Date.parse(`${formatted[1]}-${formatted[2]}-${formatted[3]}T${formatted[4]}:${formatted[5]}:00+08:00`);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortUpdateCommentsOldestFirst(comments) {
  return [...comments].sort((left, right) =>
    timestampValue(left.createdAt || left.time) - timestampValue(right.createdAt || right.time));
}

function renderUpdateForm({ entry = null, state, helpers }) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  const editAttributes = entry ? ` data-update-edit-form data-update-id="${escapeHtml(entry.id)}"` : " data-update-create-form";
  return `<form class="member-update-form${entry ? " member-update-form--edit" : ""}"${editAttributes}>
    ${entry ? "" : `<h2>${escapeHtml(tt("members.updates.new"))}</h2>`}
    <label><span>${escapeHtml(tt("members.updates.title"))}</span><input name="summary" value="${escapeHtml(entry?.summary ?? "")}" required></label>
    <label><span>${escapeHtml(tt("members.updates.detail"))}</span><textarea name="detail">${escapeHtml(entry?.detail ?? "")}</textarea></label>
    <div class="member-update-form__actions">
      ${entry ? `<button type="button" class="member-domain-button member-domain-button--neutral" data-update-edit-cancel>${escapeHtml(tt("members.updates.cancel"))}</button>` : ""}
      <button type="submit" class="member-domain-button member-domain-button--primary">${escapeHtml(tt(entry ? "members.updates.save" : "members.updates.publish"))}</button>
    </div>
  </form>`;
}

function renderComment(comment, entryId, state, helpers) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  const canManage = canManageComment(comment, state);
  const isEditing = canManage && state.editingUpdateCommentId === comment.id;
  return `<article class="member-update-comment" data-update-comment="${escapeHtml(comment.id)}">
    <div><strong>${escapeHtml(comment.author || "—")}</strong><time>${escapeHtml(formatUpdateTimestamp(comment.createdAt || comment.time))}</time>${comment.edited ? `<span>${escapeHtml(tt("members.updates.edited"))} ${escapeHtml(formatUpdateTimestamp(comment.updatedAt))}</span>` : ""}</div>
    ${isEditing ? `<form class="member-update-comment__edit" data-update-comment-edit-form data-update-id="${escapeHtml(entryId)}" data-update-comment-id="${escapeHtml(comment.id)}">
      <label><span>${escapeHtml(tt("members.updates.editComment"))}</span><textarea name="body" required>${escapeHtml(state.editingUpdateCommentDraft)}</textarea></label>
      <div class="member-update-form__actions">
        <button type="button" class="member-domain-button member-domain-button--neutral" data-update-comment-edit-cancel>${escapeHtml(tt("members.updates.cancel"))}</button>
        <button type="submit" class="member-domain-button member-domain-button--primary">${escapeHtml(tt("members.updates.save"))}</button>
      </div>
    </form>` : `<p>${escapeHtml(comment.body || "")}</p>`}
    ${canManage && !isEditing ? `<div class="member-update-comment__actions">
      <button type="button" data-update-comment-edit="${escapeHtml(comment.id)}" data-update-id="${escapeHtml(entryId)}" aria-label="${escapeHtml(tt("members.updates.editComment"))}">✏</button>
      <button type="button" data-update-comment-delete="${escapeHtml(comment.id)}" data-update-id="${escapeHtml(entryId)}" aria-label="${escapeHtml(tt("members.updates.delete"))}">×</button>
    </div>` : ""}
  </article>`;
}

function canManageComment(comment, state) {
  if (state.access.canAdministerUpdateComments) return true;
  // Mirrors bizflow_samyung/team/src/views/UpdateLog.jsx:124; missing IDs never fall back to a same-name guess.
  const authorUserId = String(comment.authorUserId || "");
  return Boolean(authorUserId) && authorUserId === state.updateLogUser.id;
}

function renderUpdate(entry, state, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  if (state.access.canWriteUpdates && state.editingUpdateId === entry.id) return renderUpdateForm({ entry, state, helpers });
  return `<article class="member-update-card" data-update-log="${escapeHtml(entry.id)}">
    <header>
      <details>
        <summary><span>${escapeHtml(entry.summary)}</span></summary>
        <p>${escapeHtml(entry.detail || tt("members.updates.emptyDetail"))}</p>
      </details>
      ${state.access.canWriteUpdates ? `<div class="member-update-card__actions">
        <button type="button" data-update-edit="${escapeHtml(entry.id)}" aria-label="${escapeHtml(tt("members.updates.edit"))}">${icon("icon-edit-default", "icon icon--sm")}</button>
        <button type="button" data-update-delete="${escapeHtml(entry.id)}" aria-label="${escapeHtml(tt("members.updates.delete"))}">×</button>
      </div>` : ""}
    </header>
    <div class="member-update-card__meta"><strong>${escapeHtml(entry.author)}</strong><time>${escapeHtml(formatUpdateTimestamp(entry.createdAt))}</time>${entry.edited ? `<span>${escapeHtml(tt("members.updates.edited"))} ${escapeHtml(formatUpdateTimestamp(entry.updatedAt))}</span>` : ""}</div>
    <div class="member-update-comments__heading" aria-label="${escapeHtml(tt("members.updates.comment"))}">💬 ${entry.comments.length}</div>
    <div class="member-update-comments" data-update-comment-count="${entry.comments.length}">${sortUpdateCommentsOldestFirst(entry.comments).map((comment) => renderComment(comment, entry.id, state, helpers)).join("")}</div>
    <form class="member-update-comment-form" data-update-comment-form data-update-id="${escapeHtml(entry.id)}">
      <label><span>${escapeHtml(tt("members.updates.comment"))}</span><input name="body" placeholder="${escapeHtml(tt("members.updates.commentPlaceholder"))}" required></label>
      <button type="submit" class="member-domain-button member-domain-button--primary">${escapeHtml(tt("members.updates.addComment"))}</button>
    </form>
  </article>`;
}

export function renderMemberUpdateLogs({ state, helpers }) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  const tf = (key, values) => tt(key).replace(/\{(\w+)\}/g, (match, name) => String(values?.[name] ?? match));
  const visibleCount = Math.max(UPDATE_LOG_PAGE_SIZE, state.updateLogsVisibleCount || UPDATE_LOG_PAGE_SIZE);
  const visibleLogs = state.updateLogs.slice(0, visibleCount);
  const remaining = Math.max(0, state.updateLogs.length - visibleLogs.length);
  return `<section class="member-updates" data-member-updates data-update-count="${state.updateLogs.length}">
    ${state.access.canWriteUpdates ? renderUpdateForm({ state, helpers }) : ""}
    <div class="member-update-timeline">${visibleLogs.map((entry) => renderUpdate(entry, state, helpers)).join("")}</div>
    ${remaining ? `<button type="button" class="member-domain-button member-domain-button--neutral member-update-load-more" data-update-load-more>${escapeHtml(tt("members.updates.loadMore"))} · ${escapeHtml(tf("members.updates.remaining", { count: remaining }))}</button>` : ""}
  </section>`;
}

export function attachMemberUpdateLogController({ state, rerender, scope }) {
  let writePending = false;
  const runWrite = async (operation) => {
    if (writePending) return null;
    writePending = true;
    try {
      const result = await operation();
      return scope.isCurrent() ? result : null;
    } catch (error) {
      if (!scope.isCurrent()) return null;
      window.alert(error?.message || String(error));
      return null;
    } finally {
      writePending = false;
    }
  };

  scope.listen(document, "click", async (event) => {
    if (event.target.closest("[data-update-load-more]")) {
      state.updateLogsVisibleCount = Math.min(
        state.updateLogs.length,
        (state.updateLogsVisibleCount || UPDATE_LOG_PAGE_SIZE) + UPDATE_LOG_PAGE_SIZE
      );
      rerender();
      return;
    }
    const edit = event.target.closest("[data-update-edit]");
    if (edit) {
      if (!state.access.canWriteUpdates) return;
      state.editingUpdateId = edit.getAttribute("data-update-edit");
      rerender();
      return;
    }
    if (event.target.closest("[data-update-edit-cancel]")) {
      state.editingUpdateId = null;
      rerender();
      return;
    }
    const editComment = event.target.closest("[data-update-comment-edit]");
    if (editComment) {
      const entry = state.updateLogs.find((item) => item.id === editComment.getAttribute("data-update-id"));
      const comment = entry?.comments.find((item) => item.id === editComment.getAttribute("data-update-comment-edit"));
      if (!comment || !canManageComment(comment, state)) return;
      state.editingUpdateCommentId = comment.id;
      state.editingUpdateCommentDraft = comment.body || "";
      rerender();
      return;
    }
    if (event.target.closest("[data-update-comment-edit-cancel]")) {
      state.editingUpdateCommentId = null;
      state.editingUpdateCommentDraft = "";
      rerender();
      return;
    }
    const remove = event.target.closest("[data-update-delete]");
    if (remove && state.access.canWriteUpdates && await confirmInPage(memberT(document.documentElement.lang === "zh-Hant" ? "zh" : document.documentElement.lang, "members.updates.confirmDelete"), { danger: true })) {
      if (!scope.isCurrent()) return;
      const id = remove.getAttribute("data-update-delete");
      if (state.updateLogsLive && !await runWrite(() => deleteTeamUpdateLog(id))) return;
      state.updateLogs = state.updateLogs.filter((entry) => entry.id !== id);
      rerender();
      return;
    }
    const removeComment = event.target.closest("[data-update-comment-delete]");
    const entry = removeComment ? state.updateLogs.find((item) => item.id === removeComment.getAttribute("data-update-id")) : null;
    const comment = entry?.comments.find((item) => item.id === removeComment?.getAttribute("data-update-comment-delete"));
    if (removeComment && comment && canManageComment(comment, state) && await confirmInPage(memberT(document.documentElement.lang === "zh-Hant" ? "zh" : document.documentElement.lang, "members.updates.confirmDeleteComment"), { danger: true })) {
      if (!scope.isCurrent()) return;
      const id = removeComment.getAttribute("data-update-comment-delete");
      if (state.updateLogsLive && !await runWrite(() => deleteTeamUpdateComment(id))) return;
      if (entry) entry.comments = entry.comments.filter((item) => item.id !== id);
      if (state.editingUpdateCommentId === id) {
        state.editingUpdateCommentId = null;
        state.editingUpdateCommentDraft = "";
      }
      rerender();
    }
  });

  scope.listen(document, "submit", async (event) => {
    const createForm = event.target.closest("[data-update-create-form]");
    const editForm = event.target.closest("[data-update-edit-form]");
    const commentForm = event.target.closest("[data-update-comment-form]");
    const commentEditForm = event.target.closest("[data-update-comment-edit-form]");
    if (!createForm && !editForm && !commentForm && !commentEditForm) return;
    event.preventDefault();
    if ((createForm || editForm) && !state.access.canWriteUpdates) return;
    const values = new FormData(event.target);
    const summary = String(values.get("summary") || "").trim();
    const detail = String(values.get("detail") || "").trim();
    if (createForm) {
      const row = state.updateLogsLive
        ? await runWrite(() => createTeamUpdateLog({ summary, detail }))
        : { id: `local-update-${Date.now()}`, created_at: null };
      if (!scope.isCurrent()) return;
      if (!row) return;
      state.updateLogs.unshift({
        id: row.id,
        author: state.updateLogUser.name || "—",
        summary,
        detail,
        createdAt: formatUpdateTimestamp(row.created_at || new Date()),
        updatedAt: null,
        edited: false,
        comments: []
      });
    } else if (editForm) {
      const entry = state.updateLogs.find((item) => item.id === editForm.getAttribute("data-update-id"));
      if (entry) {
        const row = state.updateLogsLive
          ? await runWrite(() => updateTeamUpdateLog(entry.id, { summary, detail }))
          : { updated_at: null };
        if (!row) return;
        if (!scope.isCurrent()) return;
        entry.summary = summary;
        entry.detail = detail;
        entry.edited = true;
        entry.updatedAt = formatUpdateTimestamp(row.updated_at || new Date());
      }
      state.editingUpdateId = null;
    } else if (commentForm) {
      const entry = state.updateLogs.find((item) => item.id === commentForm.getAttribute("data-update-id"));
      if (entry) {
        const body = String(values.get("body") || "").trim();
        const row = state.updateLogsLive
          ? await runWrite(() => createTeamUpdateComment({ updateLogId: entry.id, authorName: state.updateLogUser.name || "—", body }))
          : { id: `local-comment-${Date.now()}` };
        if (!scope.isCurrent()) return;
        if (!row) return;
        const createdAt = formatUpdateTimestamp(row.created_at || new Date());
        entry.comments.push({
          id: row.id,
          authorUserId: state.updateLogUser.id || null,
          author: state.updateLogUser.name || "—",
          createdAt,
          time: createdAt,
          updatedAt: null,
          edited: false,
          body
        });
      }
    } else {
      const entry = state.updateLogs.find((item) => item.id === commentEditForm.getAttribute("data-update-id"));
      const comment = entry?.comments.find((item) => item.id === commentEditForm.getAttribute("data-update-comment-id"));
      const body = String(values.get("body") || "").trim();
      if (!comment || !canManageComment(comment, state) || !body) return;
      const row = state.updateLogsLive
        ? await runWrite(() => updateTeamUpdateComment(comment.id, body))
        : { updated_at: null };
      if (!row || !scope.isCurrent()) return;
      comment.body = body;
      comment.edited = true;
      comment.updatedAt = formatUpdateTimestamp(row.updated_at || new Date());
      state.editingUpdateCommentId = null;
      state.editingUpdateCommentDraft = "";
    }
    rerender();
  });
}
