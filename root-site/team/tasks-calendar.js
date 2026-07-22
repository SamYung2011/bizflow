import { taskT } from "./tasks-i18n.js";

const MS_PER_DAY = 86400000;
export const CALENDAR_VISIBLE_LANES = 3;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseTaskDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).replaceAll("/", "-").split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function mondayIndex(date) {
  return date.getDay() === 0 ? 6 : date.getDay() - 1;
}

export function buildCalendarGrid(year, month) {
  const offset = mondayIndex(new Date(year, month, 1));
  const cells = Array.from({ length: 42 }, (_, index) => new Date(year, month, 1 - offset + index));
  return { year, month, cells };
}

export function taskDateRange(task) {
  const start = parseTaskDate(task.startDate) || parseTaskDate(task.due);
  const end = parseTaskDate(task.due) || parseTaskDate(task.startDate);
  if (!start || !end) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

function intersectWeek(range, weekStart) {
  const weekEnd = new Date(weekStart.getTime() + (6 * MS_PER_DAY));
  if (range.end < weekStart || range.start > weekEnd) return null;
  const visibleStart = range.start < weekStart ? weekStart : range.start;
  const visibleEnd = range.end > weekEnd ? weekEnd : range.end;
  return {
    colStart: Math.round((visibleStart - weekStart) / MS_PER_DAY),
    colEnd: Math.round((visibleEnd - weekStart) / MS_PER_DAY),
    leftOpen: range.start < weekStart,
    rightOpen: range.end > weekEnd
  };
}

export function assignCalendarLanes(items) {
  const laneEnds = [];
  return items.slice().sort((a, b) => a.colStart - b.colStart || a.colEnd - b.colEnd || a.task.title.localeCompare(b.task.title))
    .map((item) => {
      let lane = laneEnds.findIndex((lastEnd) => lastEnd < item.colStart);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = item.colEnd;
      return { ...item, lane };
    });
}

export function layoutCalendarWeeks(tasks, year, month) {
  const grid = buildCalendarGrid(year, month);
  const weeks = Array.from({ length: 6 }, (_, weekIndex) => {
    const days = grid.cells.slice(weekIndex * 7, (weekIndex + 1) * 7);
    const weekStart = startOfDay(days[0]);
    const items = tasks.flatMap((task) => {
      const range = taskDateRange(task);
      const segment = range && intersectWeek(range, weekStart);
      return segment ? [{ task, ...segment }] : [];
    });
    return { days, items: assignCalendarLanes(items) };
  });
  return { ...grid, weeks };
}

export function tasksForCalendarDay(tasks, key) {
  const target = parseTaskDate(key);
  if (!target) return [];
  return tasks.filter((task) => {
    const range = taskDateRange(task);
    return range && target >= range.start && target <= range.end;
  });
}

function localeFor(lang) {
  if (lang === "en") return "en-GB";
  if (lang === "fr") return "fr-FR";
  return "zh-HK";
}

function renderTaskBar(item, helpers) {
  const { escapeHtml } = helpers;
  const span = item.colEnd - item.colStart + 1;
  const openClass = `${item.leftOpen ? " task-calendar__bar--left-open" : ""}${item.rightOpen ? " task-calendar__bar--right-open" : ""}`;
  return `<button type="button" class="task-calendar__bar task-calendar__bar--${escapeHtml(item.task.priority)}${openClass}" style="--calendar-col:${item.colStart};--calendar-span:${span};--calendar-lane:${item.lane}" data-task-detail-open="${escapeHtml(item.task.id)}" title="${escapeHtml(item.task.title)}"><span>${escapeHtml(item.task.title)}</span></button>`;
}

function renderExpandedDay(tasks, key, helpers) {
  if (!key) return "";
  const { escapeHtml, lang } = helpers;
  return `<div class="task-calendar-overlay" data-calendar-overlay>
    <section class="task-calendar-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(key)}">
      <header><h3>${escapeHtml(key)}</h3><button type="button" data-calendar-close aria-label="${escapeHtml(taskT(lang, "tasks.calendar.close"))}">×</button></header>
      <div>${tasks.map((task) => `<button type="button" class="task-calendar-dialog__task task-calendar-dialog__task--${escapeHtml(task.priority)}" data-task-detail-open="${escapeHtml(task.id)}"><span>${escapeHtml(task.title)}</span><small>${escapeHtml(task.startDate && task.due && task.startDate !== task.due ? `${task.startDate} → ${task.due}` : task.due || task.startDate)}</small></button>`).join("")}</div>
    </section>
  </div>`;
}

export function renderTaskCalendar({ tasks, state, helpers }) {
  const { escapeHtml, icon, lang } = helpers;
  const layout = layoutCalendarWeeks(tasks, state.calendarYear, state.calendarMonth);
  const today = dateKey(new Date());
  const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const monthLabel = new Intl.DateTimeFormat(localeFor(lang), { year: "numeric", month: "long" })
    .format(new Date(state.calendarYear, state.calendarMonth, 1));
  const scheduledCount = tasks.filter(taskDateRange).length;
  const unscheduled = tasks.filter((task) => !taskDateRange(task));
  const weeks = layout.weeks.map((week, weekIndex) => {
    const overflow = Array(7).fill(0);
    week.items.filter((item) => item.lane >= CALENDAR_VISIBLE_LANES).forEach((item) => {
      for (let column = item.colStart; column <= item.colEnd; column += 1) overflow[column] += 1;
    });
    return `<div class="task-calendar__week" data-calendar-week="${weekIndex}">
      ${week.days.map((day) => `<div class="task-calendar__day${day.getMonth() === state.calendarMonth ? "" : " task-calendar__day--outside"}"><time class="${dateKey(day) === today ? "is-today" : ""}" datetime="${dateKey(day)}">${day.getDate()}</time></div>`).join("")}
      ${overflow.map((count, dayIndex) => count ? `<button type="button" class="task-calendar__more" style="--calendar-col:${dayIndex}" data-calendar-expand="${dateKey(week.days[dayIndex])}">+${count}</button>` : "").join("")}
      ${week.items.filter((item) => item.lane < CALENDAR_VISIBLE_LANES).map((item) => renderTaskBar(item, helpers)).join("")}
    </div>`;
  }).join("");
  const expandedTasks = tasksForCalendarDay(tasks, state.calendarExpandedDate);
  return `<section class="task-calendar" data-task-calendar data-scroll-restore="team.tasks.calendar" data-calendar-related-count="${tasks.length}" data-calendar-scheduled-count="${scheduledCount}" data-calendar-active-month="${state.calendarYear}-${String(state.calendarMonth + 1).padStart(2, "0")}">
    <header class="task-calendar__head"><h2>${escapeHtml(monthLabel)}</h2><div>
      <button type="button" data-calendar-month="previous" title="${escapeHtml(taskT(lang, "tasks.calendar.previous"))}">${icon("icon-arrow-left", "icon")}</button>
      <button type="button" class="task-calendar__today" data-calendar-month="today">${escapeHtml(taskT(lang, "tasks.calendar.today"))}</button>
      <button type="button" data-calendar-month="next" title="${escapeHtml(taskT(lang, "tasks.calendar.next"))}">${icon("icon-arrow-right", "icon")}</button>
    </div></header>
    <div class="task-calendar__weekdays">${weekdays.map((day) => `<span>${escapeHtml(taskT(lang, `tasks.calendar.${day}`))}</span>`).join("")}</div>
    <div class="task-calendar__grid">${weeks}</div>
    ${unscheduled.length ? `<details class="task-calendar__unscheduled"><summary>${escapeHtml(taskT(lang, "tasks.calendar.unscheduled"))} <span>${unscheduled.length}</span></summary><div>${unscheduled.map((task) => `<button type="button" data-task-detail-open="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button>`).join("")}</div></details>` : ""}
    ${renderExpandedDay(expandedTasks, state.calendarExpandedDate, helpers)}
  </section>`;
}
