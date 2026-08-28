import { getInventoryAliasesData, getOrdersPageData } from "../data/provider.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import {
  deleteLiveInventoryAlias,
  saveLiveInventoryAlias,
  verifyLiveInventoryAlias
} from "../data/live-inventory-writes.js";

const copy = {
  zh: {
    title: "Item 映射",
    unmatched: "未匹配的 line item",
    unmatchedEmpty: "全部 line item 都已配置映射",
    occurrences: "次",
    map: "配映射",
    moreHidden: "還有 {count} 條未顯示",
    configured: "已配映射",
    add: "新增映射",
    single: "單產品",
    bundle: "套裝",
    skip: "不扣庫存",
    noProduct: "未配產品",
    aliases: "條映射",
    pendingCheck: "待校對",
    confirm: "確認",
    edit: "編輯",
    remove: "刪除",
    deleteConfirm: "確認刪除這條映射？",
    newTitle: "新增 Line Item 映射",
    editTitle: "編輯映射",
    aliasField: "alias_name",
    aliasPlaceholder: "訂單 items 裡的原始名稱",
    aliasLocked: "既有 alias 不可改名，避免破壞已建關聯",
    skipHint: "此 alias 不扣庫存",
    products: "映射到產品",
    bundleHint: "套裝可加入多行",
    chooseProduct: "選擇產品",
    quantity: "數量",
    addRow: "加一行",
    note: "備註",
    notePlaceholder: "例如：尾款、運費或套裝說明",
    cancel: "取消",
    save: "儲存",
    close: "關閉",
    loading: "正在載入映射資料",
    required: "請輸入 alias_name",
    saveFailed: "映射儲存失敗，請重試",
    deleteFailed: "映射刪除失敗，請重試",
    verifyFailed: "映射確認失敗，請重試",
    operationFailed: "操作失敗"
  },
  en: {
    title: "Item mapping",
    unmatched: "Unmatched line items",
    unmatchedEmpty: "All line items have mappings",
    occurrences: "times",
    map: "Map item",
    moreHidden: "{count} more not shown",
    configured: "Configured mappings",
    add: "Add mapping",
    single: "Single product",
    bundle: "Bundle",
    skip: "No stock deduction",
    noProduct: "No product assigned",
    aliases: "mappings",
    pendingCheck: "Needs review",
    confirm: "Confirm",
    edit: "Edit",
    remove: "Delete",
    deleteConfirm: "Delete this mapping?",
    newTitle: "Add line item mapping",
    editTitle: "Edit mapping",
    aliasField: "alias_name",
    aliasPlaceholder: "Original name in order items",
    aliasLocked: "Existing aliases are locked to preserve associations",
    skipHint: "Do not deduct stock for this alias",
    products: "Mapped products",
    bundleHint: "Add multiple rows for bundles",
    chooseProduct: "Choose product",
    quantity: "Quantity",
    addRow: "Add row",
    note: "Note",
    notePlaceholder: "For example: final payment, freight or bundle details",
    cancel: "Cancel",
    save: "Save",
    close: "Close",
    loading: "Loading mapping data",
    required: "Enter an alias_name",
    saveFailed: "Could not save the mapping. Try again",
    deleteFailed: "Could not delete the mapping. Try again",
    verifyFailed: "Could not confirm the mapping. Try again",
    operationFailed: "Operation failed"
  },
  fr: {
    title: "Mappage Item",
    unmatched: "Articles de commande non associés",
    unmatchedEmpty: "Tous les articles ont un mappage",
    occurrences: "fois",
    map: "Associer",
    moreHidden: "{count} autres non affichés",
    configured: "Mappages configurés",
    add: "Ajouter un mappage",
    single: "Produit unique",
    bundle: "Ensemble",
    skip: "Sans déduction de stock",
    noProduct: "Aucun produit associé",
    aliases: "mappages",
    pendingCheck: "À vérifier",
    confirm: "Confirmer",
    edit: "Modifier",
    remove: "Supprimer",
    deleteConfirm: "Supprimer ce mappage ?",
    newTitle: "Ajouter un mappage d'article",
    editTitle: "Modifier le mappage",
    aliasField: "alias_name",
    aliasPlaceholder: "Nom d'origine dans la commande",
    aliasLocked: "Les alias existants sont verrouillés pour préserver les liens",
    skipHint: "Ne pas déduire le stock pour cet alias",
    products: "Produits associés",
    bundleHint: "Ajouter plusieurs lignes pour un ensemble",
    chooseProduct: "Choisir un produit",
    quantity: "Quantité",
    addRow: "Ajouter une ligne",
    note: "Note",
    notePlaceholder: "Exemple : solde, transport ou détails de l'ensemble",
    cancel: "Annuler",
    save: "Enregistrer",
    close: "Fermer",
    loading: "Chargement des mappages",
    required: "Saisissez un alias_name",
    saveFailed: "Impossible d’enregistrer le mappage. Réessayez",
    deleteFailed: "Impossible de supprimer le mappage. Réessayez",
    verifyFailed: "Impossible de confirmer le mappage. Réessayez",
    operationFailed: "Échec de l'opération"
  }
};

