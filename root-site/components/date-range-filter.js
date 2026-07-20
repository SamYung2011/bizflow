import { createDateRangePanel } from "./date-range-panel.js";
import { normalizeDateInput } from "./date-value.js";

export { latestDateInput, normalizeDateInput } from "./date-value.js";

const COPY = Object.freeze({
  zh: Object.freeze({
    allTime: "全部時間",
    cancel: "取消",
    chooseMonth: "選擇月份",
    clear: "清除",
    complete: "完成",
    date: "日期",
    dateRange: "日期區間",
    endDate: "結束日期",
    last7Days: "近 7 天",
    nextMonth: "下個月",
    presets: "快捷選擇",
    previousMonth: "上個月",
    startDate: "開始日期",
    today: "今天",
    year: "年份"
  }),
  en: Object.freeze({
    allTime: "All time",
    cancel: "Cancel",
    chooseMonth: "Choose month",
    clear: "Clear",
    complete: "Complete",
    date: "Date",
    dateRange: "Date range",
    endDate: "End date",
    last7Days: "Last 7 days",
    nextMonth: "Next month",
    presets: "Quick select",
    previousMonth: "Previous month",
    startDate: "Start date",
    today: "Today",
    year: "Year"
  }),
  fr: Object.freeze({
    allTime: "Toutes les dates",
    cancel: "Annuler",
    chooseMonth: "Choisir le mois",
    clear: "Effacer",
    complete: "Terminer",
    date: "Date",
    dateRange: "Période",
    endDate: "Date de fin",
    last7Days: "7 derniers jours",
    nextMonth: "Mois suivant",
    presets: "Sélection rapide",
    previousMonth: "Mois précédent",
    startDate: "Date de début",
    today: "Aujourd’hui",
    year: "Année"
  })
});

function text(lang, key) {
  return COPY[lang]?.[key] ?? COPY.zh[key] ?? key;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function inputFromDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function recentRange(days) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - Math.max(0, days - 1));
  return { start: inputFromDate(start), end: inputFromDate(end) };
}

function normalizeRange(start, end) {
  const normalizedStart = normalizeDateInput(start);
  const normalizedEnd = normalizeDateInput(end);
  if (normalizedStart && normalizedEnd && normalizedStart > normalizedEnd) {
    return { start: normalizedEnd, end: normalizedStart };
  }
  return { start: normalizedStart, end: normalizedEnd };
}

function monthStartInput(value) {
  const normalized = normalizeDateInput(value);
  return normalized ? `${normalized.slice(0, 7)}-01` : "";
}

function displayDate(value) {
  return normalizeDateInput(value).replaceAll("-", "/");
}

function presetValues(keys, lang) {
  return keys.flatMap((key) => {
    if (key === "all") return [{ label: text(lang, "allTime"), start: "", end: "" }];
    if (key === "last7") return [{ label: text(lang, "last7Days"), ...recentRange(7) }];
    return [];
  });
}

export function createDateRangeFilter({
  id = "primary",
  initialDate = "",
  presets = ["all"],
  onChange = () => {}
} = {}) {
  const panel = createDateRangePanel();
  const initialViewDate = normalizeDateInput(initialDate);
  const presetKeys = Array.isArray(presets) ? [...presets] : ["all"];
  let helpers = null;
  let state = { start: "", end: "" };

  function close() {
    return panel.close();
  }

  function belongsToThisFilter(target) {
    const root = target?.closest?.("[data-date-range-filter]");
    return root?.getAttribute("data-date-range-filter") === id;
  }

  function render(nextHelpers) {
    helpers = nextHelpers;
    const { escapeHtml, icon, lang } = nextHelpers;
    const hasFilter = Boolean(state.start || state.end);
    const rangeText = hasFilter
      ? [displayDate(state.start), displayDate(state.end)].filter(Boolean).join(" – ")
      : text(lang, "allTime");
    return `<span class="date-range-filter" data-date-range-filter="${escapeHtml(id)}">
      <button type="button" class="date-panel-trigger date-range-filter__trigger${hasFilter ? " is-active" : ""}" data-date-range-filter-trigger aria-haspopup="dialog" aria-expanded="false" title="${escapeHtml(text(lang, "dateRange"))}">
        ${icon("icon-task-calendar", "icon")}
        <span class="date-panel-trigger__value">${escapeHtml(rangeText)}</span>
        ${icon("icon-arrow-down", "icon date-range-filter__chevron")}
      </button>
    </span>`;
  }

  function handleClick(event) {
    const trigger = event.target?.closest?.("[data-date-range-filter-trigger]");
    if (!trigger || !belongsToThisFilter(trigger) || !helpers) return false;
    const lang = helpers.lang || "zh";
    panel.open({
      anchor: trigger,
      start: state.start,
      end: state.end,
      viewDate: initialViewDate,
      presets: presetValues(presetKeys, lang),
      language: lang,
      t: (key) => text(lang, key),
      onCommit(value) {
        const next = normalizeRange(value?.start, value?.end);
        const filterChanged = next.start !== state.start || next.end !== state.end;
        state = next;
        onChange({ filterChanged });
      }
    });
    return true;
  }

  function captureState() {
    return {
      from: state.start,
      to: state.end,
      focus: "from",
      endDateEnabled: true,
      calendarMonth: monthStartInput(state.start || state.end || initialViewDate)
    };
  }

  function restoreState(value) {
    if (!value || typeof value !== "object") return false;
    const start = normalizeDateInput(value.start ?? value.from);
    const rawEnd = normalizeDateInput(value.end ?? value.to);
    state = normalizeRange(start, value.endDateEnabled === false && start ? start : rawEnd);
    close();
    return true;
  }

  return Object.freeze({
    captureState,
    close,
    handleClick,
    isOpen: panel.isOpen,
    matches(value) {
      const current = normalizeDateInput(value);
      if (!state.start && !state.end) return true;
      if (!current) return false;
      if (state.start && current < state.start) return false;
      if (state.end && current > state.end) return false;
      return true;
    },
    render,
    restoreState
  });
}
