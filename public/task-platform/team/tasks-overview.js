import { taskT } from "./tasks-i18n.js";
import { overviewForMember } from "./tasks-model.js";

function renderTaskRow(row, helpers, completed = false) {
  const { escapeHtml, lang } = helpers;
  const task = row.task;
  const completedAt = row.assignee?.completedAt || task.completedAt;
  return `<button type="button" class="task-overview__task${completed ? " task-overview__task--completed" : ""}" data-task-detail-open="${escapeHtml(task.id)}">
    <span title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
    <small>${escapeHtml(completed ? `${taskT(lang, "tasks.overview.doneAt")} ${completedAt || "—"}` : task.due || "—")}</small>
  </button>`;
}

export function renderTaskOverview({ members, tasks, expanded, helpers }) {
  const { escapeHtml, icon, lang } = helpers;
  const rows = members.filter((member) => member.dept !== "all").map((member) => {
    const summary = overviewForMember(member, tasks);
    // 煊煊已拍(2026-07-12):完成计数保留全量，渲染最多 5 条，故意优于现网截断后的计数。
    const visibleCompleted = summary.recentlyCompleted.slice(0, 5);
    const isExpanded = expanded.has(member.id || member.name);
    const groups = ["high", "medium", "low"].map((priority) => {
      const list = summary.groups[priority];
      if (!list.length) return "";
      return `<section class="task-overview__group task-overview__group--${priority}"><h4>${escapeHtml(taskT(lang, `tasks.priority.${priority}`))}<span>${list.length}</span></h4>${list.map((row) => renderTaskRow(row, helpers)).join("")}</section>`;
    }).join("");
    return `<article class="task-overview__member" data-overview-member="${escapeHtml(member.id || member.name)}" data-open-count="${summary.open.length}" data-completed-count="${summary.completedCount}">
      <button type="button" class="task-overview__member-head" data-overview-toggle="${escapeHtml(member.id || member.name)}" aria-expanded="${isExpanded}">
        ${icon("icon-arrow-down", "icon task-overview__chevron")}<span class="avatar--initial">${escapeHtml(String(member.name || "?").slice(0, 1).toUpperCase())}</span><strong>${escapeHtml(member.name)}</strong>
        <span class="task-overview__count task-overview__count--open">${summary.open.length} ${escapeHtml(taskT(lang, "tasks.overview.open"))}</span>
        <span class="task-overview__count task-overview__count--done">${summary.completedCount} ${escapeHtml(taskT(lang, "tasks.overview.completed"))}</span>
      </button>
      ${isExpanded ? `<div class="task-overview__member-body">${groups || `<p>${escapeHtml(taskT(lang, "tasks.overview.noOpen"))}</p>`}${visibleCompleted.length ? `<section class="task-overview__recent"><h4>${escapeHtml(taskT(lang, "tasks.overview.recent"))}<span>${summary.completedCount}</span></h4>${visibleCompleted.map((row) => renderTaskRow(row, helpers, true)).join("")}</section>` : ""}</div>` : ""}
    </article>`;
  }).join("");
  return `<section class="task-overview" data-task-overview data-member-count="${members.filter((member) => member.dept !== "all").length}"><h2>${escapeHtml(taskT(lang, "tasks.overview.title"))}</h2><div>${rows}</div></section>`;
}
