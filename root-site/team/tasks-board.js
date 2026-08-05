import { taskT } from "./tasks-i18n.js";
import { filterTaskColumns, renderTaskFilter } from "./tasks-filters.js";
import { renderTaskActionPopover } from "./tasks-actions.js";
import { isTaskCreator, isTaskMentionOnlyForMember, isTaskMentionedForMember, isWaitingApproval, memberIdentity, scopedTopTasks, taskAssignee, taskCompletionForMember, taskDuePresentation, taskReadFingerprintRootId, taskSubtaskProgress, terminalTasksForMember } from "./tasks-model.js";

function renderTaskDue(task, helpers) {
  const { escapeHtml, lang } = helpers;
  const due = task.due || taskT(lang, "tasks.detail.emptyValue");
  const presentation = taskDuePresentation(task);
  if (presentation.tone === "overdue") {
    return `<span class="team-task-card__due team-task-card__due--overdue">⚠ ${escapeHtml(due)} (${escapeHtml(taskT(lang, "tasks.card.overdue", { days: presentation.days }))})</span>`;
  }
  if (presentation.tone === "soon") {
    return `<span class="team-task-card__due team-task-card__due--soon">⏰ ${escapeHtml(due)} (${escapeHtml(taskT(lang, "tasks.card.dueSoon", { days: presentation.days }))})</span>`;
  }
  if (presentation.tone === "none") {
    return `<span class="team-task-card__due">${escapeHtml(due)}</span>`;
  }
  return `<span class="team-task-card__due">⏰ ${escapeHtml(due)}</span>`;
}

