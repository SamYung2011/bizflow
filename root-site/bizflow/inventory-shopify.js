import { getShopifyLinksData } from "../data/provider.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import {
  confirmLiveShopifyBinding,
  getShopifyAlignmentPlan,
  getShopifyCredentialHealth,
  linkLiveShopifyComponent,
  saveLiveShopifyResourceMapping,
  unlinkLiveShopifyComponent
} from "../data/live-inventory-writes.js";

const copy = {
  zh: {
    title: "Shopify API",
    settings: "Shopify 集成設置",
    credentialRule: "憑證由 Edge secrets 管理，前端不讀取或回傳 token",
    domain: "Shop Domain",
    token: "Access Token",
    unlock: "解鎖編輯",
    test: "測試連接",
    save: "儲存",
    unavailable: "Shopify 寫入憑證未就緒",
    connectedReadOnly: "只讀連接正常，等待 write_products + write_inventory",
    connectedWrite: "讀寫連接已就緒",
    refresh: "重新檢查",
    alignment: "目錄對齊計劃",
    alignmentHint: "老商品先確認綁定；未綁定商品不能保存。",
    bind: "確認綁定",
    refreshBinding: "刷新綁定基線",
    selectProduct: "選擇 Shopify 商品",
    state_active: "已綁定",
    state_ready_to_bind: "可確認",
    state_conflict: "衝突，需人工選擇",
    state_unbound: "未綁定",
    mappings: "資源映射",
    warehouseMapping: "BizFlow 倉庫 → Shopify Location",
    collectionMapping: "BizFlow 集合 → Shopify Collection",
    notMapped: "未映射",
    mappingSaved: "映射已保存",
    bindingSaved: "商品綁定已確認",
    operationFailed: "操作失敗",
    associations: "Shopify 商品關聯",
    associationCount: "條關聯",
    search: "搜尋 SKU 或產品名稱",
    product: "Shopify 商品",
    variant: "Variant",
    sku: "SKU",
    linked: "已關聯 bizflow 產品",
    unlink: "解除",
    unlinkConfirm: "確認解除這條商品關聯？",
    link: "關聯",
    reverse: "用 line item 映射倒推關聯",
    reverseHint: "依賴寫入 API，正式接入後可用",
    linkTitle: "關聯 Shopify variant",
    findProduct: "搜尋 bizflow 商品",
    selected: "已選商品",
    quantity: "數量",
    cancel: "取消",
    close: "關閉",
    confirm: "確認關聯",
    empty: "暫無符合條件的 Shopify 商品關聯",
    loading: "正在載入 Shopify 關聯"
  },
  en: {
    title: "Shopify API",
    settings: "Shopify integration settings",
    credentialRule: "Credentials are managed in Edge secrets; the browser never reads or returns the token",
    domain: "Shop Domain",
    token: "Access Token",
    unlock: "Unlock editing",
    test: "Test connection",
    save: "Save",
    unavailable: "Shopify write credential is not ready",
    connectedReadOnly: "Read access is ready; waiting for write_products + write_inventory",
    connectedWrite: "Read and write access is ready",
    refresh: "Check again",
    alignment: "Catalogue alignment plan",
    alignmentHint: "Confirm bindings for existing products before saving them.",
    bind: "Confirm binding",
    refreshBinding: "Refresh binding baseline",
    selectProduct: "Select Shopify product",
    state_active: "Bound",
    state_ready_to_bind: "Ready to confirm",
    state_conflict: "Conflict; choose manually",
    state_unbound: "Unbound",
    mappings: "Resource mappings",
    warehouseMapping: "BizFlow warehouse → Shopify location",
    collectionMapping: "BizFlow collection → Shopify collection",
    notMapped: "Not mapped",
    mappingSaved: "Mapping saved",
    bindingSaved: "Product binding confirmed",
    operationFailed: "Operation failed",
    associations: "Shopify product associations",
    associationCount: "links",
    search: "Search SKU or product name",
    product: "Shopify product",
    variant: "Variant",
    sku: "SKU",
    linked: "Linked BizFlow products",
    unlink: "Unlink",
    unlinkConfirm: "Unlink this product association?",
    link: "Link",
    reverse: "Infer links from line item mappings",
    reverseHint: "Requires the write API and will be available after integration",
    linkTitle: "Link Shopify variant",
    findProduct: "Search BizFlow products",
    selected: "Selected product",
    quantity: "Quantity",
    cancel: "Cancel",
    close: "Close",
    confirm: "Confirm link",
    empty: "No Shopify associations match the search",
    loading: "Loading Shopify associations"
  },
  fr: {
    title: "API Shopify",
    settings: "Paramètres d'intégration Shopify",
    credentialRule: "Les identifiants sont gérés dans les secrets Edge ; le navigateur ne reçoit jamais le jeton",
    domain: "Shop Domain",
    token: "Access Token",
    unlock: "Déverrouiller",
    test: "Tester la connexion",
    save: "Enregistrer",
    unavailable: "Les identifiants d'écriture Shopify ne sont pas prêts",
    connectedReadOnly: "Lecture prête ; write_products et write_inventory sont encore requis",
    connectedWrite: "Accès en lecture et écriture prêt",
    refresh: "Revérifier",
    alignment: "Plan d'alignement du catalogue",
    alignmentHint: "Confirmez les associations des anciens produits avant de les enregistrer.",
    bind: "Confirmer l'association",
    refreshBinding: "Actualiser la référence",
    selectProduct: "Choisir un produit Shopify",
    state_active: "Associé",
    state_ready_to_bind: "Prêt à confirmer",
    state_conflict: "Conflit ; sélection manuelle requise",
    state_unbound: "Non associé",
    mappings: "Mappages des ressources",
    warehouseMapping: "Entrepôt BizFlow → emplacement Shopify",
    collectionMapping: "Collection BizFlow → collection Shopify",
    notMapped: "Non mappé",
    mappingSaved: "Mappage enregistré",
    bindingSaved: "Association produit confirmée",
    operationFailed: "Échec de l'opération",
    associations: "Associations de produits Shopify",
    associationCount: "liens",
    search: "Rechercher SKU ou nom de produit",
    product: "Produit Shopify",
    variant: "Variante",
    sku: "SKU",
    linked: "Produits BizFlow associés",
    unlink: "Dissocier",
    unlinkConfirm: "Dissocier ce produit ?",
    link: "Associer",
    reverse: "Déduire les liens depuis les mappages d'articles",
    reverseHint: "Nécessite l'API d'écriture et sera disponible après l'intégration",
    linkTitle: "Associer une variante Shopify",
    findProduct: "Rechercher des produits BizFlow",
    selected: "Produit sélectionné",
    quantity: "Quantité",
    cancel: "Annuler",
    close: "Fermer",
    confirm: "Confirmer l'association",
    empty: "Aucune association Shopify ne correspond",
    loading: "Chargement des associations Shopify"
  }
};

