import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { Icon } from "../components/Icon.jsx";
import { DateRangeInput, DateRangePanel, DateRangePopover, formatDateRangeForDisplay } from "../components/DateRangePicker.jsx";
import { useT } from "../i18n.jsx";
import { toastError } from "../lib/toast.js";

const RECORD_SELECT = "*, status:northbound_statuses(id,label,color,sort_order)";
const STATUS_COLORS = ["#f43f5e", "#6382ff", "#16a34a", "#f59e0b", "#8b5cf6", "#0891b2", "#64748b"];

const emptyForm = {
  remarks: "",
  submitted_at: "",
  submitted_end_at: "",
  name: "",
  plate_no: "",
  hkid: "",
  phone_hk: "",
  phone_mainland: "",
  address: "",
  hrp_no: "",
  status_id: "",
};

function textOrNull(v) {
  const s = String(v ?? "").trim();
  return s || null;
}

function dateOrNull(v) {
  return v ? v : null;
}

function fmtDate(v) {
  if (!v) return "";
  return String(v).slice(0, 10);
}

function fmtDateTime(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function buildPayload(form) {
  return {
    remarks: textOrNull(form.remarks),
    submitted_at: dateOrNull(form.submitted_at),
    submitted_end_at: dateOrNull(form.submitted_end_at),
    name: textOrNull(form.name),
    plate_no: textOrNull(form.plate_no),
    hkid: textOrNull(form.hkid),
    phone_hk: textOrNull(form.phone_hk),
    phone_mainland: textOrNull(form.phone_mainland),
    address: textOrNull(form.address),
    hrp_no: textOrNull(form.hrp_no),
    status_id: form.status_id || null,
  };
}

function statusFor(row, statuses) {
  return row.status || statuses.find((s) => s.id === row.status_id) || null;
}

function inlineValueFromRow(row, field) {
  if (!row) return "";
  if (field === "submitted_at" || field === "submitted_end_at") return fmtDate(row[field]);
  if (field === "status_id") return row.status_id || "";
  return row[field] || "";
}

function inlinePayloadValue(field, value) {
  if (field === "submitted_at" || field === "submitted_end_at") return dateOrNull(value);
  if (field === "status_id") return value || null;
  return textOrNull(value);
}

async function fetchAllNorthboundRecords() {
  const size = 1000;
  const { count, error: countError } = await supabase
    .from("northbound_records")
    .select("id", { count: "exact", head: true });
  if (countError) throw countError;

  const totalPages = Math.max(1, Math.ceil((count || 0) / size));
  const pagePromises = [];
  for (let i = 0; i < totalPages; i++) {
    const from = i * size;
    pagePromises.push(
      supabase
        .from("northbound_records")
        .select(RECORD_SELECT)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + size - 1)
    );
  }

  const pages = await Promise.all(pagePromises);
  const seen = new Set();
  const records = [];
  for (const page of pages) {
    if (page.error) throw page.error;
    for (const row of page.data || []) {
      if (row?.id != null) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
      }
      records.push(row);
    }
  }
  return records;
}

function StatusChip({ status, t }) {
  if (!status) {
    return (
      <span style={{ ...chipStyle, background: "#f3f4f6", color: "#64748b", borderColor: "#e5e7eb" }}>
        {t("未設定情況")}
      </span>
    );
  }
  const color = status.color || "#64748b";
  return (
    <span style={{ ...chipStyle, background: `${color}18`, color, borderColor: `${color}44` }}>
      {t(status.label)}
    </span>
  );
}

