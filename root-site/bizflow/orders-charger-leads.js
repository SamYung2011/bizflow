import { getChargerLeadsData } from "../data/provider.js";

const copy = {
  zh: {
    title: "充電樁意向",
    registration: "意向登記",
    visit: "上門估價",
    all: "全部",
    pending: "待安排上門",
    arranged: "已安排上門",
    measuring: "測量中",
    completed: "測量完成",
    interested: "有意向",
    installService: "安裝服務",
    vehicle: "車型",
    accessories: "配件",
    address: "地址",
    quotedFee: "安裝費報價",
    referral: "推薦人",
    submittedAt: "提交時間",
    pendingMerge: "疑似老客戶待合併",
    search: "搜尋客戶 / 電話 / 地址",
    emptyRegistration: "暫無充電樁意向登記",
    emptyVisit: "暫無上門估價記錄"
  },
  en: {
    title: "Charger interest",
    registration: "Interest registrations",
    visit: "On-site quotations",
    all: "All",
    pending: "Awaiting visit",
    arranged: "Visit arranged",
    measuring: "Measuring",
    completed: "Measurement complete",
    interested: "Interested",
    installService: "Installation service",
    vehicle: "Vehicle",
    accessories: "Accessories",
    address: "Address",
    quotedFee: "Installation quote",
    referral: "Referral",
    submittedAt: "Submitted",
    pendingMerge: "Possible existing customer · merge pending",
    search: "Search customer / phone / address",
    emptyRegistration: "No charger interest registrations",
    emptyVisit: "No on-site quotation records"
  },
  fr: {
    title: "Intérêt pour les bornes",
    registration: "Demandes d'intérêt",
    visit: "Devis sur place",
    all: "Tous",
    pending: "Visite à planifier",
    arranged: "Visite planifiée",
    measuring: "Mesure en cours",
    completed: "Mesure terminée",
    interested: "Intéressé",
    installService: "Service d’installation",
    vehicle: "Véhicule",
    accessories: "Accessoires",
    address: "Adresse",
    quotedFee: "Devis d’installation",
    referral: "Recommandation",
    submittedAt: "Soumis le",
    pendingMerge: "Client existant possible · fusion en attente",
    search: "Rechercher client / téléphone / adresse",
    emptyRegistration: "Aucune demande d'intérêt",
    emptyVisit: "Aucun devis sur place"
  }
};

export const chargerLeadDictionaries = copy;

const state = { loaded: false, loading: false, leads: [], tab: "registration", status: "all", search: "" };
let rerender = () => {};
let dataLoadVersion = 0;

function t(lang, key) {
  return copy[lang]?.[key] ?? copy.zh[key] ?? key;
}

export function chargerLeadTab(lead) {
  const status = String(lead.status ?? "").toLocaleLowerCase();
  if (status === "interested") return "registration";
  if (["pending_visit", "visit_scheduled", "measuring", "measured"].includes(status)) return "visit";
  const raw = String(lead.tab ?? lead.type ?? lead.leadType ?? lead.category ?? lead.flow ?? "").toLocaleLowerCase();
  if (["visit", "onsite", "quotation", "上門估價", "上门估价"].some((value) => raw.includes(value))) return "visit";
  if (["registration", "interest", "意向登記", "意向登记"].some((value) => raw.includes(value))) return "registration";
  return lead.status ? "visit" : "registration";
}

export function chargerLeadStatus(lead) {
  const raw = String(lead.status ?? "").toLocaleLowerCase();
  if (["pending", "pending_visit", "待安排上門", "待安排上门"].includes(raw)) return "pending";
  if (["arranged", "visit_scheduled", "已安排上門", "已安排上门"].includes(raw)) return "arranged";
  if (["measuring", "測量中", "测量中"].includes(raw)) return "measuring";
  if (["completed", "measured", "測量完成", "测量完成"].includes(raw)) return "completed";
  return raw;
}

function leadsForTab() {
  return state.leads.filter((lead) => chargerLeadTab(lead) === state.tab);
}

function statusCounts() {
  const counts = { all: 0, pending: 0, arranged: 0, measuring: 0, completed: 0 };
  for (const lead of leadsForTab()) {
    counts.all += 1;
    const status = chargerLeadStatus(lead);
    if (status in counts) counts[status] += 1;
  }
  return counts;
}

export async function ensureChargerLeadsData({ scope = null, signal = scope?.signal } = {}) {
  if (state.loaded || state.loading) return;
  const version = dataLoadVersion;
  state.loading = true;
  rerender();
  const data = await getChargerLeadsData();
  if (version !== dataLoadVersion || signal?.aborted || (scope && !scope.isCurrent())) return;
  state.leads = data.leads;
  state.loading = false;
  state.loaded = true;
}

function filteredLeads() {
  const query = state.search.trim().toLocaleLowerCase();
  return leadsForTab().filter((lead) => {
    if (state.status !== "all" && chargerLeadStatus(lead) !== state.status) return false;
    if (!query) return true;
    return [lead.customer, lead.name, lead.phone, lead.phone_mainland, lead.address, lead.charger_model, ...(Array.isArray(lead.selected_products) ? lead.selected_products : [])]
      .some((value) => String(value || "").toLocaleLowerCase().includes(query));
  });
}

