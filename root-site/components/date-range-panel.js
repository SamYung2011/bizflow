import { normalizeDateInput } from "./date-value.js";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function inputFromDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateFromInput(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function monthStart(value) {
  const date = dateFromInput(value) ?? new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function normalizeRange(start, end) {
  const normalizedStart = normalizeDateInput(start);
  const normalizedEnd = normalizeDateInput(end);
  if (normalizedStart && normalizedEnd && normalizedStart > normalizedEnd) {
    return { start: normalizedEnd, end: normalizedStart };
  }
  return { start: normalizedStart, end: normalizedEnd };
}

function panelDate(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-");
  return `${month}/${day}/${year}`;
}

function localeForLang(lang) {
  if (lang === "en") return "en-GB";
  if (lang === "fr") return "fr-FR";
  return "zh-HK";
}

function monthTitle(date, lang) {
  return new Intl.DateTimeFormat(localeForLang(lang), { month: "short", year: "numeric" }).format(date);
}

function weekdayLabels(lang) {
  const formatter = new Intl.DateTimeFormat(localeForLang(lang), { weekday: "narrow" });
  const sunday = new Date(2026, 6, 5);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + index);
    return formatter.format(date);
  });
}

function monthLabels(lang) {
  const formatter = new Intl.DateTimeFormat(localeForLang(lang), { month: "short" });
  return Array.from({ length: 12 }, (_, month) => formatter.format(new Date(2026, month, 1)));
}