const state = {
  loaded: false,
  aliases: [],
  orders: [],
  expanded: new Set(),
  draft: null,
  busy: false,
  error: ""
};

let rerender = () => {};
let currentProducts = [];
let liveReadOnly = false;
let dataLoadVersion = 0;

function writeAttributes(disabled = liveReadOnly || state.busy) {
  return disabled || state.busy ? ' disabled aria-disabled="true"' : "";
}

function t(lang, key, values = {}) {
  const template = copy[lang]?.[key] ?? copy.zh[key] ?? key;
  return Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), template);
}

function normalizedName(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function withoutDefaultTitle(value) {
  return String(value || "").replace(/\s+-\s+default title$/i, "").trim();
}

export async function ensureItemMapData({ scope = null, signal = scope?.signal } = {}) {
  if (state.loaded) return;
  const version = dataLoadVersion;
  const [aliasData, orderData] = await Promise.all([getInventoryAliasesData(), getOrdersPageData()]);
  if (version !== dataLoadVersion || signal?.aborted || (scope && !scope.isCurrent())) return;
  state.aliases = aliasData.aliases;
  state.orders = orderData.orders;
  state.loaded = true;
}

export function itemMapGroupCounts(aliases = state.aliases) {
  const counts = { single: 0, bundle: 0, skip: 0, noProduct: 0 };
  for (const alias of aliases) {
    if (alias.skip) counts.skip += 1;
    else if (!alias.products.length) counts.noProduct += 1;
    else if (alias.products.length > 1) counts.bundle += 1;
    else counts.single += 1;
  }
  return counts;
}

export function unmatchedLineItems(aliases = state.aliases, orders = state.orders, products = currentProducts) {
  const knownAliases = new Set(aliases.map((alias) => normalizedName(alias.aliasName)));
  const knownProducts = new Set();
  for (const product of products) {
    knownProducts.add(normalizedName(product.name));
    knownProducts.add(normalizedName(withoutDefaultTitle(product.name)));
  }
  const unmatched = new Map();
  for (const order of orders) {
    for (const item of order.detail?.items ?? []) {
      const name = String(item.name || "").trim();
      if (!name) continue;
      const normalized = normalizedName(name);
      const stripped = normalizedName(withoutDefaultTitle(name));
      if (knownAliases.has(normalized) || knownProducts.has(normalized) || knownProducts.has(stripped)) continue;
      unmatched.set(name, (unmatched.get(name) ?? 0) + 1);
    }
  }
  return [...unmatched.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function productById() {
  return new Map(currentProducts.map((product) => [product.id, product]));
}

function aliasFromLiveRow(row) {
  const products = Array.isArray(row?.products) ? row.products.map((product) => ({ ...product })) : [];
  const names = productById();
  return {
    id: row.id,
    aliasName: String(row.alias_name || ""),
    skip: row.skip === true,
    products,
    productNames: products.map((product) => names.get(product.product_id)?.name ?? product.product_id),
    verified: row.verified === true,
    note: String(row.note || "")
  };
}

function aliasGroups(lang) {
  const products = productById();
  const singles = new Map();
  const bundle = { key: "bundle", label: t(lang, "bundle"), tone: "blue", items: [] };
  const skip = { key: "skip", label: t(lang, "skip"), tone: "red", items: [] };
  const noProduct = { key: "noProduct", label: t(lang, "noProduct"), tone: "yellow", items: [] };
  for (const alias of state.aliases) {
    if (alias.skip) {
      skip.items.push(alias);
      continue;
    }
    if (!alias.products.length) {
      noProduct.items.push(alias);
      continue;
    }
    if (alias.products.length > 1) {
      bundle.items.push(alias);
      continue;
    }
    const productId = alias.products[0].product_id;
    if (!singles.has(productId)) {
      singles.set(productId, {
        key: `product:${productId}`,
        label: products.get(productId)?.name ?? alias.productNames[0] ?? productId,
        tone: "green",
        items: []
      });
    }
    singles.get(productId).items.push(alias);
  }
  return [
    ...[...singles.values()].sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label)),
    ...[bundle, skip, noProduct].filter((group) => group.items.length)
  ];
}

function renderUnmatched(helpers) {
  const { escapeHtml, lang } = helpers;
  const items = unmatchedLineItems();
  const rows = items.slice(0, 50).map(([name, count]) => `<div class="item-map-unmatched__row">
    <span title="${escapeHtml(name)}">${escapeHtml(name)}</span>
    <span>${escapeHtml(`${count} ${t(lang, "occurrences")}`)}</span>
    <button type="button" class="inventory-domain-button inventory-domain-button--small" data-item-map-new data-inventory-write data-alias-name="${escapeHtml(name)}"${writeAttributes()}>+ ${escapeHtml(t(lang, "map"))}</button>
  </div>`).join("");
  return `<section class="item-map-unmatched" data-item-map-unmatched-count="${items.length}">
    <h2>${escapeHtml(t(lang, "unmatched"))}<span>${escapeHtml(String(items.length))}</span></h2>
    ${items.length ? `<div class="item-map-unmatched__list">${rows}</div>` : `<p>${escapeHtml(t(lang, "unmatchedEmpty"))}</p>`}
    ${items.length > 50 ? `<p>${escapeHtml(t(lang, "moreHidden", { count: items.length - 50 }))}</p>` : ""}
  </section>`;
}

function renderAliasRow(alias, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const products = productById();
  const mapped = alias.products.map((row) => `${products.get(row.product_id)?.name ?? alias.productNames[0] ?? row.product_id} ×${row.qty}`).join(" + ");
  return `<div class="item-map-row${alias.verified ? "" : " item-map-row--unverified"}" data-item-map-alias="${escapeHtml(alias.id)}">
    <div class="item-map-row__name"><strong title="${escapeHtml(alias.aliasName)}">${escapeHtml(alias.aliasName)}</strong>${alias.verified ? "" : `<span>${escapeHtml(t(lang, "pendingCheck"))}</span>`}${mapped ? `<small title="${escapeHtml(mapped)}">${escapeHtml(mapped)}</small>` : ""}</div>
    <span class="item-map-row__note" title="${escapeHtml(alias.note)}">${escapeHtml(alias.note)}</span>
    <div class="item-map-row__actions">
      ${alias.verified ? "" : `<button type="button" data-item-map-verify="${escapeHtml(alias.id)}" data-inventory-write title="${escapeHtml(t(lang, "confirm"))}"${writeAttributes()}>✓ ${escapeHtml(t(lang, "confirm"))}</button>`}
      <button type="button" data-item-map-edit="${escapeHtml(alias.id)}" data-inventory-write aria-label="${escapeHtml(t(lang, "edit"))}" title="${escapeHtml(t(lang, "edit"))}"${writeAttributes()}>${icon("icon-edit-default", "icon")}</button>
      <button type="button" data-item-map-delete="${escapeHtml(alias.id)}" data-inventory-write aria-label="${escapeHtml(t(lang, "remove"))}" title="${escapeHtml(t(lang, "remove"))}"${writeAttributes()}>×</button>
    </div>
  </div>`;
}

function renderGroups(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const groups = aliasGroups(lang);
  return `<div class="item-map-groups">${groups.map((group) => {
    const expanded = state.expanded.has(group.key);
    const pending = group.items.filter((alias) => !alias.verified).length;
    return `<section class="item-map-group item-map-group--${group.tone}" data-item-map-group="${escapeHtml(group.key)}">
      <button type="button" class="item-map-group__head" data-item-map-group-toggle="${escapeHtml(group.key)}" aria-expanded="${expanded}">
        ${icon("icon-arrow-down", "icon item-map-group__chevron")}<strong title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</strong>
        ${pending ? `<span class="item-map-group__pending">${escapeHtml(`${pending} ${t(lang, "pendingCheck")}`)}</span>` : ""}
        <span>${escapeHtml(`${group.items.length} ${t(lang, "aliases")}`)}</span>
      </button>
      ${expanded ? `<div>${group.items.slice().sort((a, b) => Number(a.verified) - Number(b.verified) || a.aliasName.localeCompare(b.aliasName)).map((alias) => renderAliasRow(alias, helpers)).join("")}</div>` : ""}
    </section>`;
  }).join("")}</div>`;
}

function emptyDraft(aliasName = "") {
  return { id: null, aliasName, skip: false, verified: true, note: "", products: [{ product_id: "", qty: 1 }] };
}

function renderModal(helpers) {
  if (!state.draft) return "";
  const { escapeHtml, lang } = helpers;
  const draft = state.draft;
  const sortedProducts = currentProducts.slice().sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null) || a.name.localeCompare(b.name));
  return `<div class="inventory-domain-overlay" data-item-map-overlay>
    <form class="inventory-domain-modal" data-item-map-form role="dialog" aria-modal="true" aria-label="${escapeHtml(t(lang, draft.id ? "editTitle" : "newTitle"))}">
      <header><h2>${escapeHtml(t(lang, draft.id ? "editTitle" : "newTitle"))}</h2><button type="button" data-item-map-close aria-label="${escapeHtml(t(lang, "close"))}">×</button></header>
      <div class="inventory-domain-modal__body">
        <label class="inventory-domain-field"><span>${escapeHtml(t(lang, "aliasField"))}</span><input data-item-map-field="aliasName" data-inventory-write value="${escapeHtml(draft.aliasName)}" placeholder="${escapeHtml(t(lang, "aliasPlaceholder"))}"${draft.id ? " readonly" : ""}${writeAttributes()}></label>
        ${draft.id ? `<p class="inventory-domain-hint">${escapeHtml(t(lang, "aliasLocked"))}</p>` : ""}
        <label class="inventory-domain-check"><input type="checkbox" data-item-map-skip data-inventory-write${draft.skip ? " checked" : ""}${writeAttributes()}><span>${escapeHtml(t(lang, "skipHint"))}</span></label>
        ${draft.skip ? "" : `<div class="inventory-domain-field"><span>${escapeHtml(t(lang, "products"))} · ${escapeHtml(t(lang, "bundleHint"))}</span>
          <div class="item-map-product-rows">${draft.products.map((row, index) => `<div class="item-map-product-row">
            <select data-item-map-product="${index}" data-inventory-write${writeAttributes()}><option value="">${escapeHtml(t(lang, "chooseProduct"))}</option>${sortedProducts.map((product) => `<option value="${escapeHtml(product.id)}"${row.product_id === product.id ? " selected" : ""}>${escapeHtml(product.name)}</option>`).join("")}</select>
            <input type="number" min="1" data-item-map-qty="${index}" data-inventory-write value="${escapeHtml(String(row.qty))}" aria-label="${escapeHtml(t(lang, "quantity"))}"${writeAttributes()}>
            <button type="button" data-item-map-remove-row="${index}" data-inventory-write aria-label="${escapeHtml(t(lang, "remove"))}" title="${escapeHtml(t(lang, "remove"))}"${writeAttributes(liveReadOnly || draft.products.length === 1)}>×</button>
          </div>`).join("")}</div>
          <button type="button" class="inventory-domain-button inventory-domain-button--secondary" data-item-map-add-row data-inventory-write${writeAttributes()}>+ ${escapeHtml(t(lang, "addRow"))}</button>
        </div>`}
        <label class="inventory-domain-field"><span>${escapeHtml(t(lang, "note"))}</span><textarea data-item-map-field="note" data-inventory-write placeholder="${escapeHtml(t(lang, "notePlaceholder"))}"${writeAttributes()}>${escapeHtml(draft.note)}</textarea></label>
      </div>
      ${state.error ? `<p class="inventory-domain-error">${escapeHtml(state.error)}</p>` : ""}
      <footer><button type="button" class="inventory-domain-button inventory-domain-button--secondary" data-item-map-close>${escapeHtml(t(lang, "cancel"))}</button><button type="submit" class="inventory-domain-button" data-inventory-write${writeAttributes()}>${escapeHtml(t(lang, "save"))}</button></footer>
    </form>
  </div>`;
}