const state = {
  loaded: false,
  links: [],
  variants: [],
  expanded: new Set(),
  search: "",
  modal: null,
  productSearch: "",
  selectedProductId: "",
  qty: 1,
  health: null,
  alignment: null,
  bindingSelections: new Map(),
  busy: false,
  error: "",
  feedback: ""
};

let rerender = () => {};
let currentProducts = [];
let liveReadOnly = false;
let dataLoadVersion = 0;

function writeAttributes(disabled = liveReadOnly) {
  return disabled ? ' disabled aria-disabled="true"' : "";
}

function t(lang, key) {
  return copy[lang]?.[key] ?? copy.zh[key] ?? key;
}

export async function ensureShopifyData({ scope = null, signal = scope?.signal } = {}) {
  if (state.loaded) return;
  const version = dataLoadVersion;
  const [data, health, alignmentResult] = await Promise.all([
    getShopifyLinksData(),
    getShopifyCredentialHealth(),
    getShopifyAlignmentPlan().catch((error) => ({ error }))
  ]);
  if (version !== dataLoadVersion || signal?.aborted || (scope && !scope.isCurrent())) return;
  state.links = data.links;
  state.health = alignmentResult?.health || health;
  state.alignment = alignmentResult?.alignment || null;
  state.error = alignmentResult?.error?.message || "";
  const variants = new Map();
  for (const link of data.links) {
    if (!variants.has(link.shopifyVariantId)) {
      variants.set(link.shopifyVariantId, {
        shopifyVariantId: link.shopifyVariantId,
        shopifyProductId: link.shopifyProductId,
        shopifySku: link.shopifySku
      });
    } else if (!variants.get(link.shopifyVariantId).shopifySku && link.shopifySku) {
      variants.get(link.shopifyVariantId).shopifySku = link.shopifySku;
    }
  }
  state.variants = [...variants.values()];
  const firstGroups = [...new Set(state.variants.map((variant) => variant.shopifyProductId))].slice(0, 3);
  if (!state.expanded.size) state.expanded = new Set(firstGroups);
  state.busy = false;
  state.loaded = true;
}

