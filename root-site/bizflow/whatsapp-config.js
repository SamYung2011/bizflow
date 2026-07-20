import { WHATSAPP_MASK, promptPlaceholdersValid, whitelistKinds } from "./whatsapp-model.js";

function writeAttributes(liveReadOnly, disabled = false) {
  return ` data-wa-write${liveReadOnly || disabled ? ' disabled aria-disabled="true"' : ""}`;
}

function field({ e, label, value = "", field, type = "text", hint = "", disabled = false, liveReadOnly = false, min = null, max = null }) {
  const attributes = disabled ? " disabled" : writeAttributes(liveReadOnly);
  return `<label class="wa-field"><span>${e(label)}</span><input type="${type}" value="${e(value)}" data-wa-setting="${e(field)}"${attributes}${min === null ? "" : ` min="${e(min)}"`}${max === null ? "" : ` max="${e(max)}"`}>${hint ? `<small>${e(hint)}</small>` : ""}</label>`;
}

function textarea({ e, label, value, field, rows = 8, liveReadOnly = false }) {
  return `<label class="wa-field wa-field--textarea"><span>${e(label)}</span><textarea rows="${rows}" data-wa-setting="${e(field)}"${writeAttributes(liveReadOnly)}>${e(value || "")}</textarea></label>`;
}

function section(title, body, extraClass = "") {
  return `<section class="wa-panel ${extraClass}"><h2>${title}</h2>${body}</section>`;
}

function saveLabel(state, t) {
  return t(state.liveMode ? "saveLive" : "saveLocal");
}

function savedLabel(state, t) {
  return t(state.liveMode ? "savedLive" : "savedLocal");
}

function renderSettings(state, helpers, t) {
  const { escapeHtml: e } = helpers;
  const s = state.settings;
  const writable = { e, liveReadOnly: state.writeBlocked };
  const modes = [
    ["cli", "cliLocal"],
    ["api", "apiLocal"],
    ["api_cloud", "apiCloud"]
  ];
  const modePanel = section(e(t("aiMode")), `<div class="wa-choice-grid">${modes.map(([value, key]) => `<button type="button" class="wa-choice${s.claudeMode === value ? " is-active" : ""}" data-wa-mode="${value}" data-wa-write aria-pressed="${s.claudeMode === value}"${state.writeBlocked ? ' disabled aria-disabled="true"' : ""}><strong>${e(t(key))}</strong><small>${e(t(state.liveMode ? "liveChange" : "localChange"))}</small></button>`).join("")}</div>`);
  const clients = state.clients.length ? state.clients.map((client) => `<li><div><strong>${e(client.ua || t("unknown"))}</strong><span>${e(client.clientId || t("empty"))}</span></div><div><span>${e(t("version"))}: ${e(client.version || t("empty"))}</span><span>${e(t("lastSeen"))}: ${e(client.lastSeen || t("empty"))}</span></div></li>`).join("") : `<li class="wa-empty-row">${e(t("noClients"))}</li>`;
  const cloudPanel = section(e(t("cloudClients")), `<ul class="wa-client-list">${clients}</ul><div class="wa-button-row"><button type="button" class="wa-button" disabled title="${e(t("formalOnly"))}">${helpers.icon("icon-nav-cloud", "icon")}${e(t("downloadExtension"))}</button><button type="button" class="wa-button wa-button--secondary" data-wa-guide>${e(t("installGuide"))}</button></div>`);
  const apiPanel = section(e(t("apiConfig")), `<div class="wa-form-grid">${field({ e, label: t("baseUrl"), value: s.openaiBaseUrl, field: "openaiBaseUrl", disabled: true })}${field({ e, label: t("apiKey"), value: WHATSAPP_MASK, field: "apiKey", disabled: true, hint: t("secretHint") })}${field({ e, label: t("model"), value: s.model, field: "model", disabled: true })}</div><button type="button" class="wa-button wa-button--secondary" disabled title="${e(t("formalOnly"))}">${e(t("unlockEdit"))}</button>`);
  const runtimePanel = section(e(t("runtime")), `<div class="wa-form-grid">${field({ ...writable, label: t("botName"), value: s.botName, field: "botName" })}${field({ ...writable, label: t("botPhone"), value: s.botPhone, field: "botPhone" })}${field({ ...writable, label: t("specialChat"), value: s.bossChatName, field: "bossChatName" })}${field({ ...writable, label: t("replyDelay"), value: s.replyDelayBase, field: "replyDelayBase", type: "number", min: 0 })}${field({ ...writable, label: t("cooldown"), value: s.cooldownMinutes, field: "cooldownMinutes", type: "number", min: 0 })}${field({ ...writable, label: t("maxReplies"), value: s.maxRepliesPerMin, field: "maxRepliesPerMin", type: "number", min: 0 })}${field({ ...writable, label: t("reportHour"), value: s.dailyReportHour, field: "dailyReportHour", type: "number", min: 0, max: 23 })}</div><div class="wa-button-row"><button type="button" class="wa-button" data-wa-save="runtime"${writeAttributes(state.writeBlocked)}>${e(saveLabel(state, t))}</button>${state.savedSection === "runtime" ? `<span class="wa-saved">${e(savedLabel(state, t))}</span>` : ""}</div>`);
  return modePanel + cloudPanel + apiPanel + runtimePanel;
}