function renderTaskCard(task, columnKey, state, mentionMember, helpers) {
  const { escapeHtml, lang } = helpers;
  const actionOpen = state.actionTaskId === task.id;
  const hasBadge = task.countBadge !== "" && task.countBadge != null;
  const subtaskProgress = taskSubtaskProgress(task);
  const waitingApproval = isWaitingApproval(task);
  const mentioned = isTaskMentionedForMember(task, mentionMember);
  const completion = taskCompletionForMember(task, state.currentUser);
  // 终态卡 ✓ 前缀:与 tasks-calendar.js taskCalendarLabel 的既有终态标记同源(件2,沿用现有终态卡样式)。
  const titlePrefix = completion.checked ? "✓ " : "";
  const parent = task.parentId ? state.tasks.find((candidate) => candidate.id === task.parentId) : null;
  const assignedBy = task.creator && !isTaskCreator(task, mentionMember);
  const assignees = (task.assignees ?? []).length > 1
    ? task.assignees.map((assignee) => `<span class="${assignee.completedAt ? "is-completed" : ""}" title="${escapeHtml(assignee.completedAt || assignee.name)}">${assignee.completedAt ? "✓ " : ""}${escapeHtml(assignee.name)}</span>`).join("")
    : "";
  const ownTask = isTaskCreator(task, state.currentUser);
  const assigned = taskAssignee(task, state.currentUser) !== null;
  const canOpenActions = ownTask || assigned || state.permissions.canCreate || state.permissions.canEditOthers || state.permissions.canDeleteOthers;
  return `<article class="team-task-card team-task-card--${columnKey}${completion.checked ? " team-task-card--completed" : ""}${task.status === "abandoned" ? " team-task-card--abandoned" : ""}${actionOpen ? " team-task-card--action-open" : ""}" data-task-card="${escapeHtml(task.id)}">
    <button type="button" class="team-task-card__body" data-task-detail-open="${escapeHtml(task.id)}" aria-label="${escapeHtml(`${taskT(lang, "tasks.detail.open")}: ${task.title}`)}">
      ${parent ? `<span class="team-task-card__parent" title="${escapeHtml(parent.title)}">↳ ${escapeHtml(parent.title)}</span>` : ""}
      <h3 class="team-task-card__title" title="${escapeHtml(task.title)}">${titlePrefix}${escapeHtml(task.title)}</h3>
      <div class="team-task-card__meta"><span>${escapeHtml(taskT(lang, "tasks.due"))}</span>${renderTaskDue(task, helpers)}</div>
      <div class="team-task-card__meta"><span>${escapeHtml(taskT(lang, "tasks.owner"))}</span><span title="${escapeHtml(task.owner)}">${escapeHtml(task.owner)}</span></div>
      <div class="team-task-card__signals">
        ${subtaskProgress.total ? `<span title="${escapeHtml(taskT(lang, "tasks.card.subtasks"))}">☑ ${subtaskProgress.done}/${subtaskProgress.total}</span>` : ""}
        ${task.attachmentCount > 0 ? `<span title="${escapeHtml(taskT(lang, "tasks.card.attachments"))}">📎 ${task.attachmentCount}</span>` : ""}
        ${task.feedback.length ? `<span title="${escapeHtml(taskT(lang, "tasks.card.feedback"))}">💬 ${task.feedback.length}</span>` : ""}
        ${assignedBy ? `<span class="task-assigned-pill" data-task-assigned-by="${escapeHtml(task.creatorId || task.creator)}">${escapeHtml(taskT(lang, "tasks.card.assignedBy", { name: task.creator }))}</span>` : ""}
        ${mentioned ? `<span class="task-mention-pill" data-task-mention="${escapeHtml(mentionMember.userId)}">${escapeHtml(taskT(lang, "tasks.card.mentioned"))}</span>` : ""}
        ${task.visibility === "department" ? `<span class="team-task-card__department">${escapeHtml(task.visibilityDepartment || taskT(lang, "tasks.card.department"))}</span>` : ""}
      </div>
      ${assignees ? `<div class="team-task-card__assignees">${assignees}</div>` : ""}
      ${waitingApproval ? `<span class="team-task-card__approval">${escapeHtml(taskT(lang, "tasks.card.waitingApproval", { name: task.creator }))}</span>` : ""}
    </button>
    <div class="team-task-card__actions">
      <span class="team-count-badge${hasBadge ? "" : " team-count-badge--empty"}" aria-hidden="${hasBadge ? "false" : "true"}">${escapeHtml(hasBadge ? task.countBadge : "0")}</span>
      ${canOpenActions ? `<button type="button" class="team-more-button" data-task-action-open="${escapeHtml(task.id)}" aria-haspopup="menu" aria-expanded="${actionOpen}" aria-label="${escapeHtml(`${taskT(lang, "tasks.action.open")}: ${task.title}`)}"><span></span><span></span><span></span></button>` : ""}
    </div>
    ${renderTaskActionPopover({ task, open: actionOpen, state, helpers })}
  </article>`;
}

// 件2 (2026-08-04 Figma 对稿拆除令): .task-terminal-groups 两条杠拆除,改为每个优先级列底部一个
// ⌄ 圆钮——沿用现有终态卡样式(renderTaskCard 本身已带 ✓ 前缀/删除线),按列归并 放弃+完成。
// (件A 2026-08-05: 卡片堆容器抽成通用函数,「僅提及」分界线下的卡片复用同一容器/样式。)
function renderColumnCollapsedTasks(tasks, columnKey, state, mentionMember, helpers) {
  const cards = tasks.map((task) => renderTaskCard(task, columnKey, state, mentionMember, helpers)).join("");
  return cards ? `<div class="team-kanban-column__terminal-tasks">${cards}</div>` : "";
}

// 895148a 分界线组件本体(细线+居中字+计数,点击开合),件A 起被终态分界线和「僅提及」分界线共用:
// 同一套 .team-column-terminal-divider 样式,各自的 data 属性/开合状态/文案由调用方给。
function renderColumnDivider({ toggleAttribute, columnKey, expanded, summary, actionLabel, helpers }) {
  const { escapeHtml } = helpers;
  return `<button type="button" class="team-column-terminal-divider${expanded ? " team-column-terminal-divider--open" : ""}" ${toggleAttribute}="${escapeHtml(columnKey)}" aria-expanded="${expanded}" aria-label="${escapeHtml(actionLabel)}" title="${escapeHtml(actionLabel)}">
    <span class="team-column-terminal-divider__label">${escapeHtml(summary)}</span>
  </button>`;
}

