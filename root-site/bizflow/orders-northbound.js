import { getNorthboundData } from "../data/provider.js";
import { formatDateTime } from "../data/live-snapshot-utils.js";
import { attachLiveSnapshotRefresh } from "../data/live-snapshot-listener.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { createDateRangePanel } from "../components/date-range-panel.js";
import {
  createLiveNorthboundRecord,
  createLiveNorthboundStatus,
  deleteLiveNorthboundRecord,
  updateLiveNorthboundRecord
} from "../data/live-northbound-writes.js";

const PAGE_CHUNK = 50;
// 本地新增情況沿用 bizflow 现网港車北上状态色；这些值写入本地 status 数据，不是页面散落样式。
const NORTHBOUND_STATUS_COLOR = Object.freeze({
  urgent: "#E01010", // 现网红：异常/需优先跟进状态。
  active: "#0B72E7", // 现网蓝：处理中状态。
  completed: "#16A34A", // 现网绿：已完成状态。
  pending: "#F59E0B", // 现网琥珀：等待处理状态。
  alternate: "#8B5CF6", // 现网紫：辅助区分状态。
  info: "#0891B2", // 现网青：信息类状态。
  neutral: "#5C5C5C" // 现网灰：未归类/兜底状态。
});
const LOCAL_STATUS_COLORS = Object.freeze(Object.values(NORTHBOUND_STATUS_COLOR));
const TEXT_FIELDS = ["name", "plateNo", "hkid", "phoneHk", "phoneMainland", "address", "hrpNo", "remarks"];
const STATUS_DISPLAY_ORDER = ["已交表", "己完成", "已開單", "己付款", "已交表/未付款", "旧问题客人", "1+1", "已支付1個月禁區紙費用"];

const copy = {
  zh: {
    title: "港車北上",
    description: "管理港車北上申請資料與跟進情況",
    add: "新增港車北上",
    search: "搜尋名稱 / 車牌 / 電話…",
    allStatuses: "全部情況",
    noStatus: "未設定情況",
    total: "共",
    visible: "可見",
    records: "筆",
    status: "情況",
    submitted: "交資料日期",
    name: "名稱",
    plateNo: "車牌",
    hkid: "身份證",
    phoneHk: "香港電話",
    phoneMainland: "大陸電話",
    address: "地址",
    hrpNo: "回鄉證",
    remarks: "備注",
    createdAt: "建立時間",
    action: "操作",
    delete: "刪除",
    deleteConfirm: "確認刪除這筆港車北上記錄？",
    empty: "暫無記錄",
    loading: "載入中…",
    loadMore: "載入更多",
    showing: "已顯示",
    modalTitle: "新增港車北上",
    requiredName: "請輸入名稱",
    startDate: "開始日期",
    endDate: "結束日期",
    newStatus: "新增情況",
    newStatusPlaceholder: "輸入新情況",
    statusRequired: "請輸入情況標籤",
    saveFailed: "保存失敗，請重試",
    deleteFailed: "刪除失敗，請重試",
    statusCreateFailed: "新增情況失敗，請重試",
    cancel: "取消",
    save: "保存",
    close: "關閉",
    dateRange: "日期區間",
    today: "今天",
    previousMonth: "上個月",
    nextMonth: "下個月",
    year: "年份",
    chooseMonth: "選擇年月",
    clear: "清除",
    complete: "完成"
  },
  en: {
    title: "Northbound vehicles",
    description: "Manage applications and follow-up statuses",
    add: "Add northbound record",
    search: "Search name / plate / phone…",
    allStatuses: "All statuses",
    noStatus: "No status",
    total: "Total",
    visible: "Visible",
    records: "records",
    status: "Status",
    submitted: "Submission dates",
    name: "Name",
    plateNo: "Plate",
    hkid: "HKID",
    phoneHk: "Hong Kong phone",
    phoneMainland: "Mainland phone",
    address: "Address",
    hrpNo: "Home Return Permit",
    remarks: "Remarks",
    createdAt: "Created",
    action: "Action",
    delete: "Delete",
    deleteConfirm: "Delete this northbound record?",
    empty: "No records",
    loading: "Loading…",
    loadMore: "Load more",
    showing: "Showing",
    modalTitle: "Add northbound record",
    requiredName: "Name is required",
    startDate: "Start date",
    endDate: "End date",
    newStatus: "Add status",
    newStatusPlaceholder: "New status name",
    statusRequired: "Enter a status name",
    saveFailed: "Save failed. Please try again.",
    deleteFailed: "Delete failed. Please try again.",
    statusCreateFailed: "Could not add the status. Please try again.",
    cancel: "Cancel",
    save: "Save",
    close: "Close",
    dateRange: "Date range",
    today: "Today",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    year: "Year",
    chooseMonth: "Choose year and month",
    clear: "Clear",
    complete: "Done"
  },
  fr: {
    title: "Véhicules vers le nord",
    description: "Gérer les demandes et leur suivi",
    add: "Ajouter un dossier",
    search: "Rechercher nom / plaque / téléphone…",
    allStatuses: "Tous les statuts",
    noStatus: "Sans statut",
    total: "Total",
    visible: "Visibles",
    records: "dossiers",
    status: "Statut",
    submitted: "Dates de remise",
    name: "Nom",
    plateNo: "Plaque",
    hkid: "Identité HK",
    phoneHk: "Téléphone Hong Kong",
    phoneMainland: "Téléphone Chine",
    address: "Adresse",
    hrpNo: "Permis de retour",
    remarks: "Remarques",
    createdAt: "Créé le",
    action: "Action",
    delete: "Supprimer",
    deleteConfirm: "Supprimer ce dossier ?",
    empty: "Aucun dossier",
    loading: "Chargement…",
    loadMore: "Charger plus",
    showing: "Affichés",
    modalTitle: "Ajouter un dossier",
    requiredName: "Le nom est obligatoire",
    startDate: "Date de début",
    endDate: "Date de fin",
    newStatus: "Ajouter un statut",
    newStatusPlaceholder: "Nouveau statut",
    statusRequired: "Saisissez un statut",
    saveFailed: "Échec de l’enregistrement. Réessayez.",
    deleteFailed: "Échec de la suppression. Réessayez.",
    statusCreateFailed: "Impossible d’ajouter le statut. Réessayez.",
    cancel: "Annuler",
    save: "Enregistrer",
    close: "Fermer",
    dateRange: "Période",
    today: "Aujourd’hui",
    previousMonth: "Mois précédent",
    nextMonth: "Mois suivant",
    year: "Année",
    chooseMonth: "Choisir l’année et le mois",
    clear: "Effacer",
    complete: "Terminer"
  }
};