export function shopifyProductGroupCount(links = state.links) {
  return new Set(links.map((link) => link.shopifyProductId)).size;
}

function suffix(value) {
  return String(value || "").split("/").at(-1) || "—";
}

function groupedVariants() {
  const query = state.search.trim().toLocaleLowerCase();
  const groups = new Map();
  for (const variant of state.variants) {
    const links = state.links.filter((link) => link.shopifyVariantId === variant.shopifyVariantId);
    const haystack = [variant.shopifySku, suffix(variant.shopifyProductId), ...links.map((link) => link.bizflowProductName)].join(" ").toLocaleLowerCase();
    if (query && !haystack.includes(query)) continue;
    if (!groups.has(variant.shopifyProductId)) groups.set(variant.shopifyProductId, []);
    groups.get(variant.shopifyProductId).push({ ...variant, links });
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function renderSettings(helpers) {
  const { escapeHtml, lang } = helpers;
  const health = state.health || {};
  const ready = health.writeReady === true;
  const status = ready ? t(lang, "connectedWrite")
    : health.readReady ? t(lang, "connectedReadOnly") : t(lang, "unavailable");
  return `<section class="inventory-domain-card shopify-settings" data-shopify-credential-fields="masked-only">
    <div class="inventory-domain-card__head"><div><h2>${escapeHtml(t(lang, "settings"))}</h2><p>${escapeHtml(t(lang, "credentialRule"))}</p></div></div>
    <div class="shopify-settings__fields">
      <label class="inventory-domain-field"><span>${escapeHtml(t(lang, "domain"))}</span><input value="${escapeHtml(health.domain || "—")}" readonly aria-readonly="true"></label>
      <label class="inventory-domain-field"><span>API</span><input value="${escapeHtml(health.apiVersion || "—")}" readonly aria-readonly="true"></label>
    </div>
    <div class="inventory-domain-actions">
      <button type="button" class="inventory-domain-button inventory-domain-button--secondary" data-shopify-health-refresh${state.busy ? " disabled" : ""}>${escapeHtml(t(lang, "refresh"))}</button>
      <span class="inventory-domain-hint" data-shopify-credential-source="${escapeHtml(health.source || "none")}">${escapeHtml(status)}</span>
    </div>
  </section>`;
}

function selectedBindingProduct(item) {
  return state.bindingSelections.get(item.bizflowParentProductId) || item.candidateShopifyProductId || "";
}

function renderAlignment(helpers) {
  if (!state.alignment) return "";
  const { escapeHtml, lang } = helpers;
  const options = state.alignment.shopifyProducts || [];
  const rows = (state.alignment.plan || []).map((item) => {
    const selected = selectedBindingProduct(item);
    const validSelected = options.some((product) => product.id === selected);
    const disabled = state.busy || !validSelected;
    return `<div class="shopify-alignment-row" data-alignment-state="${escapeHtml(item.state)}">
      <div><strong>${escapeHtml(item.bizflowName || item.bizflowInternalCode || item.bizflowParentProductId)}</strong><span>${escapeHtml(t(lang, `state_${item.state}`))}</span></div>
      <select data-shopify-binding-select="${escapeHtml(item.bizflowParentProductId)}"${item.state === "active" || state.busy ? " disabled" : ""}>
        <option value="">${escapeHtml(t(lang, "selectProduct"))}</option>
        ${options.map((product) => `<option value="${escapeHtml(product.id)}"${selected === product.id ? " selected" : ""}>${escapeHtml(product.title)} · ${escapeHtml(suffix(product.id))}</option>`).join("")}
      </select>
      <button type="button" class="inventory-domain-button inventory-domain-button--small" data-shopify-confirm-binding="${escapeHtml(item.bizflowParentProductId)}"${disabled ? " disabled aria-disabled=\"true\"" : ""}>${escapeHtml(t(lang, item.state === "active" ? "refreshBinding" : "bind"))}</button>
    </div>`;
  }).join("");
  return `<section class="inventory-domain-card shopify-alignment" data-shopify-alignment-count="${state.alignment.plan?.length || 0}">
    <div class="inventory-domain-card__head"><div><h2>${escapeHtml(t(lang, "alignment"))}</h2><p>${escapeHtml(t(lang, "alignmentHint"))}</p></div></div>
    <div class="shopify-alignment-list">${rows}</div>
  </section>`;
}

function mappingSelect({ kind, bizflowKey, label, options }, helpers) {
  const { escapeHtml, lang } = helpers;
  const current = (state.alignment?.mappings || []).find((row) => row.kind === kind && String(row.bizflow_key) === String(bizflowKey));
  return `<label class="shopify-mapping-row"><span>${escapeHtml(label)}</span><select data-shopify-resource-mapping data-kind="${escapeHtml(kind)}" data-bizflow-key="${escapeHtml(bizflowKey)}"${state.busy ? " disabled" : ""}>
    <option value="">${escapeHtml(t(lang, "notMapped"))}</option>
    ${options.map((option) => `<option value="${escapeHtml(option.id)}" data-resource-name="${escapeHtml(option.name || option.title || "")}"${current?.shopify_resource_id === option.id ? " selected" : ""}>${escapeHtml(option.name || option.title || option.id)}</option>`).join("")}
  </select></label>`;
}

function renderMappings(helpers) {
  if (!state.alignment) return "";
  const { escapeHtml, lang } = helpers;
  return `<section class="inventory-domain-card shopify-mappings">
    <div class="inventory-domain-card__head"><div><h2>${escapeHtml(t(lang, "mappings"))}</h2></div></div>
    <h3>${escapeHtml(t(lang, "warehouseMapping"))}</h3>
    ${(state.alignment.warehouses || []).map((warehouse) => mappingSelect({ kind: "location", bizflowKey: warehouse.id, label: warehouse.name || warehouse.code, options: state.alignment.locations || [] }, helpers)).join("")}
    <h3>${escapeHtml(t(lang, "collectionMapping"))}</h3>
    ${(state.alignment.collectionKeys || []).map((name) => mappingSelect({ kind: "collection", bizflowKey: name, label: name, options: state.alignment.collections || [] }, helpers)).join("")}
  </section>`;
}

function renderVariant(variant, helpers) {
  const { escapeHtml, lang } = helpers;
  const chips = variant.links.map((link) => `<span class="shopify-link-chip" data-shopify-link-chip="${escapeHtml(link.id)}">
    <span title="${escapeHtml(link.bizflowProductName || link.bizflowProductId)}">${escapeHtml(link.bizflowProductName || link.bizflowProductId)} ×${escapeHtml(String(link.qty))}</span>
    <button type="button" data-shopify-unlink="${escapeHtml(link.id)}" data-inventory-write aria-label="${escapeHtml(t(lang, "unlink"))}" title="${escapeHtml(t(lang, "unlink"))}"${writeAttributes()}>×</button>
  </span>`).join("");
  return `<div class="shopify-variant-row" data-shopify-variant="${escapeHtml(variant.shopifyVariantId)}">
    <div><strong>${escapeHtml(t(lang, "variant"))} ${escapeHtml(suffix(variant.shopifyVariantId))}</strong><span>${escapeHtml(t(lang, "sku"))}: ${escapeHtml(variant.shopifySku || "—")}</span></div>
    <div class="shopify-variant-row__links">${chips}</div>
    <button type="button" class="inventory-domain-button inventory-domain-button--small inventory-domain-button--secondary" data-shopify-link data-inventory-write data-variant-id="${escapeHtml(variant.shopifyVariantId)}" data-product-id="${escapeHtml(variant.shopifyProductId)}" data-sku="${escapeHtml(variant.shopifySku)}"${writeAttributes()}>+ ${escapeHtml(t(lang, "link"))}</button>
  </div>`;
}

function renderAssociations(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const groups = groupedVariants();
  return `<section class="inventory-domain-card shopify-associations" data-shopify-link-count="${state.links.length}" data-shopify-product-groups="${shopifyProductGroupCount()}">
    <div class="inventory-domain-card__head"><div><h2>${escapeHtml(t(lang, "associations"))}<span>${state.links.length} ${escapeHtml(t(lang, "associationCount"))}</span></h2></div>
      <label class="inventory-domain-search">${icon("icon-nav-search", "icon")}<input type="search" data-shopify-search value="${escapeHtml(state.search)}" placeholder="${escapeHtml(t(lang, "search"))}"></label>
    </div>
    <div class="shopify-groups">${groups.map(([productId, variants]) => {
      const expanded = state.expanded.has(productId);
      return `<section class="shopify-group"><button type="button" class="shopify-group__head" data-shopify-group="${escapeHtml(productId)}" aria-expanded="${expanded}">
        ${icon("icon-arrow-down", "icon shopify-group__chevron")}<strong>${escapeHtml(t(lang, "product"))} ${escapeHtml(suffix(productId))}</strong><span>${variants.length}</span>
      </button>${expanded ? `<div>${variants.map((variant) => renderVariant(variant, helpers)).join("")}</div>` : ""}</section>`;
    }).join("")}</div>
    ${groups.length ? "" : `<div class="inventory-domain-empty">${escapeHtml(t(lang, "empty"))}</div>`}
    <div class="shopify-reverse"><div><strong>${escapeHtml(t(lang, "reverse"))}</strong><span>${escapeHtml(t(lang, "reverseHint"))}</span></div><button type="button" class="inventory-domain-button inventory-domain-button--secondary" disabled>${escapeHtml(t(lang, "reverse"))}</button></div>
  </section>`;
}

function renderLinkModal(helpers) {
  if (!state.modal) return "";
  const { escapeHtml, icon, lang } = helpers;
  const query = state.productSearch.trim().toLocaleLowerCase();
  const products = currentProducts.filter((product) => !query || product.name.toLocaleLowerCase().includes(query)).slice(0, 30);
  const selected = currentProducts.find((product) => product.id === state.selectedProductId);
  return `<div class="inventory-domain-overlay" data-shopify-overlay>
    <form class="inventory-domain-modal" data-shopify-link-form role="dialog" aria-modal="true" aria-label="${escapeHtml(t(lang, "linkTitle"))}">
      <header><h2>${escapeHtml(t(lang, "linkTitle"))}</h2><button type="button" data-shopify-close aria-label="${escapeHtml(t(lang, "close"))}">×</button></header>
      <div class="inventory-domain-modal__body">
        <p class="inventory-domain-hint">${escapeHtml(t(lang, "variant"))}: ${escapeHtml(suffix(state.modal.variantId))}</p>
        <label class="inventory-domain-search inventory-domain-search--wide">${icon("icon-nav-search", "icon")}<input type="search" data-shopify-product-search data-inventory-write value="${escapeHtml(state.productSearch)}" placeholder="${escapeHtml(t(lang, "findProduct"))}"${writeAttributes()}></label>
        <div class="shopify-product-options">${products.map((product) => `<button type="button" class="shopify-product-option${product.id === state.selectedProductId ? " is-selected" : ""}" data-shopify-product-option="${escapeHtml(product.id)}" data-inventory-write${writeAttributes()}><span title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</span><small>${escapeHtml(product.category || "—")}</small></button>`).join("")}</div>
        <div class="shopify-link-selection"><span>${escapeHtml(t(lang, "selected"))}</span><strong>${escapeHtml(selected?.name || "—")}</strong></div>
        <label class="inventory-domain-field"><span>${escapeHtml(t(lang, "quantity"))}</span><input type="number" min="1" data-shopify-link-qty data-inventory-write value="${escapeHtml(String(state.qty))}"${writeAttributes()}></label>
      </div>
      <footer><button type="button" class="inventory-domain-button inventory-domain-button--secondary" data-shopify-close>${escapeHtml(t(lang, "cancel"))}</button><button type="submit" class="inventory-domain-button" data-inventory-write${writeAttributes(liveReadOnly || !selected)}>${escapeHtml(t(lang, "confirm"))}</button></footer>
    </form>
  </div>`;
}

export function renderShopify(helpers, products) {
  // The current read-only token may still confirm catalogue/resource mappings.
  // Product save/delete remains disabled by the parent inventory credential gate.
  liveReadOnly = state.health?.readReady !== true;
  currentProducts = products;
  if (!state.loaded) return `<div class="inventory-domain-empty">${helpers.escapeHtml(t(helpers.lang, "loading"))}</div>`;
  return `<section class="inventory-domain-page shopify-page" data-shopify-page data-live-read-only="${liveReadOnly}">
    ${renderSettings(helpers)}
    ${state.error ? `<p class="inventory-domain-error">${helpers.escapeHtml(state.error)}</p>` : ""}
    ${state.feedback ? `<p class="inventory-domain-hint">${helpers.escapeHtml(state.feedback)}</p>` : ""}
    ${renderAlignment(helpers)}${renderMappings(helpers)}${renderAssociations(helpers)}${renderLinkModal(helpers)}
  </section>`;
}

async function reloadShopifyData(scope) {
  state.loaded = false;
  state.error = "";
  await ensureShopifyData({ scope });
  state.busy = false;
  if (scope.isCurrent()) rerender();
}

function closeModal() {
  state.modal = null;
  state.productSearch = "";
  state.selectedProductId = "";
  state.qty = 1;
  rerender();
}

export function attachShopifyBehaviors({ rerender: nextRerender, scope }) {
  rerender = nextRerender;
  scope.listen(document, "click", async (event) => {
    if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
    const healthRefresh = event.target.closest("[data-shopify-health-refresh]");
    if (healthRefresh) {
      state.busy = true;
      rerender();
      state.health = await getShopifyCredentialHealth({ refresh: true });
      state.busy = false;
      if (scope.isCurrent()) rerender();
      return;
    }
    const binding = event.target.closest("[data-shopify-confirm-binding]");
    if (binding) {
      const parentId = binding.getAttribute("data-shopify-confirm-binding");
      const shopifyProductId = state.bindingSelections.get(parentId) ||
        state.alignment?.plan?.find((item) => item.bizflowParentProductId === parentId)?.candidateShopifyProductId;
      if (!shopifyProductId) return;
      state.busy = true;
      state.error = "";
      rerender();
      try {
        await confirmLiveShopifyBinding(parentId, shopifyProductId);
        state.feedback = t(currentLang(), "bindingSaved");
        await reloadShopifyData(scope);
      } catch (error) {
        state.error = `${t(currentLang(), "operationFailed")}: ${error.message}`;
        state.busy = false;
        if (scope.isCurrent()) rerender();
      }
      return;
    }
    const group = event.target.closest("[data-shopify-group]");
    if (group) {
      const id = group.getAttribute("data-shopify-group");
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      rerender();
      return;
    }
    const unlink = event.target.closest("[data-shopify-unlink]");
    if (unlink && await confirmInPage(t(currentLang(), "unlinkConfirm"), { danger: true })) {
      if (!scope.isCurrent()) return;
      const row = state.links.find((link) => link.id === unlink.getAttribute("data-shopify-unlink"));
      if (!row) return;
      try {
        await unlinkLiveShopifyComponent({ shopifyVariantId: row.shopifyVariantId, bizflowProductId: row.bizflowProductId });
        await reloadShopifyData(scope);
      } catch (error) {
        state.error = `${t(currentLang(), "operationFailed")}: ${error.message}`;
        rerender();
      }
      return;
    }
    const link = event.target.closest("[data-shopify-link]");
    if (link) {
      state.modal = {
        variantId: link.getAttribute("data-variant-id"),
        productId: link.getAttribute("data-product-id"),
        sku: link.getAttribute("data-sku")
      };
      rerender();
      return;
    }
    const option = event.target.closest("[data-shopify-product-option]");
    if (option) {
      state.selectedProductId = option.getAttribute("data-shopify-product-option");
      rerender();
      return;
    }
    if (event.target.closest("[data-shopify-close]") || event.target.matches("[data-shopify-overlay]")) closeModal();
  });
  scope.listen(document, "input", (event) => {
    if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
    const search = event.target.closest("[data-shopify-search]");
    if (search) {
      state.search = search.value;
      rerender();
      scope.animationFrame(() => focusAtEnd("[data-shopify-search]"));
      return;
    }
    const productSearch = event.target.closest("[data-shopify-product-search]");
    if (productSearch) {
      state.productSearch = productSearch.value;
      rerender();
      scope.animationFrame(() => focusAtEnd("[data-shopify-product-search]"));
      return;
    }
    const qty = event.target.closest("[data-shopify-link-qty]");
    if (qty) state.qty = Math.max(1, Number(qty.value) || 1);
  });
  scope.listen(document, "change", async (event) => {
    const binding = event.target.closest("[data-shopify-binding-select]");
    if (binding) {
      state.bindingSelections.set(binding.getAttribute("data-shopify-binding-select"), binding.value);
      rerender();
      return;
    }
    const mapping = event.target.closest("[data-shopify-resource-mapping]");
    if (!mapping) return;
    const selected = mapping.options[mapping.selectedIndex];
    state.busy = true;
    rerender();
    try {
      await saveLiveShopifyResourceMapping({
        kind: mapping.getAttribute("data-kind"),
        bizflowKey: mapping.getAttribute("data-bizflow-key"),
        shopifyResourceId: mapping.value,
        shopifyName: selected?.dataset.resourceName || selected?.textContent || ""
      });
      state.feedback = t(currentLang(), "mappingSaved");
      await reloadShopifyData(scope);
    } catch (error) {
      state.error = `${t(currentLang(), "operationFailed")}: ${error.message}`;
      state.busy = false;
      if (scope.isCurrent()) rerender();
    }
  });
  scope.listen(document, "submit", async (event) => {
    if (!event.target.matches("[data-shopify-link-form]") || !state.modal || !state.selectedProductId) return;
    event.preventDefault();
    if (liveReadOnly) return;
    const product = currentProducts.find((item) => item.id === state.selectedProductId);
    if (!product) return;
    try {
      await linkLiveShopifyComponent({
        shopifyVariantId: state.modal.variantId,
        shopifyProductId: state.modal.productId,
        shopifySku: state.modal.sku,
        bizflowProductId: product.id,
        qty: state.qty
      });
      state.modal = null;
      await reloadShopifyData(scope);
    } catch (error) {
      state.error = `${t(currentLang(), "operationFailed")}: ${error.message}`;
      if (scope.isCurrent()) rerender();
    }
  });
  scope.listen(document, "keydown", (event) => {
    if (event.key === "Escape" && state.modal) closeModal();
  });
}

export function captureShopifyState() {
  return { expanded: [...state.expanded], search: state.search };
}

export function restoreShopifyState(value = null) {
  state.expanded = new Set(Array.isArray(value?.expanded) ? value.expanded.map(String) : []);
  state.search = typeof value?.search === "string" ? value.search : "";
  state.modal = null;
  state.productSearch = "";
  state.selectedProductId = "";
  state.qty = 1;
}

export function hasShopifyUnsavedChanges() {
  return state.modal !== null && Boolean(state.selectedProductId || state.productSearch || state.qty !== 1);
}

export function disposeShopifyState() {
  dataLoadVersion += 1;
  state.loaded = false;
  state.links = [];
  state.variants = [];
  state.expanded = new Set();
  state.search = "";
  state.modal = null;
  state.productSearch = "";
  state.selectedProductId = "";
  state.qty = 1;
  state.health = null;
  state.alignment = null;
  state.bindingSelections = new Map();
  state.busy = false;
  state.error = "";
  state.feedback = "";
  currentProducts = [];
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