// 件1 (2026-08-04 煊煊拍板「已完成怎么会出现在列表里？很乱...我宁愿你搞个分界线。点击分界线才
// 显示已完成」): 拆掉 67532b1 的列底圆形 ⌄ 按钮,改成活任务下方一条分界线(细线+居中「已完成 N ·
// 已放棄 N」),只在该列真有终态任务时才渲染;点击展开线下方终态卡,再点收起,复用既有
// boardExpandedTerminalPriorities 状态,不新增并行状态。
function renderColumnTerminalDivider(terminal, column, terminalExpanded, helpers) {
  const { lang } = helpers;
  const completedCount = terminal.completed.length;
  const abandonedCount = terminal.abandoned.length;
  const terminalCount = completedCount + abandonedCount;
  if (terminalCount === 0) return "";
  return renderColumnDivider({
    toggleAttribute: "data-task-column-terminal-toggle",
    columnKey: column.key,
    expanded: terminalExpanded,
    summary: taskT(lang, "tasks.column.terminalSummary", { completed: completedCount, abandoned: abandonedCount }),
    actionLabel: taskT(lang, terminalExpanded ? "tasks.column.terminalCollapse" : "tasks.column.terminalExpand", { count: terminalCount }),
    helpers
  });
}

// 件A (2026-08-05 煊煊拍板): 「僅提及」分界线——mention-only(既非 assignee 也非 creator,只因被 @
// 而可见)且按 tp-task-board-read-v1 指纹已「看过」的任务,像已完成一样收进线下,点击展开;没看过的
// 照常留在上面的活任务列表里(分桶在 renderTaskBoardGrid)。零收纳时整条线不渲染,与终态分界线一致。
function renderColumnMentionDivider(mentionTasks, column, mentionExpanded, helpers) {
  const { lang } = helpers;
  if (mentionTasks.length === 0) return "";
  return renderColumnDivider({
    toggleAttribute: "data-task-column-mention-toggle",
    columnKey: column.key,
    expanded: mentionExpanded,
    summary: taskT(lang, "tasks.column.mentionSummary", { count: mentionTasks.length }),
    actionLabel: taskT(lang, mentionExpanded ? "tasks.column.mentionCollapse" : "tasks.column.mentionExpand", { count: mentionTasks.length }),
    helpers
  });
}

