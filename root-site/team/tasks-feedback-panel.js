import { taskT } from "./tasks-i18n.js";
import { isOpenTask, isTaskAssignedTo, isTaskMentionedForMember, memberIdentity, taskMatchesMemberStatus } from "./tasks-model.js";

const RECENT_FEEDBACK_LIMIT = 5;

function feedbackTimestampValue(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const short = text.match(/^(\d{2})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (short) {
    return Date.UTC(2000 + Number(short[1]), Number(short[2]) - 1, Number(short[3]), Number(short[4] || 0), Number(short[5] || 0));
  }
  const normalized = text
    .replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/, "$1-$2-$3")
    .replace(/^(\d{4}-\d{1,2}-\d{1,2})\s+/, "$1T");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortedTaskFeedback(task) {
  return [...(task.feedback ?? [])].sort((left, right) =>
    feedbackTimestampValue(left.timestamp) - feedbackTimestampValue(right.timestamp) ||
    String(left.id || "").localeCompare(String(right.id || "")));
}

function feedbackMentionsMember(task, feedback, member) {
  return isTaskMentionedForMember({ ...task, feedback: [feedback] }, member);
}

export function taskFeedbackPanelEntriesForMember(member, tasks) {
  if (!member || memberIdentity(member) === "") return [];
  return (tasks ?? []).map((task) => {
    if (!isOpenTask(task)) return null;
    const assigned = isTaskAssignedTo(task, member);
    const assignedInProgress = assigned && taskMatchesMemberStatus(task, member, "inProgress");
    const mentioned = !assigned && isTaskMentionedForMember(task, member);
    if (!assignedInProgress && !mentioned) return null;

    const feedback = sortedTaskFeedback(task);
    if (!feedback.length) return null;
    const summaryCandidates = mentioned
      ? feedback.filter((entry) => feedbackMentionsMember(task, entry, member))
      : feedback;
    const latestFeedback = summaryCandidates.at(-1);
    if (!latestFeedback) return null;
    return {
      task,
      source: mentioned ? "mention" : "task",
      latestFeedback,
      recentFeedback: feedback.slice(-RECENT_FEEDBACK_LIMIT),
      feedbackCount: feedback.length,
      latestAt: feedbackTimestampValue(latestFeedback.timestamp)
    };
  }).filter(Boolean).sort((left, right) =>
    right.latestAt - left.latestAt || String(left.task.id).localeCompare(String(right.task.id)));
}

function feedbackMessage(entry, lang) {
  const message = String(entry.message || "").trim();
  if (message) return message;
  if (entry.messageKey) return taskT(lang, entry.messageKey);
  return taskT(lang, "tasks.feedbackPanel.attachmentOnly", { count: entry.attachmentCount ?? entry.attachments?.length ?? 0 });
}

function renderFeedbackMeta(entry, helpers) {
  const { escapeHtml, lang } = helpers;
  const author = entry.author || taskT(lang, "tasks.feedbackPanel.unknownAuthor");
  return `<span class="task-feedback-panel__meta"><strong title="${escapeHtml(author)}">${escapeHtml(author)}</strong><time>${escapeHtml(entry.timestamp || "")}</time></span>`;
}

function renderRecentFeedback(entry, helpers) {
  const { escapeHtml, lang } = helpers;
  return `<button type="button" class="task-feedback-panel__recent-entry" data-task-detail-open="${escapeHtml(entry.taskId)}" data-task-feedback-panel-open>
    ${renderFeedbackMeta(entry, helpers)}
    <span>${escapeHtml(feedbackMessage(entry, lang))}</span>
  </button>`;
}

function renderFeedbackTaskEntry(entry, expandedTaskIds, member, helpers) {
  const { escapeHtml, lang } = helpers;
  const { task, latestFeedback, recentFeedback, feedbackCount } = entry;
  const expanded = expandedTaskIds?.has(String(task.id)) === true;
  const canExpand = feedbackCount > 1;
  const openLabel = `${taskT(lang, "tasks.detail.open")}: ${task.title}`;
  const recent = recentFeedback.map((feedback) => renderRecentFeedback({ ...feedback, taskId: task.id }, helpers)).join("");
  return `<article class="task-feedback-panel__entry" data-task-feedback-entry="${escapeHtml(task.id)}" data-task-feedback-source="${escapeHtml(entry.source)}">
    <header>
      ${canExpand ? `<button type="button" class="task-feedback-panel__toggle" data-task-feedback-panel-toggle="${escapeHtml(task.id)}" aria-expanded="${expanded}" aria-label="${escapeHtml(taskT(lang, expanded ? "tasks.feedbackPanel.collapse" : "tasks.feedbackPanel.expand"))}">${expanded ? "▼" : "▶"}</button>` : `<span class="task-feedback-panel__toggle-placeholder" aria-hidden="true"></span>`}
      <button type="button" class="task-feedback-panel__title" data-task-detail-open="${escapeHtml(task.id)}" data-task-feedback-panel-open title="${escapeHtml(openLabel)}">${escapeHtml(task.title)}</button>
      ${entry.source === "mention" ? `<span class="task-mention-pill" data-task-mention="${escapeHtml(member.userId || "")}">${escapeHtml(taskT(lang, "tasks.card.mentioned"))}</span>` : ""}
      ${feedbackCount > 1 ? `<span class="task-feedback-panel__count">${feedbackCount}</span>` : ""}
    </header>
    <button type="button" class="task-feedback-panel__summary" data-task-detail-open="${escapeHtml(task.id)}" data-task-feedback-panel-open aria-label="${escapeHtml(openLabel)}">
      ${renderFeedbackMeta(latestFeedback, helpers)}
      <span class="task-feedback-panel__message">${escapeHtml(feedbackMessage(latestFeedback, lang))}</span>
    </button>
    ${expanded ? `<div class="task-feedback-panel__recent" data-task-feedback-panel-recent="${escapeHtml(task.id)}">${recent}</div>` : ""}
  </article>`;
}

export function renderTaskFeedbackPanel({ member, tasks, expandedTaskIds = new Set(), helpers }) {
  const { escapeHtml, lang } = helpers;
  const entries = taskFeedbackPanelEntriesForMember(member, tasks);
  return `<section class="task-feedback-panel" data-task-feedback-panel data-task-feedback-member="${escapeHtml(memberIdentity(member))}" data-task-feedback-count="${entries.length}">
    <header class="task-feedback-panel__head"><h2>💬 ${escapeHtml(taskT(lang, "tasks.feedbackPanel.title"))}</h2><span>${entries.length}</span></header>
    <div class="task-feedback-panel__list">
      ${entries.length
        ? entries.map((entry) => renderFeedbackTaskEntry(entry, expandedTaskIds, member, helpers)).join("")
        : `<p class="task-feedback-panel__empty">${escapeHtml(taskT(lang, "tasks.feedbackPanel.empty"))}</p>`}
    </div>
  </section>`;
}
