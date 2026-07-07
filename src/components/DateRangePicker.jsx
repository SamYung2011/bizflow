import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const WEEKDAY_KEYS = ["日", "一", "二", "三", "四", "五", "六"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) return null;
  return date;
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function compareIso(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return String(a).localeCompare(String(b));
}

function formatDisplayDate(value) {
  const d = parseIsoDate(value);
  if (!d) return "";
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
}

function normalizeRange(start, end) {
  if (start && end && compareIso(start, end) > 0) return { start: end, end: start };
  return { start, end };
}

export function formatDateRangeForDisplay(start, end) {
  const startText = formatDisplayDate(start);
  const endText = formatDisplayDate(end);
  if (startText && endText) return `${startText} - ${endText}`;
  return startText || endText || "";
}

export function DateRangeInput({ t, start, end, onChange, placeholder, disabled, style }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const display = formatDateRangeForDisplay(start, end);

  return (
    <div ref={rootRef} style={{ position: "relative", ...style }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...dateInputButton,
          color: display ? "#1f2937" : "#94a3b8",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {display || placeholder || t("選擇日期範圍")}
      </button>
      <DateRangePopover anchorRef={rootRef} panelRef={panelRef} open={open} onDismiss={() => setOpen(false)}>
        <DateRangePanel
          t={t}
          start={start}
          end={end}
          onChange={onChange}
          onComplete={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DateRangePopover>
    </div>
  );
}

export function DateRangePopover({ anchorRef, panelRef, open, onDismiss, children }) {
  const [position, setPosition] = useState(null);

  useEffect(() => {
    if (!open || !onDismiss) return undefined;
    function handlePointerDown(e) {
      if (anchorRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      onDismiss();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [anchorRef, onDismiss, open, panelRef]);

  useLayoutEffect(() => {
    if (!open) return undefined;

    function updatePosition() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const panelWidth = panelRef.current?.offsetWidth || 254;
      const panelHeight = panelRef.current?.offsetHeight || 362;
      const margin = 10;
      const gap = 6;
      const left = Math.min(
        Math.max(margin, rect.left),
        Math.max(margin, window.innerWidth - panelWidth - margin)
      );
      let top = rect.bottom + gap;
      if (top + panelHeight > window.innerHeight - margin && rect.top > panelHeight + margin) {
        top = rect.top - panelHeight - gap;
      }
      setPosition({ left, top });
    }

    updatePosition();
    const frame = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, panelRef, open]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      style={{
        ...floatingPopover,
        left: position?.left || 0,
        top: position?.top || 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body
  );
}

export function DateRangePanel({ t, start, end, onChange, onComplete, onCancel }) {
  const normalizedInitial = normalizeRange(start || "", end || "");
  const initialMonth = parseIsoDate(normalizedInitial.start) || parseIsoDate(normalizedInitial.end) || parseIsoDate(todayIso()) || new Date();
  const [viewMonth, setViewMonth] = useState(() => new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1));
  const [draft, setDraft] = useState(() => normalizedInitial);
  const [activeSide, setActiveSide] = useState("start");
  const [endEnabled, setEndEnabled] = useState(true);
  const currentToday = todayIso();

  useEffect(() => {
    const next = normalizeRange(start || "", end || "");
    setDraft(next);
    setEndEnabled(true);
    setActiveSide("start");
  }, [start, end]);

  const monthLabel = useMemo(() => {
    return viewMonth.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }, [viewMonth]);

  const calendarDays = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const startDate = new Date(first);
    startDate.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + index);
      return d;
    });
  }, [viewMonth]);

  function finish(next) {
    const normalized = normalizeRange(next.start || "", next.end || "");
    onChange?.(normalized);
    onComplete?.(normalized);
  }

  function selectDay(dayIso) {
    if (!endEnabled) {
      finish({ start: dayIso, end: "" });
      return;
    }
    if (activeSide === "start") {
      setDraft({ start: dayIso, end: "" });
      setActiveSide("end");
      return;
    }
    finish({ start: draft.start || dayIso, end: dayIso });
  }

  function toggleEnd() {
    if (endEnabled) {
      setEndEnabled(false);
      finish({ start: draft.start || "", end: "" });
      return;
    }
    setEndEnabled(true);
    setActiveSide(draft.start ? "end" : "start");
  }

  function clearRange() {
    finish({ start: "", end: "" });
  }

  return (
    <div style={panel} onKeyDown={(e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
      }
    }}>
      <div style={topInputs}>
        <button
          type="button"
          onClick={() => setActiveSide("start")}
          style={{ ...topDateBox, ...(activeSide === "start" ? activeDateBox : null) }}
        >
          {formatDisplayDate(draft.start) || t("開始日期")}
        </button>
        <button
          type="button"
          onClick={() => {
            setEndEnabled(true);
            setActiveSide("end");
          }}
          style={{ ...topDateBox, ...(activeSide === "end" ? activeDateBox : null), opacity: endEnabled ? 1 : 0.55 }}
        >
          {formatDisplayDate(draft.end) || t("結束日期")}
        </button>
      </div>

      <div style={monthHeader}>
        <div style={{ fontWeight: 700, color: "#334155" }}>{monthLabel}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" onClick={() => setViewMonth(addMonths(new Date(), 0))} style={textButton}>
            {t("今日")}
          </button>
          <button type="button" aria-label={t("上一個月")} onClick={() => setViewMonth((m) => addMonths(m, -1))} style={navButton}>
            ‹
          </button>
          <button type="button" aria-label={t("下一個月")} onClick={() => setViewMonth((m) => addMonths(m, 1))} style={navButton}>
            ›
          </button>
        </div>
      </div>

      <div style={weekGrid}>
        {WEEKDAY_KEYS.map((key) => (
          <div key={key} style={weekLabel}>{t(key)}</div>
        ))}
        {calendarDays.map((date) => {
          const iso = toIsoDate(date);
          const inMonth = date.getMonth() === viewMonth.getMonth();
          const selectedStart = iso === draft.start;
          const selectedEnd = iso === draft.end;
          const rangeStart = draft.start || "";
          const rangeEnd = endEnabled ? (draft.end || "") : "";
          const inRange = rangeStart && rangeEnd && compareIso(iso, rangeStart) >= 0 && compareIso(iso, rangeEnd) <= 0;
          const rangeLeftCap = inRange && (iso === rangeStart || date.getDay() === 0);
          const rangeRightCap = inRange && (iso === rangeEnd || date.getDay() === 6);
          const waitingEnd = activeSide === "end" && selectedStart && !draft.end;
          const isToday = iso === currentToday;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => selectDay(iso)}
              style={{
                ...dayCell,
                color: inMonth ? "#334155" : "#a7b0be",
                background: inRange ? "#d9ecff" : "transparent",
                borderTopLeftRadius: rangeLeftCap ? 6 : 0,
                borderBottomLeftRadius: rangeLeftCap ? 6 : 0,
                borderTopRightRadius: rangeRightCap ? 6 : 0,
                borderBottomRightRadius: rangeRightCap ? 6 : 0,
              }}
            >
              <span
                style={{
                  ...dayInner,
                  ...(selectedStart || selectedEnd ? selectedDay : null),
                  ...(waitingEnd ? selectedStartDay : null),
                  ...(isToday && !selectedStart && !selectedEnd ? todayDay : null),
                }}
              >
                {date.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      <div style={panelDivider} />
      <button type="button" onClick={toggleEnd} style={optionRow}>
        <span>{t("結束日期")}</span>
        <span style={{ ...switchTrack, background: endEnabled ? "#2f8dfd" : "#d9d9d9" }}>
          <span style={{ ...switchKnob, transform: endEnabled ? "translateX(16px)" : "translateX(0)" }} />
        </span>
      </button>
      <div style={optionRowStatic}>
        <span>{t("日期格式")}</span>
        <span style={{ color: "#7a7f87" }}>{t("月/日/年")}</span>
      </div>
      <div style={panelDivider} />
      <button type="button" onClick={clearRange} style={clearButton}>{t("清除")}</button>
    </div>
  );
}

const dateInputButton = {
  width: "100%",
  minHeight: 37,
  padding: "8px 10px",
  border: "1px solid #d8dce5",
  borderRadius: 7,
  background: "#fff",
  textAlign: "left",
  fontSize: 14,
  boxSizing: "border-box",
  cursor: "pointer",
};

const floatingPopover = { position: "fixed", zIndex: 2200 };

const panel = {
  width: 254,
  padding: 10,
  background: "#fff",
  border: "1px solid #dfe4ec",
  borderRadius: 10,
  boxShadow: "0 18px 42px rgba(15, 23, 42, 0.18)",
  boxSizing: "border-box",
};

const topInputs = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 };
const topDateBox = {
  height: 29,
  padding: "0 9px",
  border: "1px solid #d8dce5",
  borderRadius: 6,
  background: "#f8fafc",
  color: "#334155",
  fontSize: 13,
  textAlign: "left",
  cursor: "pointer",
};
const activeDateBox = { borderColor: "#1d7fe8", boxShadow: "0 0 0 2px rgba(29, 127, 232, 0.18)", background: "#eef6ff" };
const monthHeader = { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 2px" };
const textButton = { border: "none", background: "transparent", color: "#7a7f87", fontSize: 12, cursor: "pointer", padding: "2px 4px" };
const navButton = { border: "none", background: "transparent", color: "#9aa3af", fontSize: 25, lineHeight: 1, cursor: "pointer", padding: "0 1px" };
const weekGrid = { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", rowGap: 0 };
const weekLabel = { height: 24, display: "flex", alignItems: "center", justifyContent: "center", color: "#98a2b3", fontSize: 12 };
const dayCell = {
  height: 32,
  border: "none",
  borderRadius: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  fontSize: 13,
};
const dayInner = { width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" };
const selectedDay = { background: "#2384e8", color: "#fff", fontWeight: 700 };
const selectedStartDay = { boxShadow: "0 0 0 3px rgba(35, 132, 232, 0.14)" };
const todayDay = { background: "#e6655e", color: "#fff", fontWeight: 700, borderRadius: 999 };
const panelDivider = { height: 1, background: "#eef0f5", margin: "8px -10px" };
const optionRow = {
  width: "100%",
  minHeight: 28,
  border: "none",
  background: "transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "2px 0",
  fontSize: 13,
  color: "#334155",
  cursor: "pointer",
};
const optionRowStatic = { ...optionRow, cursor: "default" };
const switchTrack = { width: 34, height: 20, borderRadius: 999, padding: 2, boxSizing: "border-box", transition: "background 0.16s ease" };
const switchKnob = { display: "block", width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "transform 0.16s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" };
const clearButton = { border: "none", background: "transparent", color: "#334155", fontSize: 13, padding: "4px 0", cursor: "pointer" };
