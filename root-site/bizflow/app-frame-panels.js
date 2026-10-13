const frames = {
  support: ["appSupport", "supportTab"], northbound: ["appNorthbound", "northboundTab"],
  insurance: ["appInsurance", "insuranceTab"], offers: ["appOffers", "offersTab"],
  knowledge: ["appKnowledge", "knowledgeTab"]
};
const observed = new WeakSet();

export function renderAppFramePanel(tab, lang, t, escapeHtml) {
  const entry = frames[tab];
  if (!entry) return "";
  return `<div data-app-frame-panel="${tab}"><iframe class="app-support-frame" title="${escapeHtml(t(entry[1]))}" src="/task-platform/?view=${entry[0]}&embed=1&lang=${encodeURIComponent(lang)}" data-${tab}-frame></iframe></div>`;
}

export function syncAppFramePanels(page, activeTab, lang, t, escapeHtml) {
  const container = page?.querySelector("[data-app-frame-panels]");
  if (!container) return;
  if (frames[activeTab] && !container.querySelector(`[data-app-frame-panel="${activeTab}"]`)) {
    container.insertAdjacentHTML("beforeend", renderAppFramePanel(activeTab, lang, t, escapeHtml));
  }
  for (const panel of container.querySelectorAll("[data-app-frame-panel]")) {
    panel.hidden = panel.dataset.appFramePanel !== activeTab;
    const frame = panel.querySelector("iframe");
    const notify = () => frame.contentWindow?.postMessage({ type: "bizflow-app-visibility", visible: !panel.hidden }, window.location.origin);
    if (!observed.has(frame)) { observed.add(frame); frame.addEventListener("load", notify); }
    notify();
  }
}