export function renderChargerLeadCards(leads, helpers) {
  if (!leads.length) return "";
  const { escapeHtml: e, lang } = helpers;
  return leads.map((lead) => {
    const status = chargerLeadStatus(lead);
    const phone = [lead.phone, lead.phone_mainland].map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
    const vehicle = [lead.car_make, lead.car_model].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
    const products = Array.isArray(lead.selected_products) ? lead.selected_products.filter(Boolean) : [];
    const quotedFee = lead.quoted_fee == null || lead.quoted_fee === "" ? "" : `HK$ ${Number(lead.quoted_fee).toLocaleString("en-HK")}`;
    const submittedAt = String(lead.created_at || "").slice(0, 16).replace("T", " ");
    return `<article class="charger-lead-card" data-charger-lead data-charger-lead-tab-value="${chargerLeadTab(lead)}" data-charger-lead-status-value="${e(status)}">
      <div class="charger-lead-card__head">
        <strong>${e(lead.customer || lead.name || "—")}</strong>
        ${phone ? `<span>${e(phone)}</span>` : ""}
        ${status ? `<span class="charger-lead-card__status">${e(t(lang, status))}</span>` : ""}
        ${lead.pending_merge_cid ? `<span class="charger-lead-card__merge">${e(t(lang, "pendingMerge"))}</span>` : ""}
      </div>
      <div class="charger-lead-card__facts">
        ${lead.charger_model ? `<span class="charger-lead-card__model">${e(lead.charger_model)}</span>` : ""}
        ${lead.install_service ? `<span><b>${e(t(lang, "installService"))}</b> ${e(lead.install_service)}</span>` : ""}
        ${vehicle ? `<span><b>${e(t(lang, "vehicle"))}</b> ${e(vehicle)}</span>` : ""}
      </div>
      ${products.length ? `<div class="charger-lead-card__tags" aria-label="${e(t(lang, "accessories"))}">${products.map((product) => `<span>${e(product)}</span>`).join("")}</div>` : ""}
      ${lead.address ? `<p class="charger-lead-card__address"><b>${e(t(lang, "address"))}</b> ${e(lead.address)}</p>` : ""}
      ${quotedFee ? `<strong class="charger-lead-card__quote">${e(t(lang, "quotedFee"))}：${e(quotedFee)}</strong>` : ""}
      <div class="charger-lead-card__foot">
        ${submittedAt ? `<span><b>${e(t(lang, "submittedAt"))}</b> ${e(submittedAt)}</span>` : ""}
        ${lead.referral ? `<span><b>${e(t(lang, "referral"))}</b> ${e(lead.referral)}</span>` : ""}
      </div>
    </article>`;
  }).join("");
}

export function renderChargerLeads(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const leads = filteredLeads();
  const statuses = ["all", "pending", "arranged", "measuring", "completed"];
  const counts = statusCounts();
  return `<section class="orders-domain-panel charger-leads-page" data-charger-leads-page data-charger-tab="${state.tab}" data-charger-filtered="${leads.length}">
    <header class="orders-domain-panel__head"><div><h2>${escapeHtml(t(lang, "title"))}</h2></div></header>
    <div class="charger-lead-tabs" role="tablist">
      ${["registration", "visit"].map((tab) => `<button type="button" role="tab" aria-selected="${state.tab === tab}" class="charger-lead-tab${state.tab === tab ? " is-active" : ""}" data-charger-lead-tab="${tab}">${escapeHtml(t(lang, tab))}</button>`).join("")}
    </div>
    ${state.tab === "visit" ? `<div class="charger-status-chips">${statuses.map((status) => `<button type="button" class="charger-status-chip${state.status === status ? " is-active" : ""}" data-charger-status="${status}">${escapeHtml(t(lang, status))} <span>${escapeHtml(String(counts[status]))}</span></button>`).join("")}</div>` : ""}
    <label class="charger-lead-search">${icon("icon-nav-search", "icon")}<input type="search" data-charger-lead-search value="${escapeHtml(state.search)}" placeholder="${escapeHtml(t(lang, "search"))}"></label>
    <div class="charger-lead-list">
      ${renderChargerLeadCards(leads, helpers)}
      ${!state.loading && !leads.length ? `<div class="orders-domain-empty">${icon("icon-nav-inventory", "icon")}<span>${escapeHtml(t(lang, state.tab === "visit" ? "emptyVisit" : "emptyRegistration"))}</span></div>` : ""}
    </div>
  </section>`;
}

export function attachChargerLeadBehaviors({ rerender: nextRerender, scope }) {
  rerender = nextRerender;
  scope.listen(document, "click", (event) => {
    const tab = event.target.closest("[data-charger-lead-tab]");
    if (tab) {
      state.tab = tab.getAttribute("data-charger-lead-tab");
      state.status = "all";
      rerender();
      return;
    }
    const status = event.target.closest("[data-charger-status]");
    if (status) {
      state.status = status.getAttribute("data-charger-status");
      rerender();
    }
  });
  scope.listen(document, "input", (event) => {
    const input = event.target.closest("[data-charger-lead-search]");
    if (!input) return;
    state.search = input.value;
    rerender();
    scope.animationFrame(() => {
      const next = document.querySelector("[data-charger-lead-search]");
      next?.focus();
      next?.setSelectionRange(next.value.length, next.value.length);
    });
  });
}

export function captureChargerLeadState() {
  return { tab: state.tab, status: state.status, search: state.search };
}

export function restoreChargerLeadState(value = null) {
  const next = value && typeof value === "object" ? value : {};
  state.tab = ["registration", "visit"].includes(next.tab) ? next.tab : "registration";
  state.status = ["all", "pending", "arranged", "measuring", "completed"].includes(next.status) ? next.status : "all";
  state.search = typeof next.search === "string" ? next.search : "";
}

export function disposeChargerLeadState() {
  dataLoadVersion += 1;
  state.loaded = false;
  state.loading = false;
  state.leads = [];
  rerender = () => {};
}
