import { taskT } from "./tasks-i18n.js";
import { isTaskVisibleToMember, memberIdentity, taskMatchesMemberStatus } from "./tasks-model.js";

const STATIC_FILTER_OPTIONS = {
  status: [
    { value: "inProgress", key: "tasks.detail.status.inProgress" },
    { value: "completed", key: "tasks.detail.status.completed" },
    { value: "abandoned", key: "tasks.detail.status.abandoned" },
    { value: "overdue", key: "tasks.detail.status.overdue" }
  ],
  priority: [
    { value: "all", key: "tasks.filter.priority" },
    { value: "high", key: "tasks.priority.short.high" },
    { value: "medium", key: "tasks.priority.short.medium" },
    { value: "low", key: "tasks.priority.short.low" }
  ],
  view: [
    { value: "board", key: "tasks.view.board" },
    { value: "calendar", key: "tasks.view.calendar" }
  ]
};

const STATUS_TRIGGER_KEYS = {
  inProgress: "tasks.stat.inProgress",
  completed: "tasks.stat.completed",
  abandoned: "tasks.detail.status.abandoned",
  overdue: "tasks.detail.status.overdue"
};

function uniqueMemberOptions(members) {
  const options = members
    .filter((member) => member.dept !== "all")
    .map((member) => ({ value: memberIdentity(member), label: member.name }))
    .filter((option, index, list) => option.value && list.findIndex((item) => item.value === option.value) === index);
  return [{ value: "all", key: "tasks.filter.member" }, ...options];
}

function optionsFor(group, members) {
  return group === "member" ? uniqueMemberOptions(members) : STATIC_FILTER_OPTIONS[group] ?? [];
}

function optionLabel(option, lang) {
  return option.label ?? taskT(lang, option.key);
}

function triggerLabel(group, selected, lang) {
  if (group === "status") return taskT(lang, STATUS_TRIGGER_KEYS[selected.value] ?? selected.key);
  return optionLabel(selected, lang);
}

export function isTaskFilterGroup(group) {
  return group === "member" || Object.hasOwn(STATIC_FILTER_OPTIONS, group);
}

export function renderTaskFilter({ group, filterState, members, helpers }) {
  const { escapeHtml, icon, lang } = helpers;
  const options = optionsFor(group, members);
  const selected = options.find((option) => option.value === filterState[group]) ?? options[0];
  const label = triggerLabel(group, selected, lang);
  const rows = options.map((option) => {
    const isSelected = option.value === selected.value;
    const text = optionLabel(option, lang);
    return `<button type="button" role="option" aria-selected="${isSelected}" class="dropdown-item team-filter-option${isSelected ? " dropdown-item--selected" : ""}" data-filter-option data-filter-group="${group}" data-filter-value="${escapeHtml(option.value)}" title="${escapeHtml(text)}">
      <span class="tp-line">${escapeHtml(text)}</span>
    </button>`;
  }).join("");

  return `<span class="menu-anchor team-filter-anchor team-filter-anchor--${group}" data-filter-menu>
    <button type="button" class="team-filter" data-filter-trigger data-filter-group="${group}" aria-haspopup="listbox" aria-expanded="false" title="${escapeHtml(label)}">
      <span>${escapeHtml(label)}</span>
      ${icon("icon-arrow-down", "icon")}
    </button>
    <div class="menu-popover team-filter-menu" role="listbox" data-filter-popover>${rows}</div>
  </span>`;
}

function statusMatches(task, selectedStatus) {
  if (selectedStatus === "completed") return task.done === true || task.status === "completed";
  if (selectedStatus === "abandoned") return task.status === "abandoned";
  if (selectedStatus === "overdue") return task.done !== true && task.status === "overdue";
  // 逾期任务仍是 open/进行中,同时可在「已逾期」子集中单独查看。
  return task.done !== true && task.status !== "abandoned";
}

export function filterTaskColumns(board, filterState, { mobile, members = [] }) {
  const selectedPriority = mobile ? "all" : filterState.priority;
  const selectedMember = filterState.member;
  const scopedMember = selectedMember === "all"
    ? null
    : members.find((member) => memberIdentity(member) === selectedMember) ?? null;
  return board
    .filter((column) => selectedPriority === "all" || column.key === selectedPriority)
    .map((column) => {
      const tasks = column.tasks.filter((task) => {
        if (!scopedMember) return selectedMember === "all" && statusMatches(task, filterState.status);
        return isTaskVisibleToMember(task, scopedMember) && taskMatchesMemberStatus(task, scopedMember, filterState.status);
      });
      const count = tasks.length;
      return { ...column, tasks, count, taskCountBadge: String(count) };
    });
}