function calendarDays(viewMonth) {
  const start = new Date(viewMonth);
  start.setDate(1 - start.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      value: inputFromDate(date),
      label: String(date.getDate()),
      outside: date.getMonth() !== viewMonth.getMonth()
    };
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createDateRangePanel() {
  let panel = null;
  let anchor = null;
  let translate = (key) => key;
  let lang = "zh";
  let draft = { start: "", end: "" };
  let activeSide = "start";
  let viewMonth = monthStart("");
  let jumpOpen = false;
  let mode = "range";
  let presets = [];
  let onComplete = async () => {};

  function singleMode() {
    return mode === "single";
  }

  function isOpen() {
    return panel?.isConnected === true;
  }

  function position() {
    if (!isOpen() || !anchor?.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 10;
    const gap = 6;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - width - margin));
    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - margin && rect.top > height + margin) top = rect.top - height - gap;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(Math.max(margin, top))}px`;
    panel.style.visibility = "visible";
  }

  function detachListeners() {
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    document.removeEventListener("keydown", onDocumentKeydown, true);
    window.removeEventListener("resize", position);
    window.removeEventListener("scroll", position, true);
  }

  function close({ restoreFocus = true } = {}) {
    if (!panel) return false;
    const returnFocus = anchor;
    returnFocus?.setAttribute("aria-expanded", "false");
    detachListeners();
    panel.remove();
    panel = null;
    anchor = null;
    jumpOpen = false;
    if (restoreFocus && returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus());
    return true;
  }

  function onOutsidePointerDown(event) {
    if (panel?.contains(event.target) || anchor?.contains(event.target)) return;
    close();
  }

  function onDocumentKeydown(event) {
    if (event.key !== "Escape" || !isOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  function inRange(value) {
    return !singleMode() && draft.start && draft.end && value >= draft.start && value <= draft.end;
  }

  function commit(value) {
    const handler = onComplete;
    close({ restoreFocus: false });
    void Promise.resolve(handler(value)).catch((error) => console.warn("[date-range-panel] commit failed", error));
  }

  function render({ focus = "" } = {}) {
    if (!isOpen()) return;
    const today = inputFromDate(new Date());
    const weekdays = weekdayLabels(lang)
      .map((label) => `<span class="date-range-panel__weekday">${escapeHtml(label)}</span>`)
      .join("");
    const days = calendarDays(viewMonth).map((day) => {
      const selected = day.value === draft.start || (!singleMode() && day.value === draft.end);
      const classes = [
        "date-range-panel__day",
        day.outside ? "date-range-panel__day--outside" : "",
        inRange(day.value) ? "date-range-panel__day--range" : "",
        day.value === draft.start ? "date-range-panel__day--range-start" : "",
        day.value === draft.end ? "date-range-panel__day--range-end" : "",
        selected ? "date-range-panel__day--selected" : "",
        day.value === today ? "date-range-panel__day--today" : ""
      ].filter(Boolean).join(" ");
      return `<button type="button" class="${classes}" data-date-range-day="${day.value}" aria-pressed="${selected}" title="${escapeHtml(panelDate(day.value))}"><span>${day.label}</span></button>`;
    }).join("");
    const jump = `<div class="date-range-panel__jump" data-date-range-jump>
      <label class="date-range-panel__year"><span>${escapeHtml(translate("year"))}</span><input type="number" inputmode="numeric" min="1900" max="2200" value="${viewMonth.getFullYear()}" data-date-range-year></label>
      <div class="date-range-panel__months" role="group" aria-label="${escapeHtml(translate("chooseMonth"))}">
        ${monthLabels(lang).map((label, month) => `<button type="button" class="date-range-panel__month${month === viewMonth.getMonth() ? " is-active" : ""}" data-date-range-month="${month}">${escapeHtml(label)}</button>`).join("")}
      </div>
    </div>`;
    const presetItems = presets.length ? `<div class="date-range-panel__presets" role="group" aria-label="${escapeHtml(translate("presets"))}">
      ${presets.map((preset, index) => `<button type="button" class="date-range-panel__preset" data-date-range-preset="${index}">${escapeHtml(preset.label)}</button>`).join("")}
    </div>` : "";
    const inputs = singleMode()
      ? `<div class="date-range-panel__inputs date-range-panel__inputs--single">
        <button type="button" class="date-range-panel__date is-active" data-date-range-side="start">${escapeHtml(panelDate(draft.start) || translate("date"))}</button>
      </div>`
      : `<div class="date-range-panel__inputs">
        <button type="button" class="date-range-panel__date${activeSide === "start" ? " is-active" : ""}" data-date-range-side="start">${escapeHtml(panelDate(draft.start) || translate("startDate"))}</button>
        <button type="button" class="date-range-panel__date${activeSide === "end" ? " is-active" : ""}" data-date-range-side="end">${escapeHtml(panelDate(draft.end) || translate("endDate"))}</button>
      </div>`;
    panel.innerHTML = `
      ${presetItems}
      ${inputs}
      <div class="date-range-panel__head">
        <button type="button" class="date-range-panel__month-trigger" data-date-range-action="jump" aria-expanded="${jumpOpen}" aria-label="${escapeHtml(translate("chooseMonth"))}">${escapeHtml(monthTitle(viewMonth, lang))}</button>
        <span class="date-range-panel__head-actions">
          <button type="button" class="date-range-panel__today" data-date-range-action="today">${escapeHtml(translate("today"))}</button>
          <button type="button" class="date-range-panel__nav" data-date-range-action="previous" aria-label="${escapeHtml(translate("previousMonth"))}">‹</button>
          <button type="button" class="date-range-panel__nav" data-date-range-action="next" aria-label="${escapeHtml(translate("nextMonth"))}">›</button>
        </span>
      </div>
      ${jumpOpen ? jump : `<div class="date-range-panel__calendar">${weekdays}${days}</div>`}
      <footer class="date-range-panel__footer">
        <button type="button" class="date-range-panel__clear" data-date-range-action="clear">${escapeHtml(translate("clear"))}</button>
        <span class="date-range-panel__footer-actions">
          <button type="button" class="date-range-panel__button date-range-panel__button--cancel" data-date-range-action="cancel">${escapeHtml(translate("cancel"))}</button>
          ${singleMode() ? "" : `<button type="button" class="date-range-panel__button date-range-panel__button--complete" data-date-range-action="complete">${escapeHtml(translate("complete"))}</button>`}
        </span>
      </footer>`;
    position();
    if (focus) panel.querySelector(focus)?.focus();
  }

  function selectDay(value) {
    const normalized = normalizeDateInput(value);
    if (!normalized) return;
    if (singleMode()) {
      draft = { start: normalized, end: "" };
      commit({ date: normalized });
      return;
    }
    if (activeSide === "start") {
      draft = { start: normalized, end: "" };
      activeSide = "end";
    } else if (draft.start && normalized < draft.start) {
      draft = { start: normalized, end: draft.start };
      activeSide = "start";
    } else {
      draft.end = normalized;
      if (!draft.start) draft.start = normalized;
      activeSide = "start";
    }
    render({ focus: `[data-date-range-day="${normalized}"]` });
  }

  function handleClick(event) {
    const side = event.target.closest("[data-date-range-side]")?.getAttribute("data-date-range-side");
    if (side) {
      activeSide = side === "end" ? "end" : "start";
      render({ focus: `[data-date-range-side="${activeSide}"]` });
      return;
    }
    const preset = event.target.closest("[data-date-range-preset]");
    if (preset) {
      const selected = presets[Number(preset.getAttribute("data-date-range-preset"))];
      if (!selected) return;
      if (singleMode()) {
        commit({ date: normalizeDateInput(selected.date) });
      } else {
        commit(normalizeRange(selected.start, selected.end));
      }
      return;
    }
    const day = event.target.closest("[data-date-range-day]");
    if (day) {
      selectDay(day.getAttribute("data-date-range-day"));
      return;
    }
    const month = event.target.closest("[data-date-range-month]");
    if (month) {
      const yearInput = panel.querySelector("[data-date-range-year]");
      const year = Number(yearInput?.value);
      const monthIndex = Number(month.getAttribute("data-date-range-month"));
      if (!Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(monthIndex)) {
        yearInput?.focus();
        yearInput?.setAttribute("aria-invalid", "true");
        return;
      }
      viewMonth = new Date(year, monthIndex, 1);
      jumpOpen = false;
      render({ focus: '[data-date-range-action="jump"]' });
      return;
    }
    const action = event.target.closest("[data-date-range-action]")?.getAttribute("data-date-range-action");
    if (action === "jump") {
      jumpOpen = !jumpOpen;
      render({ focus: jumpOpen ? "[data-date-range-year]" : '[data-date-range-action="jump"]' });
      if (jumpOpen) panel.querySelector("[data-date-range-year]")?.select();
    } else if (action === "previous" || action === "next") {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + (action === "next" ? 1 : -1), 1);
      jumpOpen = false;
      render({ focus: `[data-date-range-action="${action}"]` });
    } else if (action === "today") {
      if (singleMode()) {
        commit({ date: inputFromDate(new Date()) });
        return;
      }
      viewMonth = monthStart(inputFromDate(new Date()));
      jumpOpen = false;
      render({ focus: '[data-date-range-action="today"]' });
    } else if (action === "clear") {
      if (singleMode()) {
        commit({ date: "" });
        return;
      }
      draft = { start: "", end: "" };
      activeSide = "start";
      render({ focus: '[data-date-range-side="start"]' });
    } else if (action === "cancel") {
      close();
    } else if (action === "complete") {
      const value = normalizeRange(draft.start, draft.end);
      commit(value);
    }
  }

  function open({ anchor: nextAnchor, mode: nextMode = "range", date = "", start = "", end = "", viewDate = "", presets: nextPresets = [], language = "zh", t = (key) => key, onCommit = async () => {} } = {}) {
    if (!(nextAnchor instanceof HTMLElement)) return false;
    close({ restoreFocus: false });
    anchor = nextAnchor;
    anchor.setAttribute("aria-haspopup", "dialog");
    anchor.setAttribute("aria-expanded", "true");
    translate = t;
    lang = language;
    mode = nextMode === "single" ? "single" : "range";
    presets = (Array.isArray(nextPresets) ? nextPresets : []).filter((preset) => preset && typeof preset.label === "string");
    draft = singleMode() ? { start: normalizeDateInput(date), end: "" } : normalizeRange(start, end);
    activeSide = singleMode() ? "start" : draft.start && !draft.end ? "end" : "start";
    viewMonth = monthStart(draft.start || draft.end || viewDate);
    jumpOpen = false;
    onComplete = onCommit;
    panel = document.createElement("section");
    panel.className = `tp-component date-range-panel date-range-panel--${mode}`;
    panel.setAttribute("data-date-range-panel", "");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", String(translate(singleMode() ? "date" : "dateRange")));
    panel.style.visibility = "hidden";
    panel.addEventListener("click", handleClick);
    document.body.append(panel);
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    document.addEventListener("keydown", onDocumentKeydown, true);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    render();
    requestAnimationFrame(() => panel?.querySelector(`[data-date-range-side="${activeSide}"]`)?.focus());
    return true;
  }

  return Object.freeze({ close, isOpen, open });
}
