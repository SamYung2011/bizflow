import { memberT } from "./members-i18n.js";

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
    <label><span>${escapeHtml(tt("members.updates.title"))}</span><input name="summary" value="${escapeHtml(entry?.summary ?? "")}" required${state.liveReadOnly ? " disabled" : ""}></label>
    <label><span>${escapeHtml(tt("members.updates.detail"))}</span><textarea name="detail"${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(entry?.detail ?? "")}</textarea></label>
    <div class="member-update-form__actions">
      ${entry ? `<button type="button" class="member-domain-button member-domain-button--neutral" data-update-edit-cancel>${escapeHtml(tt("members.updates.cancel"))}</button>` : ""}
      <button type="submit" class="member-domain-button member-domain-button--primary"${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(tt(entry ? "members.updates.save" : "members.updates.publish"))}</button>
    </div>
  </form>`;
}

function renderComment(comment, entryId, state, helpers) {
  const { escapeHtml, lang } = helpers;
  const canDelete = canDeleteComment(comment, state);
  return `<article class="member-update-comment" data-update-comment="${escapeHtml(comment.id)}">
    <div><strong>${escapeHtml(comment.author || "—")}</strong><time>${escapeHtml(comment.createdAt || comment.time || "—")}</time></div>
    <p>${escapeHtml(comment.body || "")}</p>
    ${canDelete ? `<button type="button" data-update-comment-delete="${escapeHtml(comment.id)}" data-update-id="${escapeHtml(entryId)}" aria-label="${escapeHtml(memberT(lang, "members.updates.delete"))}"${state.liveReadOnly ? " disabled" : ""}>×</button>` : ""}
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
        <button type="button" data-update-edit="${escapeHtml(entry.id)}" aria-label="${escapeHtml(tt("members.updates.edit"))}"${state.liveReadOnly ? " disabled" : ""}>${icon("icon-edit-default", "icon icon--sm")}</button>
        <button type="button" data-update-delete="${escapeHtml(entry.id)}" aria-label="${escapeHtml(tt("members.updates.delete"))}"${state.liveReadOnly ? " disabled" : ""}>×</button>
      </div>` : ""}
    </header>
    <div class="member-update-card__meta"><strong>${escapeHtml(entry.author)}</strong><time>${escapeHtml(entry.createdAt)}</time>${entry.edited ? `<span>${escapeHtml(tt("members.updates.edited"))}</span>` : ""}</div>
    <div class="member-update-comments" data-update-comment-count="${entry.comments.length}">${entry.comments.map((comment) => renderComment(comment, entry.id, state, helpers)).join("")}</div>
    <form class="member-update-comment-form" data-update-comment-form data-update-id="${escapeHtml(entry.id)}">
      <label><span>${escapeHtml(tt("members.updates.comment"))}</span><input name="body" placeholder="${escapeHtml(tt("members.updates.commentPlaceholder"))}" required${state.liveReadOnly ? " disabled" : ""}></label>
      <button type="submit" class="member-domain-button member-domain-button--primary"${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(tt("members.updates.addComment"))}</button>
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
  // 现网发布权属于 Helen/admin；静态复刻只做本地 state，不写生产库。
  document.addEventListener("click", (event) => {
    if (state.liveReadOnly && event.target.closest("[data-update-edit], [data-update-edit-cancel], [data-update-delete], [data-update-comment-delete]")) return;
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
    if (remove && state.access.canWriteUpdates && window.confirm(memberT(document.documentElement.lang === "zh-Hant" ? "zh" : document.documentElement.lang, "members.updates.confirmDelete"))) {
      state.updateLogs = state.updateLogs.filter((entry) => entry.id !== remove.getAttribute("data-update-delete"));
      rerender();
      return;
    }
    const removeComment = event.target.closest("[data-update-comment-delete]");
    const entry = removeComment ? state.updateLogs.find((item) => item.id === removeComment.getAttribute("data-update-id")) : null;
    const comment = entry?.comments.find((item) => item.id === removeComment?.getAttribute("data-update-comment-delete"));
    if (removeComment && comment && canDeleteComment(comment, state) && window.confirm(memberT(document.documentElement.lang === "zh-Hant" ? "zh" : document.documentElement.lang, "members.updates.confirmDeleteComment"))) {
      if (entry) entry.comments = entry.comments.filter((comment) => comment.id !== removeComment.getAttribute("data-update-comment-delete"));
      rerender();
    }
  });

  document.addEventListener("submit", (event) => {
    const createForm = event.target.closest("[data-update-create-form]");
    const editForm = event.target.closest("[data-update-edit-form]");
    const commentForm = event.target.closest("[data-update-comment-form]");
    if (!createForm && !editForm && !commentForm) return;
    event.preventDefault();
    if (state.liveReadOnly) return;
    if ((createForm || editForm) && !state.access.canWriteUpdates) return;
    const values = new FormData(event.target);
    if (createForm) {
      state.updateLogs.unshift({
        id: `local-update-${Date.now()}`,
        author: state.updateLogUser.name || "—",
        summary: String(values.get("summary") || "").trim(),
        detail: String(values.get("detail") || "").trim(),
        createdAt: localTimestamp(),
        edited: false,
        comments: []
      });
    } else if (editForm) {
      const entry = state.updateLogs.find((item) => item.id === editForm.getAttribute("data-update-id"));
      if (entry) {
        entry.summary = String(values.get("summary") || "").trim();
        entry.detail = String(values.get("detail") || "").trim();
        entry.edited = true;
      }
      state.editingUpdateId = null;
    } else {
      const entry = state.updateLogs.find((item) => item.id === commentForm.getAttribute("data-update-id"));
      if (entry) {
        entry.comments.unshift({
          id: `local-comment-${Date.now()}`,
          authorUserId: state.updateLogUser.id || null,
          author: state.updateLogUser.name || "—",
          createdAt: localTimestamp(),
          body: String(values.get("body") || "").trim()
        });
      }
    }
    rerender();
  });
}