function renderMeta(state, helpers, t) {
  const { escapeHtml: e } = helpers;
  const s = state.settings;
  const writable = { e, liveReadOnly: state.writeBlocked };
  const connection = section(e(t("officialConnection")), `<div class="wa-form-grid">${field({ ...writable, label: t("graphVersion"), value: s.metaGraphVersion, field: "metaGraphVersion", hint: t("graphHint") })}${field({ ...writable, label: t("phoneNumberId"), value: s.metaPhoneNumberId, field: "metaPhoneNumberId", hint: t("phoneIdHint") })}${field({ ...writable, label: t("wabaId"), value: s.metaWabaId, field: "metaWabaId", hint: t("wabaHint") })}${field({ e, label: t("webhookPassword"), value: WHATSAPP_MASK, field: "webhookPassword", disabled: true, hint: t("webhookHint") })}</div><div class="wa-button-row"><button type="button" class="wa-button" data-wa-save="meta"${writeAttributes(state.writeBlocked)}>${e(saveLabel(state, t))}</button>${state.savedSection === "meta" ? `<span class="wa-saved">${e(savedLabel(state, t))}</span>` : ""}</div>`);
  const voice = section(e(t("tts")), `<label class="wa-toggle-row"><input type="checkbox" data-wa-setting="metaTtsEnabled"${s.metaTtsEnabled ? " checked" : ""}${writeAttributes(state.writeBlocked)}><span>${e(t("ttsEnabled"))}</span></label><div class="wa-form-grid">${field({ ...writable, label: t("relayUrl"), value: s.metaTtsRelayUrl, field: "metaTtsRelayUrl" })}${field({ ...writable, label: t("voiceId"), value: s.metaTtsVoiceId, field: "metaTtsVoiceId" })}${field({ ...writable, label: t("languageBoost"), value: s.metaTtsLanguageBoost, field: "metaTtsLanguageBoost" })}</div>${textarea({ ...writable, label: t("ttsPrompt"), value: s.metaTtsPrompt, field: "metaTtsPrompt", rows: 7 })}<div class="wa-button-row"><button type="button" class="wa-button" data-wa-save="tts"${writeAttributes(state.writeBlocked)}>${e(saveLabel(state, t))}</button>${state.savedSection === "tts" ? `<span class="wa-saved">${e(savedLabel(state, t))}</span>` : ""}</div>`);
  const secrets = [["metaToken", "meta-token"], ["appSecret", "app-secret"], ["relayToken", "relay-token"]].map(([label, id]) => `<div class="wa-secret-row"><div><strong>${e(t(label))}</strong><small>${e(t("secretHint"))}</small></div><code>${WHATSAPP_MASK}</code><button type="button" class="wa-button wa-button--secondary" disabled data-wa-secret="${id}" title="${e(t("formalOnly"))}">${e(t("viewOrReplace"))}</button></div>`).join("");
  return connection + voice + section(e(t("secretKeys")), secrets, "wa-panel--secrets");
}

function renderKnowledge(state, helpers, t) {
  const { escapeHtml: e } = helpers;
  const dirty = state.settings.knowledge !== state.savedKnowledge;
  return section(e(t("knowledgeTitle")), `<div class="wa-editor-meta"><span class="wa-dirty${dirty ? " is-dirty" : ""}" data-wa-knowledge-status>${e(t(dirty ? "unsaved" : "saved"))}</span><span data-wa-knowledge-count>${e(t("chars", { count: String(state.settings.knowledge || "").length }))}</span></div>${textarea({ e, liveReadOnly: state.writeBlocked, label: t("knowledgeTitle"), value: state.settings.knowledge, field: "knowledge", rows: 24 })}<div class="wa-button-row"><button type="button" class="wa-button wa-button--secondary" data-wa-knowledge-cancel${writeAttributes(state.writeBlocked, !dirty)}>${e(t("cancelChanges"))}</button><button type="button" class="wa-button" data-wa-save="knowledge"${writeAttributes(state.writeBlocked, !dirty)}>${e(saveLabel(state, t))}</button></div>`, "wa-panel--editor");
}