const state = {
  loaded: false,
  loading: false,
  records: [],
  statuses: [],
  search: "",
  statusFilter: "all",
  visibleLimit: PAGE_CHUNK,
  edit: null,
  modalOpen: false,
  form: {},
  formError: "",
  error: "",
  newStatusLabel: ""
};

let currentHelpers = null;
let rerender = () => {};
let modalReturnFocus = null;
let lastTouchTap = { key: "", at: 0 };
let searchRenderTimer = null;
const submittedRangePanel = createDateRangePanel();
let activeScope = null;
let dataLoadVersion = 0;

function t(lang, key) {
  return copy[lang]?.[key] ?? copy.zh[key] ?? key;
}

function localeForLang(lang) {
  if (lang === "en") return "en-GB";
  if (lang === "fr") return "fr-FR";
  return "zh-HK";
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : LOCAL_STATUS_COLORS.at(-1);
}

function liveReadOnly() {
  return currentHelpers?.liveReadOnly === true;
}

function liveMode() {
  return currentHelpers?.liveMode === true;
}

function showWriteError(key, { form = false } = {}) {
  if (form) state.formError = t(currentHelpers?.lang, key);
  else state.error = t(currentHelpers?.lang, key);
}

function liveRecord(row, current = null) {
  return {
    id: row.id,
    name: row.name || "",
    plateNo: row.plate_no || "",
    hkid: row.hkid || "",
    phoneHk: row.phone_hk || "",
    phoneMainland: row.phone_mainland || "",
    address: row.address || "",
    hrpNo: row.hrp_no || "",
    remarks: row.remarks || "",
    submittedAt: row.submitted_at || null,
    submittedEndAt: row.submitted_end_at || null,
    statusId: row.status_id || null,
    createdAt: current?.createdAt || formatDateTime(row.created_at)
  };
}

function liveStatus(row) {
  return { id: row.id, label: row.label, color: row.color, sortOrder: Number(row.sort_order) || 0 };
}

export function normalizeNorthboundStatusLabel(label) {
  const uniqueParts = [...new Set(String(label || "").split(/[,，]/).map((part) => part.trim()).filter(Boolean))];
  return uniqueParts.at(-1) ?? "";
}

