const COPY = {
  zh: {
    range: "日期區間",
    all: "全部時間",
    from: "開始日期",
    to: "結束日期",
    startPlaceholder: "月/日/年",
    endPlaceholder: "月/日/年",
    today: "今天",
    previousMonth: "上個月",
    nextMonth: "下個月",
    endDate: "結束日期",
    format: "日期格式",
    monthDayYear: "月/日/年",
    clear: "清除"
  },
  en: {
    range: "Date range",
    all: "All time",
    from: "Start date",
    to: "End date",
    startPlaceholder: "Month/Day/Year",
    endPlaceholder: "Month/Day/Year",
    today: "Today",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    endDate: "End date",
    format: "Date format",
    monthDayYear: "Month/Day/Year",
    clear: "Clear"
  },
  fr: {
    range: "Période",
    all: "Toutes les dates",
    from: "Date de début",
    to: "Date de fin",
    startPlaceholder: "Mois/Jour/Année",
    endPlaceholder: "Mois/Jour/Année",
    today: "Aujourd'hui",
    previousMonth: "Mois précédent",
    nextMonth: "Mois suivant",
    endDate: "Date de fin",
    format: "Format de date",
    monthDayYear: "Mois/Jour/Année",
    clear: "Effacer"
  }
};

const WEEKDAYS = {
  zh: ["日", "一", "二", "三", "四", "五", "六"],
  en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  fr: ["Di", "Lu", "Ma", "Me", "Je", "Ve", "Sa"]
};

function copy(lang, key) {
  return COPY[lang]?.[key] ?? COPY.zh[key] ?? key;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateInputFromDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function isValidDateParts(year, month, day) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function normalizeDateInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const parts = ymd
    ? [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])]
    : mdy
      ? [Number(mdy[3]), Number(mdy[1]), Number(mdy[2])]
      : null;
  if (!parts || !isValidDateParts(...parts)) return "";
  return `${parts[0]}-${pad2(parts[1])}-${pad2(parts[2])}`;
}

export function latestDateInput(values = []) {
  return values.reduce((latest, value) => {
    const normalized = normalizeDateInput(value);
    return normalized && (!latest || normalized > latest) ? normalized : latest;
  }, "");
}

function dateValue(value) {
  return dateFromInput(value)?.getTime() ?? null;
}