function renderColumn(column, state, filterState, mentionMember, helpers, terminalByColumn) {
  const { escapeHtml, icon, lang } = helpers;
  const title = taskT(lang, `tasks.priority.${column.key}`);
  const emptyKey = filterState.status === "completed"
    ? "tasks.empty.completed"
    : filterState.status === "abandoned"
      ? "tasks.empty.abandoned"
      : filterState.status === "overdue" ? "tasks.empty.overdue" : "tasks.empty.default";
  const expanded = state.boardExpandedPriorities?.has(column.key) === true;
  const visibleTasks = expanded ? column.tasks : column.tasks.slice(0, 5);
  const hiddenCount = Math.max(0, column.tasks.length - visibleTasks.length);
  const body = visibleTasks.length
    ? visibleTasks.map((task) => renderTaskCard(task, column.key, state, mentionMember, helpers)).join("")
    : `<p class="team-kanban-empty">${escapeHtml(taskT(lang, emptyKey))}</p>`;
  const unreadCount = column.tasks.filter((task) => state.boardUnreadTaskIds?.has(task.id)).length;
  const unreadLabel = taskT(lang, "tasks.column.unreadChanges", { count: unreadCount });
  // 只在「进行中任务」状态筛选下出现:切到「已完成/已放弃」等状态筛选时,列本身已经在展示对应
  // 终态任务,不需要再叠一层折叠入口(与旧 .task-terminal-groups 的可见性判定一致)。
  const showTerminalToggle = filterState.status === "inProgress";
  const terminal = terminalByColumn?.[column.key] ?? { completed: [], abandoned: [] };
  const terminalExpanded = state.boardExpandedTerminalPriorities?.has(column.key) === true;
  const terminalDividerHtml = showTerminalToggle ? renderColumnTerminalDivider(terminal, column, terminalExpanded, helpers) : "";
  const terminalTasksHtml = terminalExpanded
    ? renderColumnCollapsedTasks([...terminal.abandoned, ...terminal.completed], column.key, state, mentionMember, helpers)
    : "";
  // 件A: 「僅提及」分界线排在终态分界线上方——收纳的仍是进行中的任务,归活动区尾部;终态区保持最后。
  const mentionTasks = column.mentionSeen ?? [];
  const mentionExpanded = state.boardExpandedMentionPriorities?.has(column.key) === true;
  const mentionDividerHtml = renderColumnMentionDivider(mentionTasks, column, mentionExpanded, helpers);
  const mentionTasksHtml = mentionExpanded
    ? renderColumnCollapsedTasks(mentionTasks, column.key, state, mentionMember, helpers)
    : "";
  return `<section class="team-kanban-column team-kanban-column--${column.key}" data-task-column="${column.key}" data-column-count="${column.count}">
    <header class="team-kanban-column__head" data-task-column-read="${column.key}"><div class="team-kanban-column__title"><span title="${escapeHtml(title)}">${escapeHtml(title)}</span><span>${column.count}</span></div>${unreadCount > 0 ? `<span class="team-count-badge team-count-badge--unread" data-task-column-unread="${unreadCount}" aria-label="${escapeHtml(unreadLabel)}" title="${escapeHtml(unreadLabel)}">${unreadCount}</span>` : ""}</header>
    <div class="team-kanban-column__tasks">${body}</div>
    ${mentionDividerHtml}
    ${mentionTasksHtml}
    ${terminalDividerHtml}
    ${terminalTasksHtml}
    <div class="team-kanban-column__footer">
      ${column.tasks.length > 5 ? `<button type="button" class="team-column-expand${expanded ? " team-column-expand--open" : ""}" data-task-column-expand="${column.key}" aria-expanded="${expanded}" aria-label="${escapeHtml(taskT(lang, expanded ? "tasks.column.collapse" : "tasks.column.expand", { count: hiddenCount }))}" title="${escapeHtml(taskT(lang, expanded ? "tasks.column.collapse" : "tasks.column.expand", { count: hiddenCount }))}">${icon("icon-arrow-down")}${icon("icon-arrow-down")}</button>` : ""}
      ${state.permissions.canCreate ? `<button type="button" class="team-column-add" data-task-column-add="${column.key}" aria-label="${escapeHtml(taskT(lang, "tasks.column.add", { priority: title }))}" title="${escapeHtml(taskT(lang, "tasks.column.add", { priority: title }))}"${state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites) ? " disabled aria-disabled=\"true\"" : ""}>${icon("icon-add-surface-add")}</button>` : ""}
    </div>
  </section>`;
}

