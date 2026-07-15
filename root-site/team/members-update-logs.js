import { memberT } from "./members-i18n.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import {
  createTeamUpdateComment,
  createTeamUpdateLog,
  deleteTeamUpdateComment,
  deleteTeamUpdateLog,
  updateTeamUpdateLog
} from "../data/live-update-log-writes.js";

function localTimestamp() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}/${value.month}/${value.day} ${value.hour}:${value.minute}`;
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
  const canDelete = canDeleteComment(comment, state);
  return `<article class="member-update-comment" data-update-comment="${escapeHtml(comment.id)}">
    <div><strong>${escapeHtml(comment.author || "—")}</strong><time>${escapeHtml(comment.createdAt || comment.time || "—")}</time></div>
    <p>${escapeHtml(comment.body || "")}</p>
    ${canDelete ? `<button type="button" data-update-comment-delete="${escapeHtml(comment.id)}" data-update-id="${escapeHtml(entryId)}" aria-label="${escapeHtml(memberT(lang, "members.updates.delete"))}">×</button>` : ""}
  </article>`;
}

function canDeleteComment(comment, state) {
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
    <div class="member-update-card__meta"><strong>${escapeHtml(entry.author)}</strong><time>${escapeHtml(entry.createdAt)}</time>${entry.edited ? `<span>${escapeHtml(tt("members.updates.edited"))}</span>` : ""}</div>
    <div class="member-update-comments" data-update-comment-count="${entry.comments.length}">${entry.comments.map((comment) => renderComment(comment, entry.id, state, helpers)).join("")}</div>
    <form class="member-update-comment-form" data-update-comment-form data-update-id="${escapeHtml(entry.id)}">
      <label><span>${escapeHtml(tt("members.updates.comment"))}</span><input name="body" placeholder="${escapeHtml(tt("members.updates.commentPlaceholder"))}" required></label>
      <button type="submit" class="member-domain-button member-domain-button--primary">${escapeHtml(tt("members.updates.addComment"))}</button>
    </form>
  </article>`;
}

export function renderMemberUpdateLogs({ state, helpers }) {
  return `<section class="member-updates" data-member-updates data-update-count="${state.updateLogs.length}">
    ${state.access.canWriteUpdates ? renderUpdateForm({ state, helpers }) : ""}
    <div class="member-update-timeline">${state.updateLogs.map((entry) => renderUpdate(entry, state, helpers)).join("")}</div>
  </section>`;
}

export function attachMemberUpdateLogController({ state, rerender }) {
  let writePending = false;
  const runWrite = async (operation) => {
    if (writePending) return null;
    writePending = true;
    try {
      return await operation();
    } catch (error) {
      window.alert(error?.message || String(error));
      return null;
    } finally {
      writePending = false;
    }
  };

  document.addEventListener("click", async (event) => {
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
    const remove = event.target.closest("[data-update-delete]");
    if (remove && state.access.canWriteUpdates && await confirmInPage(memberT(document.documentElement.lang === "zh-Hant" ? "zh" : document.documentElement.lang, "members.updates.confirmDelete"), { danger: true })) {
      const id = remove.getAttribute("data-update-delete");
      if (state.updateLogsLive && !await runWrite(() => deleteTeamUpdateLog(id))) return;
      state.updateLogs = state.updateLogs.filter((entry) => entry.id !== id);
      rerender();
      return;
    }
    const removeComment = event.target.closest("[data-update-comment-delete]");
    const entry = removeComment ? state.updateLogs.find((item) => item.id === removeComment.getAttribute("data-update-id")) : null;
    const comment = entry?.comments.find((item) => item.id === removeComment?.getAttribute("data-update-comment-delete"));
    if (removeComment && comment && canDeleteComment(comment, state) && await confirmInPage(memberT(document.documentElement.lang === "zh-Hant" ? "zh" : document.documentElement.lang, "members.updates.confirmDeleteComment"), { danger: true })) {
      const id = removeComment.getAttribute("data-update-comment-delete");
      if (state.updateLogsLive && !await runWrite(() => deleteTeamUpdateComment(id))) return;
      if (entry) entry.comments = entry.comments.filter((item) => item.id !== id);
      rerender();
    }
  });

  document.addEventListener("submit", async (event) => {
    const createForm = event.target.closest("[data-update-create-form]");
    const editForm = event.target.closest("[data-update-edit-form]");
    const commentForm = event.target.closest("[data-update-comment-form]");
    if (!createForm && !editForm && !commentForm) return;
    event.preventDefault();
    if ((createForm || editForm) && !state.access.canWriteUpdates) return;
    const values = new FormData(event.target);
    const summary = String(values.get("summary") || "").trim();
    const detail = String(values.get("detail") || "").trim();
    if (createForm) {
      const row = state.updateLogsLive
        ? await runWrite(() => createTeamUpdateLog({ summary, detail }))
        : { id: `local-update-${Date.now()}`, created_at: null };
      if (!row) return;
      state.updateLogs.unshift({
        id: row.id,
        author: state.updateLogUser.name || "—",
        summary,
        detail,
        createdAt: localTimestamp(),
        edited: false,
        comments: []
      });
    } else if (editForm) {
      const entry = state.updateLogs.find((item) => item.id === editForm.getAttribute("data-update-id"));
      if (entry) {
        if (state.updateLogsLive && !await runWrite(() => updateTeamUpdateLog(entry.id, { summary, detail }))) return;
        entry.summary = summary;
        entry.detail = detail;
        entry.edited = true;
      }
      state.editingUpdateId = null;
    } else {
      const entry = state.updateLogs.find((item) => item.id === commentForm.getAttribute("data-update-id"));
      if (entry) {
        const body = String(values.get("body") || "").trim();
        const row = state.updateLogsLive
          ? await runWrite(() => createTeamUpdateComment({ updateLogId: entry.id, authorName: state.updateLogUser.name || "—", body }))
          : { id: `local-comment-${Date.now()}` };
        if (!row) return;
        entry.comments.unshift({
          id: row.id,
          authorUserId: state.updateLogUser.id || null,
          author: state.updateLogUser.name || "—",
          createdAt: localTimestamp(),
          body
        });
      }
    }
    rerender();
  });
}