function InlineEditableCell({
  row,
  field,
  type = "text",
  statuses = [],
  inlineEdit,
  savingKey,
  onStart,
  onDraftChange,
  onCommit,
  onCancel,
  t,
  style,
  children,
}) {
  const editKey = `${row.id}:${field}`;
  const editing = inlineEdit?.rowId === row.id && inlineEdit.field === field;
  const saving = savingKey === editKey;
  const cellStyle = {
    ...td,
    ...style,
    cursor: editing ? "default" : "text",
    opacity: saving ? 0.65 : 1,
  };

  if (!editing) {
    return (
      <td style={cellStyle} onDoubleClick={() => onStart(row.id, field)}>
        {children}
      </td>
    );
  }

  const commonProps = {
    value: inlineEdit.value,
    disabled: saving,
    autoFocus: true,
    onChange: (e) => onDraftChange(row.id, field, e.target.value),
    onBlur: (e) => onCommit(row.id, field, e.target.value),
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onCommit(row.id, field, e.target.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel(row.id, field);
      }
    },
  };

  if (type === "select") {
    return (
      <td style={cellStyle}>
        <select {...commonProps} style={inlineInputStyle}>
          <option value="">{t("未設定情況")}</option>
          {statuses.map((s) => <option key={s.id} value={s.id}>{t(s.label)}</option>)}
        </select>
      </td>
    );
  }

  return (
    <td style={cellStyle}>
      <input
        {...commonProps}
        type={type}
        onFocus={type === "text" ? (e) => e.target.select() : undefined}
        style={inlineInputStyle}
      />
    </td>
  );
}

function InlineDateRangeCell({
  row,
  dateRangeEdit,
  dateRangeSaving,
  panelRef,
  onStart,
  onDraftChange,
  onCommit,
  onCancel,
  t,
}) {
  const cellRef = useRef(null);
  const editKey = `${row.id}:submitted_range`;
  const editing = dateRangeEdit?.rowId === row.id;
  const saving = dateRangeSaving === editKey;
  const display = formatDateRangeForDisplay(fmtDate(row.submitted_at), fmtDate(row.submitted_end_at));
  const cellStyle = {
    ...td,
    position: "relative",
    whiteSpace: "nowrap",
    cursor: editing ? "default" : "text",
    opacity: saving ? 0.65 : 1,
    minWidth: 190,
  };

  return (
    <td ref={cellRef} style={cellStyle} onDoubleClick={() => onStart(row)}>
      {display || "—"}
      <DateRangePopover anchorRef={cellRef} panelRef={panelRef} open={editing} onDismiss={onCancel}>
        <DateRangePanel
          t={t}
          start={dateRangeEdit?.start || ""}
          end={dateRangeEdit?.end || ""}
          onChange={onDraftChange}
          onComplete={(next) => onCommit(row.id, next.start, next.end)}
          onCancel={onCancel}
        />
      </DateRangePopover>
    </td>
  );
}