export function renderItemMap(helpers, products) {
  liveReadOnly = helpers.liveReadOnly === true;
  currentProducts = products;
  if (!state.loaded) return `<div class="inventory-domain-empty">${helpers.escapeHtml(t(helpers.lang, "loading"))}</div>`;
  const counts = itemMapGroupCounts();
  return `<section class="inventory-domain-page item-map-page" data-item-map-page data-live-read-only="${liveReadOnly}" data-alias-count="${state.aliases.length}" data-single-count="${counts.single}" data-bundle-count="${counts.bundle}" data-skip-count="${counts.skip}" data-no-product-count="${counts.noProduct}">
    ${state.error && !state.draft ? `<p class="inventory-domain-error">${helpers.escapeHtml(state.error)}</p>` : ""}
    ${renderUnmatched(helpers)}
    <div class="inventory-domain-heading"><h2>${helpers.escapeHtml(t(helpers.lang, "configured"))}<span>${state.aliases.length}</span></h2><button type="button" class="inventory-domain-button" data-item-map-new data-inventory-write${writeAttributes()}>+ ${helpers.escapeHtml(t(helpers.lang, "add"))}</button></div>
    ${renderGroups(helpers)}
    ${renderModal(helpers)}
  </section>`;
}

function closeModal() {
  state.draft = null;
  state.error = "";
  rerender();
}