function normalizedStatuses() {
  const groups = new Map();
  const rawStatuses = [...state.statuses].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  for (const raw of rawStatuses) {
    const key = normalizeNorthboundStatusLabel(raw.label);
    if (!key) continue;
    const current = groups.get(key);
    const base = !/[,，]/.test(raw.label);
    if (!current) {
      groups.set(key, { ...raw, key, label: key, statusIds: [raw.id], base });
      continue;
    }
    current.statusIds.push(raw.id);
    if (base && !current.base) {
      Object.assign(current, { id: raw.id, color: raw.color, sortOrder: raw.sortOrder, base: true });
    }
  }
  return [...groups.values()].sort((a, b) => {
    const aIndex = STATUS_DISPLAY_ORDER.indexOf(a.key);
    const bIndex = STATUS_DISPLAY_ORDER.indexOf(b.key);
    if (aIndex !== bIndex) return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
    return a.sortOrder - b.sortOrder || a.label.localeCompare(b.label);
  });
}

function normalizedStatusById(id) {
  if (!id) return null;
  const key = statusKeyById(id);
  return normalizedStatuses().find((status) => status.key === key) ?? null;
}

function statusKeyById(id) {
  const raw = state.statuses.find((status) => status.id === id);
  return raw ? normalizeNorthboundStatusLabel(raw.label) : null;
}

function filteredRecords() {
  const query = state.search.trim().toLocaleLowerCase();
  return state.records.filter((record) => {
    const statusKey = statusKeyById(record.statusId);
    if (state.statusFilter === "none" && statusKey !== null) return false;
    if (!["all", "none"].includes(state.statusFilter) && statusKey !== state.statusFilter) return false;
    if (!query) return true;
    return [record.name, record.plateNo, record.phoneHk, record.phoneMainland]
      .some((value) => String(value || "").toLocaleLowerCase().includes(query));
  });
}

