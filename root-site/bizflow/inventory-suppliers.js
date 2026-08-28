import { getSuppliersData } from "../data/provider.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import {
  createLiveInventorySupplier,
  deleteLiveInventorySupplier,
  updateLiveInventorySupplier
} from "../data/live-inventory-writes.js";

const copy = {
  zh: {
    title: "供應商",
    count: "家供應商",
    add: "新增供應商",
    search: "搜尋供應商",
    all: "全部",
    empty: "尚無供應商，點新增供應商開始",
    noMatch: "沒有符合條件的供應商",
    contact: "對接人",
    openContact: "打開聯繫",
    edit: "編輯",
    remove: "刪除",
    deleteConfirm: "確認刪除這家供應商？",
    newTitle: "新增供應商",
    editTitle: "編輯供應商",
    name: "名稱",
    contactUrl: "聯繫鏈接",
    contactHint: "支持 https://wa.me、wxwork:// 或 mailto:",
    contactPerson: "對接人",
    category: "分類",
    note: "備註",
    required: "請輸入供應商名稱",
    cancel: "取消",
    save: "儲存",
    close: "關閉",
    loading: "正在載入供應商",
    saveFailed: "供應商儲存失敗，請重試",
    deleteFailed: "供應商刪除失敗，請重試"
  },
  en: {
    title: "Suppliers",
    count: "suppliers",
    add: "Add supplier",
    search: "Search suppliers",
    all: "All",
    empty: "No suppliers yet. Add one to get started",
    noMatch: "No suppliers match the filters",
    contact: "Contact person",
    openContact: "Open contact",
    edit: "Edit",
    remove: "Delete",
    deleteConfirm: "Delete this supplier?",
    newTitle: "Add supplier",
    editTitle: "Edit supplier",
    name: "Name",
    contactUrl: "Contact link",
    contactHint: "Supports https://wa.me, wxwork:// or mailto:",
    contactPerson: "Contact person",
    category: "Category",
    note: "Note",
    required: "Supplier name is required",
    cancel: "Cancel",
    save: "Save",
    close: "Close",
    loading: "Loading suppliers",
    saveFailed: "Could not save the supplier. Try again",
    deleteFailed: "Could not delete the supplier. Try again"
  },
  fr: {
    title: "Fournisseurs",
    count: "fournisseurs",
    add: "Ajouter un fournisseur",
    search: "Rechercher des fournisseurs",
    all: "Tous",
    empty: "Aucun fournisseur. Ajoutez-en un pour commencer",
    noMatch: "Aucun fournisseur ne correspond aux filtres",
    contact: "Interlocuteur",
    openContact: "Ouvrir le contact",
    edit: "Modifier",
    remove: "Supprimer",
    deleteConfirm: "Supprimer ce fournisseur ?",
    newTitle: "Ajouter un fournisseur",
    editTitle: "Modifier le fournisseur",
    name: "Nom",
    contactUrl: "Lien de contact",
    contactHint: "Formats acceptés : https://wa.me, wxwork:// ou mailto:",
    contactPerson: "Interlocuteur",
    category: "Catégorie",
    note: "Note",
    required: "Le nom du fournisseur est obligatoire",
    cancel: "Annuler",
    save: "Enregistrer",
    close: "Fermer",
    loading: "Chargement des fournisseurs",
    saveFailed: "Impossible d’enregistrer le fournisseur. Réessayez",
    deleteFailed: "Impossible de supprimer le fournisseur. Réessayez"
  }
};

const state = {
  loaded: false,
  suppliers: [],
  search: "",
  category: "all",
  draft: null,
  error: "",
  busy: false
};

let rerender = () => {};
let liveReadOnly = false;
let dataLoadVersion = 0;

function writeAttributes() {
  return liveReadOnly || state.busy ? ' disabled aria-disabled="true"' : "";
}