export function renderTaskBoardGrid({ state, filterState, helpers }) {
  const scopedMember = filterState.member === "all"
    ? null
    : state.members.find((member) => memberIdentity(member) === filterState.member) ?? null;
  const scopedTasks = scopedTopTasks(state.tasks, {
    onlyMine: state.onlyMine,
    currentUser: state.currentUser,
    member: scopedMember
  });
  const scopedBoard = state.board.map((column) => ({
    ...column,
    tasks: scopedTasks.filter((task) => task.priority === column.key)
  }));
  const columns = filterTaskColumns(scopedBoard, filterState, {
    mobile: matchMedia("(max-width: 768px)").matches,
    members: state.members
  });
  const mentionMember = scopedMember ?? state.currentUser;
  // 每列各自的终态(完成+放弃)任务,180 天窗口 + 父任务未 open 不显终态子任务两条语义全部挪用
  // terminalTasksForMember 现有实现(见 tasks-model.js),只是按 column.key 重新分桶给各列的 ⌄ 用。
  let terminalByColumn = {};
  if (filterState.status === "inProgress") {
    const terminalSource = state.onlyMine
      ? state.tasks.filter((task) => isTaskCreator(task, state.currentUser))
      : state.tasks;
    const terminal = terminalTasksForMember(mentionMember, terminalSource);
    terminalByColumn = Object.fromEntries(state.board.map((column) => [column.key, {
      completed: terminal.completed.filter((task) => task.priority === column.key),
      abandoned: terminal.abandoned.filter((task) => task.priority === column.key)
    }]));
  }
  // 件A (2026-08-05 煊煊拍板): 「僅提及」分桶——mention-only(与「@ 提到」pill 同一 mentionMember
  // 视角)且按 tp-task-board-read-v1 指纹已看过(根指纹不在 boardUnreadTaskIds;子任务沿 parentId
  // 回根取钥)的任务,从活任务列表抽出、收进「僅提及」分界线下;没看过的留在原位正常显示。只在
  // 「进行中」状态筛选下分桶,与终态分界线的可见性判定一致;列计数随外面的列表走(收起的不占计数,
  // 与已完成不占列计数同理)。boardUnreadTaskIds 只读不写——红点/列头未读的计数与消灯语义不动。
  const mentionCollapsible = filterState.status === "inProgress";
  const taskById = new Map(state.tasks.map((task) => [task.id, task]));
  const bucketedColumns = columns.map((column) => {
    if (!mentionCollapsible) return { ...column, mentionSeen: [] };
    const mentionSeen = column.tasks.filter((task) => isTaskMentionOnlyForMember(task, mentionMember) &&
      !(state.boardUnreadTaskIds?.has(taskReadFingerprintRootId(task, taskById)) === true));
    if (!mentionSeen.length) return { ...column, mentionSeen: [] };
    const kept = column.tasks.filter((task) => !mentionSeen.includes(task));
    return { ...column, tasks: kept, count: kept.length, taskCountBadge: String(kept.length), mentionSeen };
  });
  return bucketedColumns.map((column) => renderColumn(column, state, filterState, mentionMember, helpers, terminalByColumn)).join("");
}

export function renderTaskToolbar({ state, filterState, members, featureAiBatch, helpers }) {
  const { escapeHtml, icon, lang } = helpers;
  const memberFilter = filterState.view === "board" ? renderTaskFilter({ group: "member", filterState, members, helpers }) : "";
  const boardFilters = filterState.view === "board" && state.mode === "board"
    ? `${renderTaskFilter({ group: "status", filterState, members, helpers })}${renderTaskFilter({ group: "priority", filterState, members, helpers })}`
    : "";
  return `<div class="team-kanban-toolbar team-domain-toolbar">
    <div class="team-kanban-filters">${memberFilter}${boardFilters}${renderTaskFilter({ group: "view", filterState, members, helpers })}<label class="team-only-mine"><input type="checkbox" data-task-only-mine${state.onlyMine ? " checked" : ""}><span>${escapeHtml(taskT(lang, "tasks.onlyMine"))}</span></label></div>
    <div class="team-domain-toolbar__actions">${featureAiBatch ? `<button type="button" class="team-ai-task" data-task-ai-open>${icon("icon-task-list", "icon")}<span>${escapeHtml(taskT(lang, "tasks.ai.open"))}</span></button>` : ""}${state.permissions.canCreate ? `<button type="button" class="team-new-task" data-task-submit-open${state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites) ? " disabled aria-disabled=\"true\"" : ""}>${icon("icon-add-line-add")}<span>${escapeHtml(taskT(lang, "tasks.new"))}</span></button>` : ""}</div>
  </div>`;
}
