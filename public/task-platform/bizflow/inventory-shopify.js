import { getShopifyLinksData } from "../data/provider.js";

// Existing BizFlow keeps this tab behind isBfAdmin; the new UI permission model is not wired yet.
const copy = {
  zh: {
    title: "Shopify API",
    settings: "Shopify 集成設置",
    credentialRule: "憑證不進快照，正式接入後才可解鎖和寫入",
    domain: "Shop Domain",
    token: "Access Token",
    unlock: "解鎖編輯",
    test: "測試連接",
    save: "儲存",
    unavailable: "正式接入後可用",
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
    credentialRule: "Credentials are excluded from snapshots and can only be edited after production integration",
    domain: "Shop Domain",
    token: "Access Token",
    unlock: "Unlock editing",
    test: "Test connection",
    save: "Save",
    unavailable: "Available after production integration",
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
    credentialRule: "Les identifiants sont exclus des instantanés et seront modifiables après l'intégration",
    domain: "Shop Domain",
    token: "Access Token",
    unlock: "Déverrouiller",
    test: "Tester la connexion",
    save: "Enregistrer",
    unavailable: "Disponible après l'intégration en production",
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
  qty: 1
};

let rerender = () => {};
let currentProducts = [];
let attached = false;
let liveReadOnly = false;

function writeAttributes(disabled = liveReadOnly) {
  return disabled ? ' disabled aria-disabled="true"' : "";
}

function t(lang, key) {
  return copy[lang]?.[key] ?? copy.zh[key] ?? key;
}

export async function ensureShopifyData() {
  if (state.loaded) return;
  const data = await getShopifyLinksData();
  state.links = data.links;
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
  state.expanded = new Set(firstGroups);
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
  return `<section class="inventory-domain-card shopify-settings" data-shopify-credential-fields="masked-only">
    <div class="inventory-domain-card__head"><div><h2>${escapeHtml(t(lang, "settings"))}</h2><p>${escapeHtml(t(lang, "credentialRule"))}</p></div></div>
    <div class="shopify-settings__fields">
      <label class="inventory-domain-field"><span>${escapeHtml(t(lang, "domain"))}</span><input value="●●●●" readonly aria-readonly="true"></label>
      <label class="inventory-domain-field"><span>${escapeHtml(t(lang, "token"))}</span><input value="●●●●" readonly aria-readonly="true"></label>
    </div>
    <div class="inventory-domain-actions">
      <button type="button" class="inventory-domain-button inventory-domain-button--secondary" disabled>${escapeHtml(t(lang, "unlock"))}</button>
      <button type="button" class="inventory-domain-button inventory-domain-button--secondary" disabled>${escapeHtml(t(lang, "test"))}</button>
      <button type="button" class="inventory-domain-button" disabled>${escapeHtml(t(lang, "save"))}</button>
      <span class="inventory-domain-hint">${escapeHtml(t(lang, "unavailable"))}</span>
    </div>
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
  liveReadOnly = helpers.liveReadOnly === true;
  currentProducts = products;
  if (!state.loaded) return `<div class="inventory-domain-empty">${helpers.escapeHtml(t(helpers.lang, "loading"))}</div>`;
  return `<section class="inventory-domain-page shopify-page" data-shopify-page data-live-read-only="${liveReadOnly}">${renderSettings(helpers)}${renderAssociations(helpers)}${renderLinkModal(helpers)}</section>`;
}

function closeModal() {
  state.modal = null;
  state.productSearch = "";
  state.selectedProductId = "";
  state.qty = 1;
  rerender();
}

export function attachShopifyBehaviors({ rerender: nextRerender }) {
  rerender = nextRerender;
  if (attached) return;
  attached = true;
  document.addEventListener("click", (event) => {
    if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
    const group = event.target.closest("[data-shopify-group]");
    if (group) {
      const id = group.getAttribute("data-shopify-group");
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      rerender();
      return;
    }
    const unlink = event.target.closest("[data-shopify-unlink]");
    if (unlink && window.confirm(t(currentLang(), "unlinkConfirm"))) {
      state.links = state.links.filter((link) => link.id !== unlink.getAttribute("data-shopify-unlink"));
      rerender();
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
  document.addEventListener("input", (event) => {
    if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
    const search = event.target.closest("[data-shopify-search]");
    if (search) {
      state.search = search.value;
      rerender();
      requestAnimationFrame(() => focusAtEnd("[data-shopify-search]"));
      return;
    }
    const productSearch = event.target.closest("[data-shopify-product-search]");
    if (productSearch) {
      state.productSearch = productSearch.value;
      rerender();
      requestAnimationFrame(() => focusAtEnd("[data-shopify-product-search]"));
      return;
    }
    const qty = event.target.closest("[data-shopify-link-qty]");
    if (qty) state.qty = Math.max(1, Number(qty.value) || 1);
  });
  document.addEventListener("submit", (event) => {
    if (!event.target.matches("[data-shopify-link-form]") || !state.modal || !state.selectedProductId) return;
    event.preventDefault();
    if (liveReadOnly) return;
    const product = currentProducts.find((item) => item.id === state.selectedProductId);
    if (!product) return;
    const existing = state.links.find((item) => item.shopifyVariantId === state.modal.variantId && item.bizflowProductId === product.id);
    if (existing) existing.qty = state.qty;
    else state.links.push({
      id: `local-shopify-link-${Date.now()}`,
      shopifyVariantId: state.modal.variantId,
      shopifyProductId: state.modal.productId,
      shopifySku: state.modal.sku,
      qty: state.qty,
      bizflowProductId: product.id,
      bizflowProductName: product.name
    });
    closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.modal) closeModal();
  });
}

function focusAtEnd(selector) {
  const input = document.querySelector(selector);
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

function currentLang() {
  return document.documentElement.lang === "fr" ? "fr" : document.documentElement.lang === "en" ? "en" : "zh";
}