function statusCounts() {
  const counts = { all: state.records.length, none: 0 };
  state.records.forEach((record) => {
    const key = statusKeyById(record.statusId) ?? "none";
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function displayValue(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function renderStatusChip(status, helpers) {
  if (!status) return `<span class="northbound-status-chip northbound-status-chip--empty">${helpers.escapeHtml(t(helpers.lang, "noStatus"))}</span>`;
  const color = safeColor(status.color);
  return `<span class="northbound-status-chip" style="--northbound-status-color:${helpers.escapeHtml(color)}" title="${helpers.escapeHtml(status.label)}">${helpers.escapeHtml(status.label)}</span>`;
}

function editValue(record, field) {
  if (field === "submittedRange") return { start: record.submittedAt || "", end: record.submittedEndAt || "" };
  return record[field] ?? "";
}

function renderEditableCell(record, field, content, helpers, className = "") {
  const { escapeHtml, lang } = helpers;
  const editing = !helpers.liveReadOnly && state.edit?.rowId === record.id && state.edit.field === field;
  if (!editing) {
    const editAttributes = helpers.liveReadOnly ? "" : ` data-northbound-edit-cell data-row-id="${escapeHtml(record.id)}" data-field="${escapeHtml(field)}"`;
    return `<td class="northbound-cell ${className}"${editAttributes}>${content}</td>`;
  }
  if (field === "statusId") {
    return `<td class="northbound-cell ${className}" data-northbound-edit-active>
      <select class="northbound-inline-input" data-northbound-inline-input data-row-id="${escapeHtml(record.id)}" data-field="statusId" autofocus>
        <option value="">${escapeHtml(t(lang, "noStatus"))}</option>
        ${normalizedStatuses().map((status) => `<option value="${escapeHtml(status.id)}"${normalizedStatusById(record.statusId)?.key === status.key ? " selected" : ""}>${escapeHtml(status.label)}</option>`).join("")}
      </select>
    </td>`;
  }
  return `<td class="northbound-cell ${className}" data-northbound-edit-active>
    <input type="text" class="northbound-inline-input" data-northbound-inline-input data-row-id="${escapeHtml(record.id)}" data-field="${escapeHtml(field)}" value="${escapeHtml(editValue(record, field))}" autofocus>
  </td>`;
}

function renderRecord(record, helpers) {
  const { escapeHtml, lang } = helpers;
  const status = normalizedStatusById(record.statusId);
  const dateRange = record.submittedAt || record.submittedEndAt
    ? `${displayValue(record.submittedAt)} – ${displayValue(record.submittedEndAt)}`
    : "—";
  return `<tr data-northbound-row data-row-id="${escapeHtml(record.id)}">
    ${renderEditableCell(record, "statusId", renderStatusChip(status, helpers), helpers)}
    ${renderEditableCell(record, "submittedRange", escapeHtml(dateRange), helpers, "northbound-cell--dates")}
    ${renderEditableCell(record, "name", escapeHtml(displayValue(record.name)), helpers, "northbound-cell--name")}
    ${renderEditableCell(record, "plateNo", escapeHtml(displayValue(record.plateNo)), helpers)}
    ${renderEditableCell(record, "hkid", escapeHtml(displayValue(record.hkid)), helpers)}
    ${renderEditableCell(record, "phoneHk", escapeHtml(displayValue(record.phoneHk)), helpers)}
    ${renderEditableCell(record, "phoneMainland", escapeHtml(displayValue(record.phoneMainland)), helpers)}
    ${renderEditableCell(record, "address", escapeHtml(displayValue(record.address)), helpers, "northbound-cell--long northbound-cell--address")}
    ${renderEditableCell(record, "hrpNo", escapeHtml(displayValue(record.hrpNo)), helpers)}
    ${renderEditableCell(record, "remarks", escapeHtml(displayValue(record.remarks)), helpers, "northbound-cell--long")}
    <td class="northbound-cell northbound-cell--nowrap">${escapeHtml(displayValue(record.createdAt))}</td>
    <td class="northbound-cell"><button type="button" class="northbound-delete" data-northbound-delete="${escapeHtml(record.id)}" data-orders-write${helpers.liveReadOnly ? ' disabled aria-disabled="true"' : ""}>${escapeHtml(t(lang, "delete"))}</button></td>
  </tr>`;
}

function emptyForm() {
  return Object.fromEntries([...TEXT_FIELDS, "submittedAt", "submittedEndAt", "statusId"].map((key) => [key, ""]));
}

function renderFormField(key, type, helpers, wide = false) {
  const { escapeHtml, lang } = helpers;
  const labelKey = key === "submittedAt" ? "startDate" : key === "submittedEndAt" ? "endDate" : key;
  return `<label class="northbound-form-field${wide ? " northbound-form-field--wide" : ""}">
    <span>${escapeHtml(t(lang, labelKey))}${key === "name" ? " *" : ""}</span>
    ${type === "textarea"
      ? `<textarea rows="2" data-northbound-form-field="${escapeHtml(key)}" data-orders-write${helpers.liveReadOnly ? ' disabled aria-disabled="true"' : ""}>${escapeHtml(state.form[key] || "")}</textarea>`
      : `<input type="${type}" data-northbound-form-field="${escapeHtml(key)}" data-orders-write value="${escapeHtml(state.form[key] || "")}"${helpers.liveReadOnly ? ' disabled aria-disabled="true"' : ""}>`}
  </label>`;
}

function renderModal(helpers) {
  if (!state.modalOpen) return "";
  const { escapeHtml, lang } = helpers;
  return `<div class="northbound-modal-overlay" data-northbound-modal-overlay>
    <form class="northbound-modal" data-northbound-form role="dialog" aria-modal="true" aria-label="${escapeHtml(t(lang, "modalTitle"))}">
      <header class="northbound-modal__head">
        <h2>${escapeHtml(t(lang, "modalTitle"))}</h2>
        <button type="button" class="northbound-modal__close" data-northbound-modal-close aria-label="${escapeHtml(t(lang, "close"))}">×</button>
      </header>
      <div class="northbound-modal__body">
        <div class="northbound-form-grid">
          ${renderFormField("name", "text", helpers)}
          ${renderFormField("plateNo", "text", helpers)}
          ${renderFormField("hkid", "text", helpers)}
          ${renderFormField("hrpNo", "text", helpers)}
          ${renderFormField("phoneHk", "tel", helpers)}
          ${renderFormField("phoneMainland", "tel", helpers)}
          ${renderFormField("submittedAt", "date", helpers)}
          ${renderFormField("submittedEndAt", "date", helpers)}
          ${renderFormField("address", "textarea", helpers, true)}
          ${renderFormField("remarks", "textarea", helpers, true)}
          <label class="northbound-form-field northbound-form-field--wide">
            <span>${escapeHtml(t(lang, "status"))}</span>
            <select data-northbound-form-field="statusId" data-orders-write${helpers.liveReadOnly ? ' disabled aria-disabled="true"' : ""}>
              <option value="">${escapeHtml(t(lang, "noStatus"))}</option>
              ${normalizedStatuses().map((status) => `<option value="${escapeHtml(status.id)}"${normalizedStatusById(state.form.statusId)?.key === status.key ? " selected" : ""}>${escapeHtml(status.label)}</option>`).join("")}
            </select>
          </label>
          <div class="northbound-new-status northbound-form-field--wide">
            <input type="text" data-northbound-new-status data-orders-write value="${escapeHtml(state.newStatusLabel)}" placeholder="${escapeHtml(t(lang, "newStatusPlaceholder"))}"${helpers.liveReadOnly ? ' disabled aria-disabled="true"' : ""}>
            <button type="button" data-northbound-create-status data-orders-write${helpers.liveReadOnly ? ' disabled aria-disabled="true"' : ""}>${escapeHtml(t(lang, "newStatus"))}</button>
          </div>
        </div>
        ${state.formError ? `<p class="northbound-form-error">${escapeHtml(state.formError)}</p>` : ""}
      </div>
      <footer class="northbound-modal__footer">
        <button type="button" class="northbound-secondary" data-northbound-modal-close>${escapeHtml(t(lang, "cancel"))}</button>
        <button type="submit" class="northbound-primary" data-orders-write${helpers.liveReadOnly ? ' disabled aria-disabled="true"' : ""}>${escapeHtml(t(lang, "save"))}</button>
      </footer>
    </form>
  </div>`;
}

export async function ensureNorthboundData({ scope = activeScope, signal = scope?.signal } = {}) {
  if (state.loaded || state.loading) return;
  const version = dataLoadVersion;
  state.loading = true;
  rerender();
  const data = await getNorthboundData();
  if (version !== dataLoadVersion || signal?.aborted || (scope && !scope.isCurrent())) return;
  state.statuses = data.statuses;
  state.records = data.records;
  state.loading = false;
  state.loaded = true;
}

export function renderNorthbound(helpers) {
  currentHelpers = helpers;
  const { escapeHtml, icon, lang } = helpers;
  const filtered = filteredRecords();
  const visible = filtered.slice(0, state.visibleLimit);
  const counts = statusCounts();
  return `<section class="orders-domain-panel northbound-page" data-northbound-page data-live-read-only="${helpers.liveReadOnly === true}" data-record-count="${state.records.length}" data-visible-count="${filtered.length}">
    <header class="orders-domain-panel__head">
      <div><h2>${escapeHtml(t(lang, "title"))}</h2><p>${escapeHtml(t(lang, "description"))}</p></div>
      <button type="button" class="orders-domain-primary" data-northbound-add data-orders-write${helpers.liveReadOnly ? ' disabled aria-disabled="true"' : ""}>${icon("icon-add-line-add", "icon")}<span>${escapeHtml(t(lang, "add"))}</span></button>
    </header>
    <div class="northbound-toolbar">
      <label class="northbound-search">${icon("icon-nav-search", "icon")}<input type="search" data-northbound-search value="${escapeHtml(state.search)}" placeholder="${escapeHtml(t(lang, "search"))}"></label>
      <select class="northbound-status-filter" data-northbound-status-filter>
        <option value="all"${state.statusFilter === "all" ? " selected" : ""}>${escapeHtml(t(lang, "allStatuses"))} (${counts.all})</option>
        <option value="none"${state.statusFilter === "none" ? " selected" : ""}>${escapeHtml(t(lang, "noStatus"))} (${counts.none})</option>
        ${normalizedStatuses().map((status) => `<option value="${escapeHtml(status.key)}"${state.statusFilter === status.key ? " selected" : ""}>${escapeHtml(status.label)} (${counts[status.key] || 0})</option>`).join("")}
      </select>
    </div>
    <div class="northbound-counts"><span>${escapeHtml(`${t(lang, "total")} ${state.records.length} ${t(lang, "records")}`)}</span><span>${escapeHtml(`${t(lang, "visible")} ${filtered.length} ${t(lang, "records")}`)}</span></div>
    ${state.error ? `<p class="northbound-form-error" role="alert">${escapeHtml(state.error)}</p>` : ""}
    <div class="northbound-table-shell">
      <div class="northbound-table-scroll">
        <table class="northbound-table">
          <thead><tr>${["status", "submitted", "name", "plateNo", "hkid", "phoneHk", "phoneMainland", "address", "hrpNo", "remarks", "createdAt", "action"].map((key) => `<th>${escapeHtml(t(lang, key))}</th>`).join("")}</tr></thead>
          <tbody>
            ${state.loading ? `<tr><td colspan="12" class="northbound-empty">${escapeHtml(t(lang, "loading"))}</td></tr>` : ""}
            ${!state.loading && visible.length ? visible.map((record) => renderRecord(record, helpers)).join("") : ""}
            ${!state.loading && !visible.length ? `<tr><td colspan="12" class="northbound-empty">${escapeHtml(t(lang, "empty"))}</td></tr>` : ""}
          </tbody>
        </table>
      </div>
    </div>
    ${visible.length < filtered.length ? `<div class="northbound-load-more"><span>${escapeHtml(`${t(lang, "showing")} ${visible.length}/${filtered.length}`)}</span><button type="button" data-northbound-load-more>${escapeHtml(t(lang, "loadMore"))}</button></div>` : ""}
    ${renderModal(helpers)}
  </section>`;
}

async function commitInlineEdit() {
  if (liveReadOnly()) return;
  if (!state.edit) return;
  const { rowId, field } = state.edit;
  const record = state.records.find((item) => item.id === rowId);
  if (!record) return;
  if (!liveMode()) {
    if (field === "submittedRange") {
      const { start = "", end = "" } = state.edit.draft ?? {};
      record.submittedAt = start || null;
      record.submittedEndAt = end || null;
    } else {
      const input = document.querySelector(`[data-northbound-inline-input][data-row-id="${CSS.escape(rowId)}"][data-field="${CSS.escape(field)}"]`);
      record[field] = input?.value || (field === "statusId" ? null : "");
    }
    state.edit = null;
    rerender();
    return;
  }

  let patch;
  if (field === "submittedRange") {
    const { start = "", end = "" } = state.edit.draft ?? {};
    patch = { submitted_at: start, submitted_end_at: end };
  } else {
    const input = document.querySelector(`[data-northbound-inline-input][data-row-id="${CSS.escape(rowId)}"][data-field="${CSS.escape(field)}"]`);
    const dbField = {
      statusId: "status_id",
      plateNo: "plate_no",
      phoneHk: "phone_hk",
      phoneMainland: "phone_mainland",
      hrpNo: "hrp_no"
    }[field] || field;
    patch = { [dbField]: input?.value || (field === "statusId" ? null : "") };
  }
  state.edit = null;
  state.error = "";
  rerender();
  const version = dataLoadVersion;
  const scope = activeScope;
  try {
    const saved = liveRecord(await updateLiveNorthboundRecord(rowId, patch), record);
    if (version !== dataLoadVersion || !scope?.isCurrent()) return;
    state.records = state.records.map((item) => item.id === saved.id ? saved : item);
  } catch {
    if (version !== dataLoadVersion || !scope?.isCurrent()) return;
    showWriteError("saveFailed");
  }
  rerender();
}

function openModal() {
  if (liveReadOnly()) return;
  modalReturnFocus = document.activeElement;
  state.error = "";
  state.form = emptyForm();
  state.formError = "";
  state.newStatusLabel = "";
  state.modalOpen = true;
  rerender();
  activeScope?.animationFrame(() => document.querySelector('[data-northbound-form-field="name"]')?.focus());
}

function closeModal() {
  state.modalOpen = false;
  state.formError = "";
  rerender();
  activeScope?.animationFrame(() => modalReturnFocus?.focus());
}

export function attachNorthboundBehaviors({ rerender: nextRerender, scope }) {
  rerender = nextRerender;
  activeScope = scope;
  const liveRefresh = attachLiveSnapshotRefresh({
    scope,
    snapshots: ["northbound.json"],
    tables: ["northbound_records", "northbound_statuses"],
    isBlocked: hasNorthboundRefreshBlock,
    async refresh({ defer, isCurrent }) {
      const nextData = await getNorthboundData();
      if (!isCurrent()) return;
      if (hasNorthboundRefreshBlock()) {
        defer();
        return;
      }
      state.records = nextData.records;
      state.statuses = nextData.statuses;
      state.loading = false;
      state.loaded = true;
      rerender();
    }
  });

  scope.listen(document, "click", async (event) => {
    if (liveReadOnly() && event.target.closest("[data-orders-write]")) return;
    if (event.target.closest("[data-northbound-add]")) return openModal();
    if (event.target.closest("[data-northbound-modal-close]") || event.target.matches("[data-northbound-modal-overlay]")) return closeModal();
    if (event.target.closest("[data-northbound-load-more]")) {
      state.visibleLimit += PAGE_CHUNK;
      rerender();
      return;
    }
    const deleteButton = event.target.closest("[data-northbound-delete]");
    if (deleteButton) {
      if (await confirmInPage(t(currentHelpers?.lang, "deleteConfirm"), { danger: true })) {
        if (!scope.isCurrent()) return;
        const id = deleteButton.getAttribute("data-northbound-delete");
        const version = dataLoadVersion;
        state.error = "";
        if (liveMode()) {
          try {
            await deleteLiveNorthboundRecord(id);
            if (version !== dataLoadVersion || !scope.isCurrent()) return;
            state.records = state.records.filter((record) => record.id !== id);
          } catch {
            if (version !== dataLoadVersion || !scope.isCurrent()) return;
            showWriteError("deleteFailed");
          }
        } else {
          state.records = state.records.filter((record) => record.id !== id);
        }
        rerender();
      }
      return;
    }
    if (event.target.closest("[data-northbound-create-status]")) {
      const label = normalizeNorthboundStatusLabel(state.newStatusLabel);
      if (!label) {
        state.formError = t(currentHelpers?.lang, "statusRequired");
      } else {
        const existing = normalizedStatuses().find((status) => status.key === label);
        if (existing) {
          state.form.statusId = existing.id;
        } else {
          const values = {
            label,
            color: LOCAL_STATUS_COLORS[state.statuses.length % LOCAL_STATUS_COLORS.length],
            sortOrder: Math.max(0, ...state.statuses.map((item) => item.sortOrder)) + 10
          };
          if (liveMode()) {
            const version = dataLoadVersion;
            try {
              const status = liveStatus(await createLiveNorthboundStatus(values));
              if (version !== dataLoadVersion || !scope.isCurrent()) return;
              state.statuses.push(status);
              state.form.statusId = status.id;
            } catch {
              if (version !== dataLoadVersion || !scope.isCurrent()) return;
              showWriteError("statusCreateFailed", { form: true });
              rerender();
              return;
            }
          } else {
            const status = { id: `local-status-${Date.now()}`, ...values };
            state.statuses.push(status);
            state.form.statusId = status.id;
          }
        }
        state.newStatusLabel = "";
        state.formError = "";
      }
      rerender();
    }
  });

  function startInlineEdit(cell) {
    if (liveReadOnly()) return;
    if (!cell) return;
    const rowId = cell.getAttribute("data-row-id");
    const field = cell.getAttribute("data-field");
    state.error = "";
    if (field === "submittedRange") {
      const record = state.records.find((item) => item.id === rowId);
      if (!record) return;
      submittedRangePanel.open({
        anchor: cell,
        start: record.submittedAt,
        end: record.submittedEndAt,
        language: currentHelpers?.lang,
        t: (key) => t(currentHelpers?.lang, key),
        onCommit: async (draft) => {
          state.edit = { rowId, field, draft };
          await commitInlineEdit();
        }
      });
      return;
    }
    state.edit = { rowId, field };
    rerender();
    scope.animationFrame(() => document.querySelector("[data-northbound-inline-input]")?.focus());
  }

  scope.listen(document, "dblclick", (event) => {
    startInlineEdit(event.target.closest("[data-northbound-edit-cell]"));
  });

  scope.listen(document, "pointerup", (event) => {
    if (event.pointerType !== "touch" || liveReadOnly()) return;
    const cell = event.target.closest("[data-northbound-edit-cell]");
    if (!cell) return;
    const key = `${cell.getAttribute("data-row-id")}:${cell.getAttribute("data-field")}`;
    const now = Date.now();
    if (lastTouchTap.key === key && now - lastTouchTap.at <= 300) {
      event.preventDefault();
      lastTouchTap = { key: "", at: 0 };
      startInlineEdit(cell);
      return;
    }
    lastTouchTap = { key, at: now };
  });

  scope.listen(document, "input", (event) => {
    const search = event.target.closest("[data-northbound-search]");
    if (search) {
      state.search = search.value;
      state.visibleLimit = PAGE_CHUNK;
      if (event.isComposing) return;
      clearTimeout(searchRenderTimer);
      // Keep the active input alive while typing. Immediate full rerenders replace
      // the node, so subsequent keystrokes otherwise land on a detached element.
      searchRenderTimer = scope.timeout(() => {
        searchRenderTimer = null;
        rerender();
        scope.animationFrame(() => {
          const input = document.querySelector("[data-northbound-search]");
          input?.focus();
          input?.setSelectionRange(input.value.length, input.value.length);
        });
      }, 180);
      return;
    }
    const formField = event.target.closest("[data-northbound-form-field]");
    if (formField && !liveReadOnly()) state.form[formField.getAttribute("data-northbound-form-field")] = formField.value;
    const newStatus = event.target.closest("[data-northbound-new-status]");
    if (newStatus && !liveReadOnly()) state.newStatusLabel = newStatus.value;
  });

  scope.listen(document, "change", (event) => {
    const filter = event.target.closest("[data-northbound-status-filter]");
    if (filter) {
      state.statusFilter = filter.value;
      state.visibleLimit = PAGE_CHUNK;
      rerender();
      return;
    }
    const inlineStatus = event.target.closest('[data-northbound-inline-input][data-field="statusId"]');
    if (inlineStatus && !liveReadOnly()) commitInlineEdit();
    const formField = event.target.closest("[data-northbound-form-field]");
    if (formField && !liveReadOnly()) state.form[formField.getAttribute("data-northbound-form-field")] = formField.value;
  });

  scope.listen(document, "keydown", (event) => {
    if (event.key === "Escape" && state.modalOpen) {
      event.preventDefault();
      closeModal();
      return;
    }
    if (!event.target.closest("[data-northbound-inline-input]")) return;
    if (liveReadOnly()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      state.edit = null;
      rerender();
    } else if (event.key === "Enter") {
      event.preventDefault();
      commitInlineEdit();
    }
  });

  scope.listen(document, "focusout", (event) => {
    const input = event.target.closest("[data-northbound-inline-input]");
    if (!input || !state.edit || liveReadOnly()) return;
    const activeEdit = state.edit;
    scope.timeout(() => {
      if (state.edit !== activeEdit) return;
      const active = document.activeElement;
      if (active?.closest("[data-northbound-edit-active]")) return;
      commitInlineEdit();
    }, 0);
  });

  scope.listen(document, "submit", async (event) => {
    if (!event.target.matches("[data-northbound-form]")) return;
    event.preventDefault();
    if (liveReadOnly()) return;
    if (!String(state.form.name || "").trim()) {
      state.formError = t(currentHelpers?.lang, "requiredName");
      rerender();
      return;
    }
    if (liveMode()) {
      const version = dataLoadVersion;
      try {
        const saved = await createLiveNorthboundRecord({
          name: state.form.name,
          plate_no: state.form.plateNo,
          hkid: state.form.hkid,
          hrp_no: state.form.hrpNo,
          phone_hk: state.form.phoneHk,
          phone_mainland: state.form.phoneMainland,
          submitted_at: state.form.submittedAt,
          submitted_end_at: state.form.submittedEndAt,
          address: state.form.address,
          remarks: state.form.remarks,
          status_id: state.form.statusId
        });
        if (version !== dataLoadVersion || !scope.isCurrent()) return;
        state.records.unshift(liveRecord(saved));
      } catch {
        if (version !== dataLoadVersion || !scope.isCurrent()) return;
        showWriteError("saveFailed", { form: true });
        rerender();
        return;
      }
    } else {
      const now = new Date();
      const createdAt = new Intl.DateTimeFormat(localeForLang(currentHelpers?.lang), {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
      }).format(now);
      state.records.unshift({
        id: `local-northbound-${Date.now()}`,
        ...emptyForm(),
        ...state.form,
        statusId: state.form.statusId || null,
        submittedAt: state.form.submittedAt || null,
        submittedEndAt: state.form.submittedEndAt || null,
        createdAt
      });
    }
    state.modalOpen = false;
    state.visibleLimit = PAGE_CHUNK;
    rerender();
  });

  const flushDeferredRefresh = () => scope.timeout(() => void liveRefresh.flush(), 0);
  scope.listen(document, "click", flushDeferredRefresh);
  scope.listen(document, "focusout", flushDeferredRefresh);
  scope.listen(document, "keyup", flushDeferredRefresh);
  return liveRefresh;
}

export function captureNorthboundState() {
  return {
    search: state.search,
    statusFilter: state.statusFilter,
    visibleLimit: state.visibleLimit
  };
}

export function restoreNorthboundState(value = null) {
  const next = value && typeof value === "object" ? value : {};
  state.search = typeof next.search === "string" ? next.search : "";
  state.statusFilter = typeof next.statusFilter === "string" ? next.statusFilter : "all";
  state.visibleLimit = Number.isInteger(next.visibleLimit) && next.visibleLimit >= PAGE_CHUNK ? next.visibleLimit : PAGE_CHUNK;
  state.edit = null;
  state.modalOpen = false;
  state.form = {};
  state.formError = "";
  state.error = "";
  state.newStatusLabel = "";
}

export function hasNorthboundUnsavedChanges() {
  if (state.edit) return true;
  if (!state.modalOpen) return false;
  return Object.values(state.form).some((value) => String(value || "").trim()) || Boolean(state.newStatusLabel.trim());
}

export function hasNorthboundRefreshBlock() {
  if (state.edit || state.modalOpen || submittedRangePanel.isOpen()) return true;
  const active = document.activeElement;
  return Boolean(active?.closest?.("[data-northbound-page] input, [data-northbound-page] textarea, [data-northbound-page] select"));
}

export function disposeNorthboundState() {
  dataLoadVersion += 1;
  clearTimeout(searchRenderTimer);
  searchRenderTimer = null;
  submittedRangePanel.close({ restoreFocus: false });
  state.loaded = false;
  state.loading = false;
  state.records = [];
  state.statuses = [];
  state.edit = null;
  state.modalOpen = false;
  state.form = {};
  state.formError = "";
  state.error = "";
  state.newStatusLabel = "";
  currentHelpers = null;
  modalReturnFocus = null;
  lastTouchTap = { key: "", at: 0 };
  rerender = () => {};
  activeScope = null;
}