function t(lang, key) {
  return copy[lang]?.[key] ?? copy.zh[key] ?? key;
}

export async function ensureSuppliersData({ scope = null, signal = scope?.signal } = {}) {
  if (state.loaded) return;
  const version = dataLoadVersion;
  const data = await getSuppliersData();
  if (version !== dataLoadVersion || signal?.aborted || (scope && !scope.isCurrent())) return;
  state.suppliers = data.suppliers;
  state.loaded = true;
}

export function supplierCount() {
  return state.suppliers.length;
}

function categories() {
  return [...new Set(state.suppliers.map((supplier) => supplier.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function filteredSuppliers() {
  const query = state.search.trim().toLocaleLowerCase();
  return state.suppliers.filter((supplier) => {
    if (state.category !== "all" && supplier.category !== state.category) return false;
    if (!query) return true;
    return [supplier.name, supplier.contactPerson, supplier.category, supplier.note]
      .some((value) => String(value || "").toLocaleLowerCase().includes(query));
  });
}

function safeContactUrl(value) {
  const url = String(value || "").trim();
  return /^(https?:\/\/|mailto:|wxwork:\/\/)/i.test(url) ? url : "";
}

function supplierFromLiveRow(row) {
  return {
    id: row.id,
    name: String(row.name || ""),
    contactUrl: String(row.contact_url || ""),
    contactPerson: String(row.contact_person || ""),
    category: String(row.category || ""),
    note: String(row.note || "")
  };
}

function renderCard(supplier, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const contactUrl = safeContactUrl(supplier.contactUrl);
  return `<article class="supplier-card" data-supplier-card="${escapeHtml(supplier.id)}">
    <div class="supplier-card__head"><strong title="${escapeHtml(supplier.name)}">${escapeHtml(supplier.name)}</strong>${supplier.category ? `<span>${escapeHtml(supplier.category)}</span>` : ""}</div>
    ${supplier.contactPerson ? `<div class="supplier-card__contact">${icon("icon-nav-user", "icon")}<span>${escapeHtml(t(lang, "contact"))}: ${escapeHtml(supplier.contactPerson)}</span></div>` : ""}
    ${contactUrl ? `<a class="supplier-card__link" href="${escapeHtml(contactUrl)}" target="_blank" rel="noopener noreferrer">${icon("icon-arrow-right", "icon")}<span>${escapeHtml(t(lang, "openContact"))}</span></a>` : ""}
    ${supplier.note ? `<p>${escapeHtml(supplier.note)}</p>` : ""}
    <div class="supplier-card__actions"><button type="button" data-supplier-edit="${escapeHtml(supplier.id)}" data-inventory-write${writeAttributes()}>${icon("icon-edit-default", "icon")}<span>${escapeHtml(t(lang, "edit"))}</span></button><button type="button" data-supplier-delete="${escapeHtml(supplier.id)}" data-inventory-write aria-label="${escapeHtml(t(lang, "remove"))}" title="${escapeHtml(t(lang, "remove"))}"${writeAttributes()}>×</button></div>
  </article>`;
}

function renderModal(helpers) {
  if (!state.draft) return "";
  const { escapeHtml, lang } = helpers;
  const draft = state.draft;
  const field = (key, type = "input") => `<label class="inventory-domain-field"><span>${escapeHtml(t(lang, key))}${key === "name" ? " *" : ""}</span>${type === "textarea" ? `<textarea data-supplier-field="${key}" data-inventory-write${writeAttributes()}>${escapeHtml(draft[key])}</textarea>` : `<input data-supplier-field="${key}" data-inventory-write value="${escapeHtml(draft[key])}"${writeAttributes()}>`}</label>`;
  return `<div class="inventory-domain-overlay" data-supplier-overlay>
    <form class="inventory-domain-modal" data-supplier-form role="dialog" aria-modal="true" aria-label="${escapeHtml(t(lang, draft.id ? "editTitle" : "newTitle"))}">
      <header><h2>${escapeHtml(t(lang, draft.id ? "editTitle" : "newTitle"))}</h2><button type="button" data-supplier-close aria-label="${escapeHtml(t(lang, "close"))}">×</button></header>
      <div class="inventory-domain-modal__body">
        ${field("name")}
        ${field("contactUrl")}
        <p class="inventory-domain-hint">${escapeHtml(t(lang, "contactHint"))}</p>
        ${field("contactPerson")}
        ${field("category")}
        ${field("note", "textarea")}
        ${state.error ? `<p class="inventory-domain-error">${escapeHtml(state.error)}</p>` : ""}
      </div>
      <footer><button type="button" class="inventory-domain-button inventory-domain-button--secondary" data-supplier-close>${escapeHtml(t(lang, "cancel"))}</button><button type="submit" class="inventory-domain-button" data-inventory-write${writeAttributes()}>${escapeHtml(t(lang, "save"))}</button></footer>
    </form>
  </div>`;
}

export function renderSuppliers(helpers) {
  liveReadOnly = helpers.liveReadOnly === true;
  const { escapeHtml, icon, lang } = helpers;
  if (!state.loaded) return `<div class="inventory-domain-empty">${escapeHtml(t(lang, "loading"))}</div>`;
  const supplierCategories = categories();
  const suppliers = filteredSuppliers();
  return `<section class="inventory-domain-page suppliers-page" data-suppliers-page data-live-read-only="${liveReadOnly}" data-supplier-count="${state.suppliers.length}">
    ${state.error && !state.draft ? `<p class="inventory-domain-error">${escapeHtml(state.error)}</p>` : ""}
    <div class="inventory-domain-heading"><h2>${escapeHtml(t(lang, "title"))}<span>${escapeHtml(`${state.suppliers.length} ${t(lang, "count")}`)}</span></h2><button type="button" class="inventory-domain-button" data-supplier-new data-inventory-write${writeAttributes()}>+ ${escapeHtml(t(lang, "add"))}</button></div>
    <label class="inventory-domain-search inventory-domain-search--wide">${icon("icon-nav-search", "icon")}<input type="search" data-supplier-search value="${escapeHtml(state.search)}" placeholder="${escapeHtml(t(lang, "search"))}"></label>
    ${supplierCategories.length ? `<div class="supplier-categories"><button type="button" class="${state.category === "all" ? "is-active" : ""}" data-supplier-category="all">${escapeHtml(t(lang, "all"))}</button>${supplierCategories.map((category) => `<button type="button" class="${state.category === category ? "is-active" : ""}" data-supplier-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}</div>` : ""}
    ${suppliers.length ? `<div class="supplier-grid">${suppliers.map((supplier) => renderCard(supplier, helpers)).join("")}</div>` : `<div class="inventory-domain-empty inventory-domain-empty--card">${escapeHtml(state.suppliers.length ? t(lang, "noMatch") : t(lang, "empty"))}</div>`}
    ${renderModal(helpers)}
  </section>`;
}

function blankSupplier() {
  return { id: null, name: "", contactUrl: "", contactPerson: "", category: "", note: "" };
}

function closeModal() {
  state.draft = null;
  state.error = "";
  rerender();
}

export function attachSupplierBehaviors({ rerender: nextRerender, scope }) {
  rerender = nextRerender;
  scope.listen(document, "click", async (event) => {
    if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
    if (event.target.closest("[data-supplier-new]")) {
      state.error = "";
      state.draft = blankSupplier();
      rerender();
      return;
    }
    const edit = event.target.closest("[data-supplier-edit]");
    if (edit) {
      const supplier = state.suppliers.find((item) => item.id === edit.getAttribute("data-supplier-edit"));
      if (supplier) {
        state.error = "";
        state.draft = { ...supplier };
      }
      rerender();
      return;
    }
    const remove = event.target.closest("[data-supplier-delete]");
    if (remove && await confirmInPage(t(currentLang(), "deleteConfirm"), { danger: true })) {
      if (!scope.isCurrent()) return;
      const supplierId = remove.getAttribute("data-supplier-delete");
      state.busy = true;
      state.error = "";
      rerender();
      try {
        await deleteLiveInventorySupplier(supplierId);
        if (!scope.isCurrent()) return;
        state.suppliers = state.suppliers.filter((item) => item.id !== supplierId);
        if (state.category !== "all" && !categories().includes(state.category)) state.category = "all";
      } catch {
        state.error = t(currentLang(), "deleteFailed");
      } finally {
        state.busy = false;
        if (scope.isCurrent()) rerender();
      }
      return;
    }
    const category = event.target.closest("[data-supplier-category]");
    if (category) {
      state.category = category.getAttribute("data-supplier-category");
      rerender();
      return;
    }
    if (event.target.closest("[data-supplier-close]") || event.target.matches("[data-supplier-overlay]")) closeModal();
  });
  scope.listen(document, "input", (event) => {
    if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
    const search = event.target.closest("[data-supplier-search]");
    if (search) {
      state.search = search.value;
      rerender();
      scope.animationFrame(() => focusAtEnd("[data-supplier-search]"));
      return;
    }
    const field = event.target.closest("[data-supplier-field]");
    if (field && state.draft) {
      state.draft[field.getAttribute("data-supplier-field")] = field.value;
      state.error = "";
    }
  });
  scope.listen(document, "submit", async (event) => {
    if (!event.target.matches("[data-supplier-form]") || !state.draft) return;
    event.preventDefault();
    if (liveReadOnly) return;
    const name = state.draft.name.trim();
    if (!name) {
      state.error = t(currentLang(), "required");
      rerender();
      return;
    }
    const draft = { ...state.draft, name };
    state.busy = true;
    state.error = "";
    rerender();
    try {
      const row = draft.id
        ? await updateLiveInventorySupplier(draft.id, draft)
        : await createLiveInventorySupplier(draft);
      if (!scope.isCurrent()) return;
      const saved = supplierFromLiveRow(row);
      const index = state.suppliers.findIndex((supplier) => supplier.id === saved.id);
      if (index >= 0) state.suppliers[index] = saved;
      else state.suppliers.unshift(saved);
      state.draft = null;
    } catch {
      state.error = t(currentLang(), "saveFailed");
    } finally {
      state.busy = false;
      if (scope.isCurrent()) rerender();
    }
  });
  scope.listen(document, "keydown", (event) => {
    if (event.key === "Escape" && state.draft) closeModal();
  });
}

export function captureSupplierState() {
  return { search: state.search, category: state.category };
}

export function restoreSupplierState(value = null) {
  state.search = typeof value?.search === "string" ? value.search : "";
  state.category = typeof value?.category === "string" ? value.category : "all";
  state.draft = null;
  state.error = "";
  state.busy = false;
}

export function hasSupplierUnsavedChanges() {
  if (!state.draft) return false;
  const original = state.draft.id ? state.suppliers.find((supplier) => supplier.id === state.draft.id) : blankSupplier();
  if (!original) return true;
  return ["name", "contactUrl", "contactPerson", "category", "note"]
    .some((key) => String(state.draft[key] || "") !== String(original[key] || ""));
}

export function disposeSupplierState() {
  dataLoadVersion += 1;
  state.loaded = false;
  state.suppliers = [];
  state.search = "";
  state.category = "all";
  state.draft = null;
  state.error = "";
  state.busy = false;
  liveReadOnly = false;
  rerender = () => {};
}

function focusAtEnd(selector) {
  const input = document.querySelector(selector);
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

function currentLang() {
  return document.documentElement.lang === "fr" ? "fr" : document.documentElement.lang === "en" ? "en" : "zh";
}
