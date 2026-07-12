import { navigationPresetKeys, setNavigationPreset } from "../components/navigation-presets.js";

const state = {
  query: "",
  open: false,
  loading: false,
  datasets: null,
  loadPromise: null
};

let viewHelpers = null;
let attached = false;
// Guards against refresh()'s own input.focus() re-entering the focusin handler,
// which would recurse refresh→focus→focusin→refresh into a stack overflow.
let programmaticFocus = false;

function searchable(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function ensureSearchData() {
  if (state.datasets) return Promise.resolve(state.datasets);
  if (state.loadPromise) return state.loadPromise;
  state.loading = true;
  // Keep provider external to the classic shell demo bundle; application pages
  // and previews still share the same provider module cache at runtime.
  const providerPath = "../data/provider.js";
  state.loadPromise = import(providerPath).then(({ getGlobalSearchData }) => getGlobalSearchData()).catch(() => {
    console.warn("[provider] global-search provider invalid → fallback empty search index");
    return { customers: null, products: null, invoices: null };
  }).then((datasets) => {
    state.datasets = datasets;
    state.loading = false;
    return state.datasets;
  });
  return state.loadPromise;
}

function searchResults() {
  const query = searchable(state.query);
  const datasets = state.datasets ?? {};
  const customers = Array.isArray(datasets.customers)
    ? datasets.customers.filter((customer) => [customer.name, customer.phone, customer.detail?.email, customer.detail?.carModel]
      .some((value) => searchable(value).includes(query)))
    : null;
  const products = Array.isArray(datasets.products)
    ? datasets.products.filter((product) => searchable(product.name).includes(query))
    : null;
  const invoices = Array.isArray(datasets.invoices)
    ? datasets.invoices.filter((order) => [order.detail?.orderNo, order.customer]
      .some((value) => searchable(value).includes(query)))
    : null;
  return { customers, products, invoices };
}

function resultMeta(kind, item) {
  if (kind === "customers") return [item.phone, item.detail?.email || item.detail?.carModel].filter(Boolean).join(" · ");
  if (kind === "products") return item.parentId ? item.detail?.productId || "" : item.category || "";
  return [item.customer, item.date].filter(Boolean).join(" · ");
}

function resultTitle(kind, item) {
  if (kind === "customers") return item.name;
  if (kind === "products") return item.name;
  return item.detail?.orderNo || item.customer;
}

function renderSection(kind, items, helpers) {
  if (!items) return "";
  const { escapeHtml, t } = helpers;
  if (!items.length) return "";
  return `<section class="shell-search-section">
    <h2><span>${escapeHtml(t(`shell.search.${kind}`))}</span><strong>${items.length}</strong></h2>
    <div>${items.slice(0, 5).map((item, index) => `<button type="button" class="shell-search-result" data-shell-search-result data-search-kind="${kind}" data-search-id="${escapeHtml(item.id || String(index))}">
      <span title="${escapeHtml(resultTitle(kind, item))}">${escapeHtml(resultTitle(kind, item))}</span>
      <small title="${escapeHtml(resultMeta(kind, item))}">${escapeHtml(resultMeta(kind, item))}</small>
    </button>`).join("")}</div>
  </section>`;
}

function renderPopover(helpers) {
  if (!state.open || !state.query.trim()) return "";
  const { escapeHtml, t } = helpers;
  if (state.loading) return `<div class="shell-search-popover is-open" data-shell-search-popover><p class="shell-search-empty">${escapeHtml(t("shell.search.loading"))}</p></div>`;
  const results = searchResults();
  const content = ["customers", "products", "invoices"].map((kind) => renderSection(kind, results[kind], helpers)).join("");
  return `<div class="shell-search-popover is-open" data-shell-search-popover>${content || `<p class="shell-search-empty">${escapeHtml(t("shell.search.empty"))}</p>`}</div>`;
}

export function renderGlobalSearch(helpers) {
  viewHelpers = helpers;
  const { escapeHtml, icon, t } = helpers;
  const label = t("shell.search");
  return `<div class="shell-global-search shell-topbar__search" data-shell-search-root>
    <label class="tp-component search-input${state.open ? " search-input--focus" : ""}" style="--component-width:320px;--component-height:40px">
      ${icon("icon-nav-search")}
      <input type="search" data-shell-search-input value="${escapeHtml(state.query)}" placeholder="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" autocomplete="off">
    </label>
    ${renderPopover(helpers)}
  </div>`;
}

function refresh(root, focus = false) {
  const search = root.querySelector("[data-shell-search-root]");
  if (!search || !viewHelpers) return;
  search.outerHTML = renderGlobalSearch(viewHelpers);
  if (!focus) return;
  const input = root.querySelector("[data-shell-search-input]");
  if (!input) return;
  programmaticFocus = true;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  programmaticFocus = false;
}

function navigateResult(result) {
  const kind = result.getAttribute("data-search-kind");
  const id = result.getAttribute("data-search-id");
  if (kind === "customers") {
    window.location.href = `../bizflow/customer-detail.html?id=${encodeURIComponent(id)}`;
    return;
  }
  if (kind === "products") {
    setNavigationPreset(navigationPresetKeys.inventorySearch, state.query);
    window.location.href = "../bizflow/inventory.html";
    return;
  }
  if (kind === "invoices") {
    setNavigationPreset(navigationPresetKeys.ordersSearch, state.query);
    window.location.href = "../bizflow/orders.html";
  }
}

export function attachGlobalSearch(root) {
  if (attached) return;
  attached = true;

  document.addEventListener("input", (event) => {
    const input = event.target.closest("[data-shell-search-input]");
    if (!input) return;
    state.query = input.value;
    state.open = Boolean(state.query.trim());
    if (!state.open) {
      refresh(root, true);
      return;
    }
    const loading = ensureSearchData();
    refresh(root, true);
    loading.then(() => refresh(root, true));
  });

  document.addEventListener("focusin", (event) => {
    if (programmaticFocus) return;
    if (!event.target.closest("[data-shell-search-input]") || !state.query.trim()) return;
    state.open = true;
    refresh(root, true);
  });

  document.addEventListener("click", (event) => {
    const result = event.target.closest("[data-shell-search-result]");
    if (result) {
      navigateResult(result);
      return;
    }
    if (event.target.closest("[data-shell-search-root]")) return;
    if (state.open) {
      state.open = false;
      refresh(root);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.open) return;
    state.open = false;
    refresh(root, true);
  });
}