function dateFromInput(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function todayInput() {
  return dateInputFromDate(new Date());
}

function monthStartInput(value) {
  const date = dateFromInput(value) || dateFromInput(todayInput());
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-01`;
}

function shiftMonth(value, delta) {
  const date = dateFromInput(monthStartInput(value));
  date.setMonth(date.getMonth() + delta);
  return monthStartInput(dateInputFromDate(date));
}

function monthTitle(value, lang) {
  const date = dateFromInput(monthStartInput(value));
  const locale = lang === "fr" ? "fr-FR" : lang === "en" ? "en-US" : "zh-HK";
  return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(date);
}

function calendarDays(monthInput) {
  const month = dateFromInput(monthStartInput(monthInput));
  const start = new Date(month);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      value: dateInputFromDate(date),
      label: String(date.getDate()),
      outside: date.getMonth() !== month.getMonth()
    };
  });
}

function displayDate(value) {
  return normalizeDateInput(value).replaceAll("-", "/");
}

function panelDate(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-");
  return `${month}/${day}/${year}`;
}

export function createDateFilter({ id = "primary", initialDate = "", onChange = () => {} } = {}) {
  const initialMonth = monthStartInput(normalizeDateInput(initialDate) || todayInput());
  const state = {
    from: "",
    to: "",
    panelOpen: false,
    focus: "from",
    endDateEnabled: true,
    calendarMonth: initialMonth
  };

  function bounds() {
    const from = dateValue(state.from);
    const to = state.endDateEnabled ? dateValue(state.to) : from;
    return { from, to };
  }

  function notify(filterChanged = false) {
    onChange({ filterChanged });
  }

  function belongsToThisFilter(target) {
    const root = target?.closest?.("[data-date-filter]");
    return root?.getAttribute("data-date-filter") === id;
  }

  function syncClosedDom() {
    document.querySelectorAll("[data-date-filter]").forEach((root) => {
      if (root.getAttribute("data-date-filter") !== id) return;
      root.setAttribute("data-date-open", "false");
      root.parentElement?.closest("[data-date-open]")?.setAttribute("data-date-open", "false");
      root.querySelector("[data-date-filter-trigger]")?.setAttribute("aria-expanded", "false");
      root.querySelector("[data-date-filter-popover]")?.classList.remove("menu-popover--open");
    });
  }

  function close() {
    if (!state.panelOpen) return false;
    state.panelOpen = false;
    syncClosedDom();
    return true;
  }

  function applySelection(value) {
    const normalized = normalizeDateInput(value);
    if (!normalized) return;
    state.calendarMonth = monthStartInput(normalized);
    if (!state.endDateEnabled) {
      state.from = normalized;
      state.to = "";
      state.focus = "from";
    } else if (state.focus === "to" || (state.from && !state.to)) {
      if (state.from && dateValue(normalized) < dateValue(state.from)) {
        state.to = state.from;
        state.from = normalized;
      } else {
        state.to = normalized;
      }
      state.focus = "from";
    } else {
      state.from = normalized;
      state.to = "";
      state.focus = "to";
    }
  }

  function applyTypedDate(part, value) {
    const normalized = normalizeDateInput(value);
    if (!normalized && String(value || "").trim() !== "") return false;
    if (part === "to" && !state.endDateEnabled) return false;
    if (part === "to") {
      state.to = normalized;
      if (state.from && state.to && dateValue(state.to) < dateValue(state.from)) {
        [state.from, state.to] = [state.to, state.from];
      }
    } else {
      state.from = normalized;
      if (state.from && state.to && dateValue(state.to) < dateValue(state.from)) {
        state.to = "";
        state.focus = "to";
      }
    }
    state.calendarMonth = monthStartInput(normalized || state.from || state.to || initialDate || todayInput());
    return true;
  }

  function inSelectedRange(value) {
    const { from, to } = bounds();
    const current = dateValue(value);
    return from != null && to != null && current != null && current >= Math.min(from, to) && current <= Math.max(from, to);
  }

  function render(helpers) {
    const { escapeHtml, icon, lang } = helpers;
    const hasFilter = Boolean(state.from || state.to);
    const fromText = displayDate(state.from);
    const toText = displayDate(state.to);
    const triggerBody = hasFilter
      ? `<span>${escapeHtml(fromText || copy(lang, "from"))}</span>
        <span class="date-filter__separator" aria-hidden="true"></span>
        <span>${escapeHtml(state.endDateEnabled ? (toText || copy(lang, "to")) : fromText)}</span>`
      : `<span>${escapeHtml(copy(lang, "all"))}</span>`;
    const weekdays = (WEEKDAYS[lang] || WEEKDAYS.zh)
      .map((day) => `<span class="date-filter__weekday">${escapeHtml(day)}</span>`)
      .join("");
    const days = calendarDays(state.calendarMonth).map((day) => {
      const selectedStart = day.value === state.from;
      const selectedEnd = state.endDateEnabled && day.value === state.to;
      const isToday = day.value === todayInput();
      const classes = [
        "date-filter__day",
        day.outside ? "date-filter__day--outside" : "",
        inSelectedRange(day.value) ? "date-filter__day--range" : "",
        selectedStart || selectedEnd ? "date-filter__day--selected" : "",
        isToday ? "date-filter__day--today" : ""
      ].filter(Boolean).join(" ");
      return `<button type="button" class="${classes}" data-date-filter-day="${escapeHtml(day.value)}" title="${escapeHtml(displayDate(day.value))}">
        <span>${escapeHtml(day.label)}</span>
      </button>`;
    }).join("");

    return `<span class="date-filter menu-anchor" data-date-filter="${escapeHtml(id)}" data-date-open="${state.panelOpen}">
      <button type="button" class="date-filter__trigger${hasFilter ? " date-filter__trigger--active" : ""}" data-date-filter-trigger aria-haspopup="dialog" aria-expanded="${state.panelOpen}" title="${escapeHtml(copy(lang, "range"))}">
        ${icon("icon-task-calendar", "icon")}
        <span class="date-filter__trigger-copy">${triggerBody}</span>
        ${icon("icon-arrow-down", "icon date-filter__chevron")}
      </button>
      <div class="tp-component menu-popover date-filter__panel${state.panelOpen ? " menu-popover--open" : ""}" data-date-filter-popover role="dialog" aria-label="${escapeHtml(copy(lang, "range"))}">
        <div class="date-filter__inputs">
          <input type="text" class="date-filter__input${state.focus === "from" ? " date-filter__input--focus" : ""}" data-date-filter-input="from" inputmode="numeric" value="${escapeHtml(panelDate(state.from))}" placeholder="${escapeHtml(copy(lang, "startPlaceholder"))}" aria-label="${escapeHtml(copy(lang, "from"))}">
          <input type="text" class="date-filter__input${state.focus === "to" ? " date-filter__input--focus" : ""}" data-date-filter-input="to" inputmode="numeric" value="${escapeHtml(panelDate(state.to))}" placeholder="${escapeHtml(copy(lang, "endPlaceholder"))}" aria-label="${escapeHtml(copy(lang, "to"))}"${state.endDateEnabled ? "" : " disabled"}>
        </div>
        <div class="date-filter__calendar-head">
          <strong>${escapeHtml(monthTitle(state.calendarMonth, lang))}</strong>
          <button type="button" class="date-filter__today" data-date-filter-today>${escapeHtml(copy(lang, "today"))}</button>
          <button type="button" class="date-filter__calendar-nav" data-date-filter-prev aria-label="${escapeHtml(copy(lang, "previousMonth"))}">
            ${icon("icon-arrow-left", "icon")}
          </button>
          <button type="button" class="date-filter__calendar-nav" data-date-filter-next aria-label="${escapeHtml(copy(lang, "nextMonth"))}">
            ${icon("icon-arrow-right", "icon")}
          </button>
        </div>
        <div class="date-filter__weekdays">${weekdays}</div>
        <div class="date-filter__calendar-grid">${days}</div>
        <div class="date-filter__options">
          <div class="date-filter__option">
            <span>${escapeHtml(copy(lang, "endDate"))}</span>
            <button type="button" class="date-filter__switch${state.endDateEnabled ? " date-filter__switch--on" : ""}" data-date-filter-toggle-end aria-pressed="${state.endDateEnabled}">
              <span></span>
            </button>
          </div>
          <div class="date-filter__option date-filter__option--muted">
            <span>${escapeHtml(copy(lang, "format"))}</span>
            <span>${escapeHtml(copy(lang, "monthDayYear"))}</span>
          </div>
          <button type="button" class="date-filter__clear" data-date-filter-clear>${escapeHtml(copy(lang, "clear"))}</button>
        </div>
      </div>
    </span>`;
  }

  function handleClick(event) {
    if (!belongsToThisFilter(event.target)) return false;

    if (event.target.closest("[data-date-filter-trigger]")) {
      state.panelOpen = !state.panelOpen;
      notify(false);
      return true;
    }
    if (event.target.closest("[data-date-filter-prev]")) {
      state.calendarMonth = shiftMonth(state.calendarMonth, -1);
      state.panelOpen = true;
      notify(false);
      return true;
    }
    if (event.target.closest("[data-date-filter-next]")) {
      state.calendarMonth = shiftMonth(state.calendarMonth, 1);
      state.panelOpen = true;
      notify(false);
      return true;
    }
    if (event.target.closest("[data-date-filter-today]")) {
      state.calendarMonth = monthStartInput(todayInput());
      state.panelOpen = true;
      notify(false);
      return true;
    }

    const day = event.target.closest("[data-date-filter-day]");
    if (day) {
      applySelection(day.getAttribute("data-date-filter-day"));
      state.panelOpen = true;
      notify(true);
      return true;
    }
    if (event.target.closest("[data-date-filter-toggle-end]")) {
      state.endDateEnabled = !state.endDateEnabled;
      if (!state.endDateEnabled) {
        state.to = "";
        state.focus = "from";
      } else if (state.from) {
        state.focus = "to";
      }
      state.panelOpen = true;
      notify(true);
      return true;
    }
    if (event.target.closest("[data-date-filter-clear]")) {
      state.from = "";
      state.to = "";
      state.focus = "from";
      state.calendarMonth = initialMonth;
      state.panelOpen = true;
      notify(true);
      return true;
    }
    return false;
  }

  function handleFocus(event) {
    const input = event.target.closest?.("[data-date-filter-input]");
    if (!input || !belongsToThisFilter(input)) return false;
    state.focus = input.getAttribute("data-date-filter-input") === "to" ? "to" : "from";
    return true;
  }

  function handleChange(event) {
    const input = event.target.closest?.("[data-date-filter-input]");
    if (!input || !belongsToThisFilter(input)) return false;
    const part = input.getAttribute("data-date-filter-input") === "to" ? "to" : "from";
    if (applyTypedDate(part, input.value)) {
      state.panelOpen = true;
      notify(true);
    }
    return true;
  }

  return {
    close,
    handleChange,
    handleClick,
    handleFocus,
    isOpen: () => state.panelOpen,
    matches(value) {
      const { from, to } = bounds();
      if (from == null && to == null) return true;
      const current = dateValue(value);
      if (current == null) return false;
      if (from != null && current < from) return false;
      if (to != null && current > to) return false;
      return true;
    },
    render
  };
}