export function attachItemMapBehaviors({ rerender: nextRerender, scope }) {
  rerender = nextRerender;
  scope.listen(document, "click", async (event) => {
    if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
    const toggle = event.target.closest("[data-item-map-group-toggle]");
    if (toggle) {
      const key = toggle.getAttribute("data-item-map-group-toggle");
      if (state.expanded.has(key)) state.expanded.delete(key);
      else state.expanded.add(key);
      rerender();
      return;
    }
    const create = event.target.closest("[data-item-map-new]");
    if (create) {
      state.error = "";
      state.draft = emptyDraft(create.getAttribute("data-alias-name") || "");
      rerender();
      return;
    }
    const verify = event.target.closest("[data-item-map-verify]");
    if (verify) {
      const aliasId = verify.getAttribute("data-item-map-verify");
      state.busy = true;
      state.error = "";
      rerender();
      try {
        const saved = aliasFromLiveRow(await verifyLiveInventoryAlias(aliasId));
        if (!scope.isCurrent()) return;
        state.aliases = state.aliases.map((alias) => alias.id === aliasId ? saved : alias);
      } catch (error) {
        state.error = `${t(currentHelpersLang(), "operationFailed")}: ${error.message}`;
      } finally {
        state.busy = false;
        if (scope.isCurrent()) rerender();
      }
      return;
    }
    const edit = event.target.closest("[data-item-map-edit]");
    if (edit) {
      const alias = state.aliases.find((item) => item.id === edit.getAttribute("data-item-map-edit"));
      if (alias) {
        state.error = "";
        state.draft = { ...alias, products: alias.products.length ? alias.products.map((row) => ({ ...row })) : [{ product_id: "", qty: 1 }] };
      }
      rerender();
      return;
    }
    const remove = event.target.closest("[data-item-map-delete]");
    if (remove && await confirmInPage(t(currentHelpersLang(), "deleteConfirm"), { danger: true })) {
      if (!scope.isCurrent()) return;
      const aliasId = remove.getAttribute("data-item-map-delete");
      state.busy = true;
      state.error = "";
      rerender();
      try {
        await deleteLiveInventoryAlias(aliasId);
        if (!scope.isCurrent()) return;
        state.aliases = state.aliases.filter((item) => item.id !== aliasId);
      } catch (error) {
        state.error = `${t(currentHelpersLang(), "operationFailed")}: ${error.message}`;
      } finally {
        state.busy = false;
        if (scope.isCurrent()) rerender();
      }
      return;
    }
    if (event.target.closest("[data-item-map-close]") || event.target.matches("[data-item-map-overlay]")) return closeModal();
    if (event.target.closest("[data-item-map-add-row]")) {
      state.draft.products.push({ product_id: "", qty: 1 });
      rerender();
      return;
    }
    const removeRow = event.target.closest("[data-item-map-remove-row]");
    if (removeRow && state.draft.products.length > 1) {
      state.draft.products.splice(Number(removeRow.getAttribute("data-item-map-remove-row")), 1);
      rerender();
    }
  });
  scope.listen(document, "input", (event) => {
    if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
    if (!state.draft) return;
    const field = event.target.closest("[data-item-map-field]");
    if (field) state.draft[field.getAttribute("data-item-map-field")] = field.value;
    const qty = event.target.closest("[data-item-map-qty]");
    if (qty) state.draft.products[Number(qty.getAttribute("data-item-map-qty"))].qty = Number(qty.value) || 1;
  });
  scope.listen(document, "change", (event) => {
    if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
    if (!state.draft) return;
    if (event.target.matches("[data-item-map-skip]")) {
      state.draft.skip = event.target.checked;
      rerender();
      return;
    }
    const product = event.target.closest("[data-item-map-product]");
    if (product) state.draft.products[Number(product.getAttribute("data-item-map-product"))].product_id = product.value;
  });
  scope.listen(document, "submit", async (event) => {
    if (!event.target.matches("[data-item-map-form]") || !state.draft) return;
    event.preventDefault();
    if (liveReadOnly) return;
    const aliasName = state.draft.aliasName.trim();
    if (!aliasName) {
      state.error = t(currentHelpersLang(), "required");
      rerender();
      return;
    }
    const draft = {
      ...state.draft,
      aliasName,
      products: state.draft.skip ? [] : state.draft.products
        .filter((row) => row.product_id)
        .map((row) => ({ product_id: row.product_id, qty: Number(row.qty) || 1 }))
    };
    state.busy = true;
    state.error = "";
    rerender();
    try {
      const saved = aliasFromLiveRow(await saveLiveInventoryAlias(draft));
      if (!scope.isCurrent()) return;
      const index = state.aliases.findIndex((alias) => alias.id === saved.id);
      if (index >= 0) state.aliases[index] = saved;
      else state.aliases.unshift(saved);
      state.draft = null;
    } catch (error) {
      state.error = `${t(currentHelpersLang(), "operationFailed")}: ${error.message}`;
    } finally {
      state.busy = false;
      if (scope.isCurrent()) rerender();
    }
  });
  scope.listen(document, "keydown", (event) => {
    if (event.key === "Escape" && state.draft) closeModal();
  });
}

export function captureItemMapState() {
  return { expanded: [...state.expanded] };
}

export function restoreItemMapState(value = null) {
  state.expanded = new Set(Array.isArray(value?.expanded) ? value.expanded.map(String) : []);
  state.draft = null;
  state.error = "";
}

export function hasItemMapUnsavedChanges() {
  return state.draft !== null;
}

export function disposeItemMapState() {
  dataLoadVersion += 1;
  state.loaded = false;
  state.aliases = [];
  state.orders = [];
  state.expanded = new Set();
  state.draft = null;
  state.busy = false;
  state.error = "";
  currentProducts = [];
  liveReadOnly = false;
  rerender = () => {};
}

function currentHelpersLang() {
  return document.documentElement.lang === "fr" ? "fr" : document.documentElement.lang === "en" ? "en" : "zh";
}
