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
    search: "Rechercher client / téléphone / adresse",
    emptyRegistration: "Aucune demande d'intérêt",
    emptyVisit: "Aucun devis sur place"
  }
};

const state = { loaded: false, loading: false, leads: [], tab: "registration", status: "all", search: "" };
let rerender = () => {};
let attached = false;

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

export async function ensureChargerLeadsData() {
  if (state.loaded || state.loading) return;
  state.loading = true;
  rerender();
  const data = await getChargerLeadsData();
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

function renderLeadCards(leads, helpers) {
  if (!leads.length) return "";
  return leads.map((lead) => `<article class="charger-lead-card" data-charger-lead data-charger-lead-tab-value="${chargerLeadTab(lead)}" data-charger-lead-status-value="${helpers.escapeHtml(chargerLeadStatus(lead))}">
    <strong>${helpers.escapeHtml(lead.customer || lead.name || "—")}</strong>
    <span>${helpers.escapeHtml(lead.phone || "—")}</span>
    <span>${helpers.escapeHtml(lead.address || "—")}</span>
    ${state.tab === "visit" && chargerLeadStatus(lead) ? `<span class="charger-lead-card__status">${helpers.escapeHtml(t(helpers.lang, chargerLeadStatus(lead)))}</span>` : ""}
  </article>`).join("");
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
      ${renderLeadCards(leads, helpers)}
      ${!state.loading && !leads.length ? `<div class="orders-domain-empty">${icon("icon-nav-inventory", "icon")}<span>${escapeHtml(t(lang, state.tab === "visit" ? "emptyVisit" : "emptyRegistration"))}</span></div>` : ""}
    </div>
  </section>`;
}

export function attachChargerLeadBehaviors({ rerender: nextRerender }) {
  rerender = nextRerender;
  if (attached) return;
  attached = true;
  document.addEventListener("click", (event) => {
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
  document.addEventListener("input", (event) => {
    const input = event.target.closest("[data-charger-lead-search]");
    if (!input) return;
    state.search = input.value;
    rerender();
    requestAnimationFrame(() => {
      const next = document.querySelector("[data-charger-lead-search]");
      next?.focus();
      next?.setSelectionRange(next.value.length, next.value.length);
    });
  });
}