function NorthboundForm({ t, statuses, onClose, onSaved, onCreateStatus }) {
  const [form, setForm] = useState(() => ({ ...emptyForm }));
  const [saving, setSaving] = useState(false);
  const [creatingStatus, setCreatingStatus] = useState(false);
  const [newStatusLabel, setNewStatusLabel] = useState("");
  const [err, setErr] = useState("");

  function patch(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreateStatus() {
    const label = newStatusLabel.trim();
    if (!label) {
      setErr(t("請輸入情況標籤"));
      return;
    }
    setCreatingStatus(true);
    setErr("");
    try {
      const status = await onCreateStatus(label);
      patch("status_id", status.id);
      setNewStatusLabel("");
    } catch (e) {
      toastError(t("新增情況失敗"), { detail: e });
    } finally {
      setCreatingStatus(false);
    }
  }

  async function handleSubmit() {
    setErr("");
    const payload = buildPayload(form);
    if (!payload.name) {
      setErr(t("請輸入名稱"));
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.from("northbound_records").insert(payload).select(RECORD_SELECT).single();
      if (error) throw error;
      onSaved(data);
    } catch (e) {
      toastError(t("保存失敗"), { detail: e });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={modalBackdrop}>
      <div onClick={(e) => e.stopPropagation()} style={modalPanel}>
        <div style={modalHead}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#1a2138" }}>
            {t("新增港車北上")}
          </div>
          <button onClick={onClose} style={closeBtn}>×</button>
        </div>

        <div style={{ padding: 22 }}>
          <div style={formGrid}>
            <Field label={t("名稱")} required>
              <input value={form.name} onChange={(e) => patch("name", e.target.value)} style={inputStyle} />
            </Field>
            <Field label={t("車牌")}>
              <input value={form.plate_no} onChange={(e) => patch("plate_no", e.target.value)} style={inputStyle} />
            </Field>
            <Field label={t("身份證")}>
              <input value={form.hkid} onChange={(e) => patch("hkid", e.target.value)} style={inputStyle} />
            </Field>
            <Field label={t("回鄉證")}>
              <input value={form.hrp_no} onChange={(e) => patch("hrp_no", e.target.value)} style={inputStyle} />
            </Field>
            <Field label={t("香港電話")}>
              <input value={form.phone_hk} onChange={(e) => patch("phone_hk", e.target.value)} style={inputStyle} />
            </Field>
            <Field label={t("大陸電話")}>
              <input value={form.phone_mainland} onChange={(e) => patch("phone_mainland", e.target.value)} style={inputStyle} />
            </Field>
            <div style={{ gridColumn: "span 2" }}>
              <Field label={t("交資料日期")}>
                <DateRangeInput
                  t={t}
                  start={form.submitted_at}
                  end={form.submitted_end_at}
                  placeholder={t("選擇日期範圍")}
                  onChange={(next) => setForm((prev) => ({
                    ...prev,
                    submitted_at: next.start,
                    submitted_end_at: next.end,
                  }))}
                />
              </Field>
            </div>
          </div>

          <Field label={t("地址")}>
            <textarea value={form.address} onChange={(e) => patch("address", e.target.value)} rows={2} style={textareaStyle} />
          </Field>

          <Field label={t("備注")}>
            <textarea value={form.remarks} onChange={(e) => patch("remarks", e.target.value)} rows={3} style={textareaStyle} />
          </Field>

          <div style={{ marginBottom: 14 }}>
            <Field label={t("情況")}>
              <select value={form.status_id} onChange={(e) => patch("status_id", e.target.value)} style={{ ...inputStyle, background: "#fff" }}>
                <option value="">{t("未設定情況")}</option>
                {statuses.map((s) => <option key={s.id} value={s.id}>{t(s.label)}</option>)}
              </select>
            </Field>
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
              <input
                value={newStatusLabel}
                onChange={(e) => setNewStatusLabel(e.target.value)}
                placeholder={t("輸入新情況")}
                style={{ ...inputStyle, flex: 1, marginTop: 0 }}
              />
              <button onClick={handleCreateStatus} disabled={creatingStatus} style={secondaryBtn}>
                {creatingStatus ? t("保存中…") : t("新增情況")}
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#8899aa", marginTop: 6 }}>
              {t("使用者可自建情況標籤")}
            </div>
          </div>

          {err && <div style={errorBox}>{err}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} style={secondaryBtn}>{t("取消")}</button>
            <button onClick={handleSubmit} disabled={saving || creatingStatus} style={{ ...primaryBtn, opacity: saving || creatingStatus ? 0.6 : 1 }}>
              {saving ? t("保存中…") : t("保存")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#4b5563", marginBottom: 14 }}>
      {label}{required ? <span style={{ color: "#ef4444", marginLeft: 3 }}>*</span> : null}
      <div style={{ marginTop: 5 }}>{children}</div>
    </label>
  );
}

export default function NorthboundView() {
  const { t } = useT();
  const [records, setRecords] = useState([]);
  const recordsRef = useRef([]);
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [inlineEdit, setInlineEdit] = useState(null);
  const [inlineSaving, setInlineSaving] = useState("");
  const inlineSavingRef = useRef("");
  const inlineCancelRef = useRef("");
  const [dateRangeEdit, setDateRangeEdit] = useState(null);
  const [dateRangeSaving, setDateRangeSaving] = useState("");
  const dateRangeSavingRef = useRef("");
  const dateRangePanelRef = useRef(null);

  const sortedStatuses = useMemo(() => {
    return [...statuses].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.label || "").localeCompare(String(b.label || "")));
  }, [statuses]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: statusData, error: statusError }, recordData] = await Promise.all([
        supabase.from("northbound_statuses").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
        fetchAllNorthboundRecords(),
      ]);
      if (statusError) throw statusError;
      setStatuses(statusData || []);
      recordsRef.current = recordData || [];
      setRecords(recordData || []);
    } catch (e) {
      toastError(t("載入失敗"), { detail: e });
      setStatuses([]);
      recordsRef.current = [];
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const m = { all: records.length, none: 0 };
    records.forEach((row) => {
      if (row.status_id) m[row.status_id] = (m[row.status_id] || 0) + 1;
      else m.none += 1;
    });
    return m;
  }, [records]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((row) => {
      if (statusFilter === "none" && row.status_id) return false;
      if (statusFilter !== "all" && statusFilter !== "none" && row.status_id !== statusFilter) return false;
      if (!q) return true;
      return [row.name, row.plate_no, row.phone_hk, row.phone_mainland]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [records, search, statusFilter]);

  async function createStatus(label) {
    const payload = {
      label,
      color: STATUS_COLORS[statuses.length % STATUS_COLORS.length],
      sort_order: ((statuses[statuses.length - 1]?.sort_order ?? statuses.length * 10) + 10),
    };
    const { data, error } = await supabase.from("northbound_statuses").insert(payload).select("*").single();
    if (error) throw error;
    setStatuses((prev) => [...prev, data]);
    return data;
  }

  function openCreate() {
    setShowForm(true);
  }

  function handleSaved(row) {
    setRecords((prev) => {
      const exists = prev.some((r) => r.id === row.id);
      const next = exists ? prev.map((r) => (r.id === row.id ? row : r)) : [row, ...prev];
      recordsRef.current = next;
      return next;
    });
    setShowForm(false);
  }

  function startInlineEdit(rowId, field) {
    if (inlineSavingRef.current) return;
    setDateRangeEdit(null);
    const current = recordsRef.current.find((r) => r.id === rowId);
    if (!current) return;
    setInlineEdit({ rowId, field, value: inlineValueFromRow(current, field) });
  }

  function startDateRangeEdit(row) {
    if (dateRangeSavingRef.current || inlineSavingRef.current) return;
    setInlineEdit(null);
    setDateRangeEdit({
      rowId: row.id,
      start: fmtDate(row.submitted_at),
      end: fmtDate(row.submitted_end_at),
    });
  }

  function patchInlineDraft(rowId, field, value) {
    setInlineEdit((prev) => (
      prev?.rowId === rowId && prev.field === field ? { ...prev, value } : prev
    ));
  }

  function cancelInlineEdit(rowId, field) {
    const key = `${rowId}:${field}`;
    inlineCancelRef.current = key;
    setInlineEdit((prev) => (prev?.rowId === rowId && prev.field === field ? null : prev));
    setTimeout(() => {
      if (inlineCancelRef.current === key) inlineCancelRef.current = "";
    }, 0);
  }

  function patchDateRangeDraft(next) {
    setDateRangeEdit((prev) => (prev ? { ...prev, start: next.start || "", end: next.end || "" } : prev));
  }

  function cancelDateRangeEdit() {
    setDateRangeEdit(null);
  }

  async function commitInlineEdit(rowId, field, value) {
    const key = `${rowId}:${field}`;
    if (inlineCancelRef.current === key) {
      inlineCancelRef.current = "";
      return;
    }
    if (inlineSavingRef.current === key) return;
    const current = recordsRef.current.find((r) => r.id === rowId);
    if (!current) {
      setInlineEdit((prev) => (prev?.rowId === rowId && prev.field === field ? null : prev));
      return;
    }
    if (inlineValueFromRow(current, field) === String(value ?? "")) {
      setInlineEdit((prev) => (prev?.rowId === rowId && prev.field === field ? null : prev));
      return;
    }

    inlineSavingRef.current = key;
    setInlineSaving(key);
    try {
      const { data, error } = await supabase
        .from("northbound_records")
        .update({ [field]: inlinePayloadValue(field, value) })
        .eq("id", rowId)
        .select(RECORD_SELECT)
        .single();
      if (error) throw error;
      setRecords((prev) => {
        const next = prev.map((r) => (r.id === data.id ? data : r));
        recordsRef.current = next;
        return next;
      });
      setInlineEdit((prev) => (prev?.rowId === rowId && prev.field === field ? null : prev));
    } catch (e) {
      toastError(t("保存失敗"), { detail: e });
      setInlineEdit((prev) => (prev?.rowId === rowId && prev.field === field ? null : prev));
    } finally {
      inlineSavingRef.current = "";
      setInlineSaving("");
    }
  }

  async function commitDateRangeEdit(rowId, start, end) {
    const key = `${rowId}:submitted_range`;
    if (dateRangeSavingRef.current === key) return;
    const current = recordsRef.current.find((r) => r.id === rowId);
    if (!current) {
      setDateRangeEdit((prev) => (prev?.rowId === rowId ? null : prev));
      return;
    }
    const nextStart = start || "";
    const nextEnd = end || "";
    if (fmtDate(current.submitted_at) === nextStart && fmtDate(current.submitted_end_at) === nextEnd) {
      setDateRangeEdit((prev) => (prev?.rowId === rowId ? null : prev));
      return;
    }

    dateRangeSavingRef.current = key;
    setDateRangeSaving(key);
    try {
      const { data, error } = await supabase
        .from("northbound_records")
        .update({
          submitted_at: dateOrNull(nextStart),
          submitted_end_at: dateOrNull(nextEnd),
        })
        .eq("id", rowId)
        .select(RECORD_SELECT)
        .single();
      if (error) throw error;
      setRecords((prev) => {
        const next = prev.map((r) => (r.id === data.id ? data : r));
        recordsRef.current = next;
        return next;
      });
      setDateRangeEdit((prev) => (prev?.rowId === rowId ? null : prev));
    } catch (e) {
      toastError(t("保存失敗"), { detail: e });
      setDateRangeEdit((prev) => (prev?.rowId === rowId ? null : prev));
    } finally {
      dateRangeSavingRef.current = "";
      setDateRangeSaving("");
    }
  }

  async function deleteRecord(row) {
    if (!window.confirm(t("確認刪除這筆港車北上記錄？"))) return;
    setDeletingId(row.id);
    const { error } = await supabase.from("northbound_records").delete().eq("id", row.id);
    setDeletingId(null);
    if (error) {
      toastError(t("刪除失敗"), { detail: error });
      return;
    }
    setRecords((prev) => {
      const next = prev.filter((r) => r.id !== row.id);
      recordsRef.current = next;
      return next;
    });
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#1a2138" }}>{t("港車北上")}</div>
          <div style={{ fontSize: 13, color: "#8899cc", marginTop: 4 }}>
            {t("管理港車北上申請資料與跟進情況")}
          </div>
        </div>
        <button onClick={openCreate} style={{ ...primaryBtn, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="plus" size={16} /> {t("新增港車北上")}
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div style={{ ...searchBox, flex: "1 1 260px" }}>
          <Icon name="search" size={15} />
          <input
            placeholder={t("搜尋名稱 / 車牌 / 電話…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%", minWidth: 0 }}
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, flex: "0 1 240px", minWidth: 180, marginTop: 0, background: "#fff" }}>
          <option value="all">{t("全部情況")} ({counts.all})</option>
          <option value="none">{t("未設定情況")} ({counts.none})</option>
          {sortedStatuses.map((s) => <option key={s.id} value={s.id}>{t(s.label)} ({counts[s.id] || 0})</option>)}
        </select>
      </div>

      <div style={{ marginBottom: 12, fontSize: 13, color: "#556", display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span>{t("共")} {records.length} {t("筆")}</span>
        <span>{t("可見")} {filtered.length} {t("筆")}</span>
      </div>

      <div style={tableShell}>
        <div style={tableScroller}>
          <table style={{ width: "100%", minWidth: 1120, borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "#556", textAlign: "left" }}>
                <th style={th}>{t("情況")}</th>
                <th style={th}>{t("交資料日期")}</th>
                <th style={th}>{t("名稱")}</th>
                <th style={th}>{t("車牌")}</th>
                <th style={th}>{t("身份證")}</th>
                <th style={th}>{t("香港電話")}</th>
                <th style={th}>{t("大陸電話")}</th>
                <th style={th}>{t("地址")}</th>
                <th style={th}>{t("回鄉證")}</th>
                <th style={th}>{t("備注")}</th>
                <th style={th}>{t("建立時間")}</th>
                <th style={th}>{t("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={12} style={emptyCell}>{t("載入中…")}</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={12} style={emptyCell}>{t("暫無記錄")}</td></tr>
              )}
              {!loading && filtered.map((row) => {
                const status = statusFor(row, sortedStatuses);
                const inlineCellProps = {
                  row,
                  inlineEdit,
                  savingKey: inlineSaving,
                  onStart: startInlineEdit,
                  onDraftChange: patchInlineDraft,
                  onCommit: commitInlineEdit,
                  onCancel: cancelInlineEdit,
                  t,
                };
                return (
                  <tr key={row.id} style={{ borderTop: "1px solid #eef0f5" }}>
                    <InlineEditableCell {...inlineCellProps} field="status_id" type="select" statuses={sortedStatuses}>
                      <StatusChip status={status} t={t} />
                    </InlineEditableCell>
                    <InlineDateRangeCell
                      row={row}
                      dateRangeEdit={dateRangeEdit}
                      dateRangeSaving={dateRangeSaving}
                      panelRef={dateRangePanelRef}
                      onStart={startDateRangeEdit}
                      onDraftChange={patchDateRangeDraft}
                      onCommit={commitDateRangeEdit}
                      onCancel={cancelDateRangeEdit}
                      t={t}
                    />
                    <InlineEditableCell {...inlineCellProps} field="name" style={{ fontWeight: 700, color: "#1f2937" }}>
                      {row.name || "—"}
                    </InlineEditableCell>
                    <InlineEditableCell {...inlineCellProps} field="plate_no">
                      {row.plate_no || "—"}
                    </InlineEditableCell>
                    <InlineEditableCell {...inlineCellProps} field="hkid">
                      {row.hkid || "—"}
                    </InlineEditableCell>
                    <InlineEditableCell {...inlineCellProps} field="phone_hk">
                      {row.phone_hk || "—"}
                    </InlineEditableCell>
                    <InlineEditableCell {...inlineCellProps} field="phone_mainland">
                      {row.phone_mainland || "—"}
                    </InlineEditableCell>
                    <InlineEditableCell {...inlineCellProps} field="address" style={{ minWidth: 180, whiteSpace: "pre-wrap" }}>
                      {row.address || "—"}
                    </InlineEditableCell>
                    <InlineEditableCell {...inlineCellProps} field="hrp_no">
                      {row.hrp_no || "—"}
                    </InlineEditableCell>
                    <InlineEditableCell {...inlineCellProps} field="remarks" style={{ minWidth: 180, whiteSpace: "pre-wrap" }}>
                      {row.remarks || "—"}
                    </InlineEditableCell>
                    <td style={{ ...td, whiteSpace: "nowrap", color: "#6b7280" }}>{fmtDateTime(row.created_at) || "—"}</td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button onClick={() => deleteRecord(row)} disabled={deletingId === row.id} style={btnSmRed}>
                          {deletingId === row.id ? t("刪除中…") : t("刪除")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <NorthboundForm
          t={t}
          statuses={sortedStatuses}
          onClose={() => { setShowForm(false); }}
          onSaved={handleSaved}
          onCreateStatus={createStatus}
        />
      )}
    </div>
  );
}

const tableShell = { background: "#fff", border: "1px solid #eef0f5", borderRadius: 12, overflow: "hidden", height: "calc(100vh - 248px)", minHeight: 360, maxHeight: 620 };
const tableScroller = { height: "100%", overflow: "auto" };
const th = { position: "sticky", top: 0, zIndex: 3, background: "#f7f8fc", padding: "10px 14px", fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" };
const td = { padding: "12px 14px", verticalAlign: "top" };
const emptyCell = { padding: 34, textAlign: "center", color: "#999" };
const chipStyle = { display: "inline-block", padding: "3px 10px", borderRadius: 999, border: "1px solid", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" };
const primaryBtn = { padding: "9px 18px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 };
const secondaryBtn = { padding: "8px 14px", border: "1px solid #d8dce5", background: "#fff", color: "#556", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" };
const btnSmRed = { padding: "4px 10px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 700 };
const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid #d8dce5", borderRadius: 7, fontSize: 14, boxSizing: "border-box" };
const inlineInputStyle = { ...inputStyle, minWidth: 130, marginTop: 0, background: "#fff" };
const textareaStyle = { ...inputStyle, resize: "vertical", fontFamily: "inherit" };
const searchBox = { background: "#fff", borderRadius: 12, border: "1px solid #eef0f5", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, minWidth: 0 };
const modalBackdrop = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.42)", zIndex: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 };
const modalPanel = { background: "#fff", borderRadius: 12, width: 720, maxWidth: "94vw", maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.2)" };
const modalHead = { padding: "18px 22px", borderBottom: "1px solid #eef0f5", display: "flex", justifyContent: "space-between", alignItems: "center" };
const closeBtn = { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#999", lineHeight: 1 };
const formGrid = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0 14px" };
const errorBox = { background: "#ffebee", color: "#c62828", padding: "8px 12px", borderRadius: 7, fontSize: 13, marginBottom: 14 };