function renderChargerPrompt(state, helpers, t) {
  const { escapeHtml: e } = helpers;
  const valid = promptPlaceholdersValid(state.settings.locationHintPrompt);
  return section(e(t("chargerPromptTitle")), `${textarea({ e, liveReadOnly: state.writeBlocked, label: t("chargerPromptTitle"), value: state.settings.chargersPrompt, field: "chargersPrompt", rows: 12 })}${textarea({ e, liveReadOnly: state.writeBlocked, label: t("locationPromptTitle"), value: state.settings.locationHintPrompt, field: "locationHintPrompt", rows: 16 })}<p class="wa-validation${valid ? " is-valid" : " is-invalid"}" data-wa-prompt-validation>${e(t(valid ? "promptValid" : "placeholderMissing"))}</p><button type="button" class="wa-button" data-wa-save="prompts"${writeAttributes(state.writeBlocked, !valid)}>${e(saveLabel(state, t))}</button>`, "wa-panel--editor");
}

function renderBossPrompt(state, helpers, t) {
  const { escapeHtml: e } = helpers;
  return section(e(t("bossPrompt")), `<div class="wa-lock-card">${helpers.icon("icon-nav-cloud", "icon")}<strong>${e(t("encrypted", { count: state.settings.bossPromptChars || 0 }))}</strong><p>${e(t("lockedPromptHint"))}</p><button type="button" class="wa-button wa-button--secondary" disabled title="${e(t("formalOnly"))}">${e(t("unlock"))}</button></div>`);
}

function renderWhitelist(state, helpers, t) {
  const { escapeHtml: e } = helpers;
  const labels = { phone: "whitelistPhone", group: "whitelistGroup", group_fuzzy: "whitelistFuzzy", staff: "whitelistStaff" };
  return `<div class="wa-whitelist-grid">${whitelistKinds.map((kind) => {
    const rows = state.whitelist.filter((row) => row.kind === kind);
    const draft = state.whitelistDrafts[kind];
    return section(e(t(labels[kind])), `<ul class="wa-whitelist-list">${rows.map((row) => `<li><label class="wa-toggle-row"><input type="checkbox" data-wa-whitelist-toggle="${e(row.id)}"${row.active ? " checked" : ""}${writeAttributes(state.writeBlocked)}><span>${e(t("active"))}</span></label><div><strong>${e(row.value || t("empty"))}</strong><small>${e(row.note || t("empty"))}</small></div><button type="button" class="wa-icon-button" data-wa-whitelist-remove="${e(row.id)}" data-wa-write title="${e(t("remove"))}"${state.writeBlocked ? ' disabled aria-disabled="true"' : ""}>×</button></li>`).join("")}</ul><div class="wa-whitelist-add"><input value="${e(draft.value)}" data-wa-whitelist-draft="value" data-wa-whitelist-kind="${kind}" data-wa-write placeholder="${e(t("value"))}"${state.writeBlocked ? ' disabled aria-disabled="true"' : ""}><input value="${e(draft.note)}" data-wa-whitelist-draft="note" data-wa-whitelist-kind="${kind}" data-wa-write placeholder="${e(t("note"))}"${state.writeBlocked ? ' disabled aria-disabled="true"' : ""}><button type="button" class="wa-button" data-wa-whitelist-add="${kind}"${writeAttributes(state.writeBlocked, !draft.value.trim())}>${e(t("add"))}</button></div>`);
  }).join("")}</div>`;
}

export function renderWhatsappConfig(tab, state, helpers, t) {
  if (tab === "settings") return renderSettings(state, helpers, t);
  if (tab === "meta") return renderMeta(state, helpers, t);
  if (tab === "knowledge") return renderKnowledge(state, helpers, t);
  if (tab === "chargerPrompt") return renderChargerPrompt(state, helpers, t);
  if (tab === "bossPrompt") return renderBossPrompt(state, helpers, t);
  if (tab === "whitelist") return renderWhitelist(state, helpers, t);
  return "";
}

export function renderWhatsappGuide(state, helpers, t) {
  if (!state.guideOpen) return "";
  const { escapeHtml: e } = helpers;
  return `<div class="wa-overlay" data-wa-guide-overlay><section class="wa-modal" role="dialog" aria-modal="true" aria-label="${e(t("installTitle"))}"><header><h2>${e(t("installTitle"))}</h2><button type="button" class="wa-icon-button" data-wa-guide-close title="${e(t("close"))}">×</button></header><ol><li>${e(t("installOne"))}</li><li>${e(t("installTwo"))}</li><li>${e(t("installThree"))}</li></ol><footer><button type="button" class="wa-button" data-wa-guide-close>${e(t("close"))}</button></footer></section></div>`;
}
