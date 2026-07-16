import { getCurrentUser, getUnread, getWhatsappData } from "../data/provider.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { createDateFilter, latestDateInput } from "../components/date-filter.js";
import { renderSegment } from "../components/segment.js";
import { renderWhatsappActivity } from "./whatsapp-activity.js";
import { renderWhatsappConfig, renderWhatsappGuide } from "./whatsapp-config.js";
import { translateWhatsapp } from "./whatsapp-i18n.js";
import { channelOf, dateOnly, nextLocalId, promptPlaceholdersValid, whatsappTabs, whitelistKinds } from "./whatsapp-model.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";

let snapshot = null;
let currentUser = null;
let unread = null;
let liveReadOnly = false;
// P1 接真写时按现网 isWaAdmin 门控（bizflow_samyung/src/views/Whatsapp.jsx:53-55,130-132）；当前 live 一律只读。

const blankWhitelistDrafts = () => Object.fromEntries(whitelistKinds.map((kind) => [kind, { value: "", note: "" }]));
let state = null;
let currentHelpers = null;
let conversationDateFilter = null;
let logDateFilter = null;

function initializeWhatsappState(historyState = null) {
  const restored = historyState && typeof historyState === "object" ? historyState : {};
  const settings = { ...snapshot.settings };
  state = {
    liveReadOnly,
    tab: whatsappTabs.includes(restored.tab) ? restored.tab : "settings",
    settings,
    savedSettings: { ...settings },
    savedKnowledge: settings.knowledge || "",
    savedPrompts: {
      chargersPrompt: settings.chargersPrompt || "",
      locationHintPrompt: settings.locationHintPrompt || ""
    },
    clients: snapshot.clients,
    heartbeat: snapshot.heartbeat,
    generatedAt: snapshot.generatedAt,
    whitelist: snapshot.whitelist.map((row) => ({ ...row })),
    initialWhitelist: snapshot.whitelist.map((row) => ({ ...row })),
    whitelistDrafts: blankWhitelistDrafts(),
    messages: snapshot.messages,
    replies: snapshot.replies,
    unresolved: snapshot.unresolved,
    dailyReports: snapshot.dailyReports,
    logs: snapshot.logs,
    conversationChannel: ["all", "extension", "meta"].includes(restored.conversationChannel) ? restored.conversationChannel : "all",
    selectedCustomer: typeof restored.selectedCustomer === "string" ? restored.selectedCustomer : null,
    logChannel: ["all", "extension", "meta"].includes(restored.logChannel) ? restored.logChannel : "all",
    logCategory: typeof restored.logCategory === "string" ? restored.logCategory : "all",
    logLimit: Number.isInteger(restored.logLimit) && restored.logLimit >= 50 ? restored.logLimit : 50,
    skippedReplyIds: new Set(),
    resolvedIds: new Set(),
    guideOpen: false,
    savedSection: ""
  };

  conversationDateFilter = createDateFilter({
    id: "whatsapp-conversations",
    initialDate: latestDateInput(state.messages.map((row) => dateOnly(row.time))),
    onChange: ({ filterChanged }) => {
      if (filterChanged) state.selectedCustomer = null;
      rerender();
    }
  });
  logDateFilter = createDateFilter({
    id: "whatsapp-logs",
    initialDate: latestDateInput(state.logs.map((row) => dateOnly(row.time))),
    onChange: ({ filterChanged }) => {
      if (filterChanged) state.logLimit = 50;
      rerender();
    }
  });
  conversationDateFilter.restoreState(restored.conversationDateFilter);
  logDateFilter.restoreState(restored.logDateFilter);
}

// Mirrors bizflow_samyung/src/views/Whatsapp.jsx:225.
function unresolvedCount() {
  return state.unresolved.filter((row) => !row.resolvedAt && !state.resolvedIds.has(String(row.id))).length;
}

function t(key, values = {}) {
  return translateWhatsapp(currentHelpers?.lang || "zh", key, values);
}

function tabItems() {
  return whatsappTabs.map((key) => ({
    key,
    label: t(key),
    badge: key === "replies" ? state.replies.filter((row) => !row.deliveredAt && !state.skippedReplyIds.has(String(row.id))).length || null
      : key === "unresolved" ? unresolvedCount() || null
        : null
  }));
}

function heartbeatTime(value) {
  const raw = String(value || "").trim().replaceAll("/", "-").replace(" ", "T");
  if (!raw) return Number.NaN;
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}+08:00`;
  return Date.parse(zoned);
}

function renderHeader(helpers) {
  const e = helpers.escapeHtml;
  const customerCount = new Set(state.messages.filter((row) => row.customerId)
    .map((row) => `${channelOf(row)}:${row.customerId}`)).size;
  const openUnresolved = unresolvedCount();
  const heartbeatAt = heartbeatTime(state.heartbeat.lastHeartbeatAt);
  // Mirrors bizflow_samyung/src/views/Whatsapp.jsx:113-116.
  const heartbeatStatus = !Number.isFinite(heartbeatAt)
    ? "never"
    : Date.now() - heartbeatAt >= 120000
      ? "offline"
      : state.heartbeat.status || t("unknown");
  return `<header class="wa-head"><div><h1>${e(t("title"))}</h1><p>${e(t("subtitle"))}</p></div><div class="wa-status" title="${e(state.heartbeat.errorMessage || "")}"><span class="wa-status__dot"></span><div><strong>${e(t("snapshotStatus"))}: ${e(heartbeatStatus)}</strong><small>${e(t("snapshotAt"))}: ${e(state.heartbeat.lastHeartbeatAt || state.generatedAt || t("empty"))}</small></div></div></header><div class="wa-stats" data-wa-mode="${e(state.settings.claudeMode || "")}" data-wa-customers="${customerCount}" data-wa-messages="${state.messages.length}" data-wa-unresolved="${openUnresolved}"><span>${e(t("mode"))}<strong>${e(state.settings.claudeMode || t("unknown"))}</strong></span><span>${e(t("customers"))}<strong>${customerCount}</strong></span><span>${e(t("messages"))}<strong>${state.messages.length}</strong></span><span>${e(t("unresolved"))}<strong>${openUnresolved}</strong></span></div>`;
}

export function renderWhatsapp(helpers) {
  currentHelpers = helpers;
  const segment = renderSegment({
    items: tabItems(),
    active: state.tab,
    ariaLabel: t("title"),
    escapeHtml: helpers.escapeHtml,
    dataAttribute: "data-wa-tab"
  });
  const body = renderWhatsappConfig(state.tab, state, helpers, t) || renderWhatsappActivity(state.tab, state, helpers, t, {
    conversations: conversationDateFilter,
    logs: logDateFilter
  });
  return `<main class="wa-page" data-wa-page data-live-read-only="${liveReadOnly}" data-wa-active-tab="${helpers.escapeHtml(state.tab)}" data-wa-admin="true">${renderHeader(helpers)}<div class="wa-segment">${segment}</div><div class="wa-content">${body}</div>${renderWhatsappGuide(state, helpers, t)}</main>`;
}

function rerender() {
  const page = document.querySelector("[data-wa-page]");
  if (page && currentHelpers) page.outerHTML = renderWhatsapp(currentHelpers);
}

function closeGuide() {
  if (!state.guideOpen) return;
  state.guideOpen = false;
  rerender();
}

function updateKnowledgeMeta() {
  const dirty = state.settings.knowledge !== state.savedKnowledge;
  const status = document.querySelector("[data-wa-knowledge-status]");
  const count = document.querySelector("[data-wa-knowledge-count]");
  const cancel = document.querySelector("[data-wa-knowledge-cancel]");
  const save = document.querySelector('[data-wa-save="knowledge"]');
  if (status) {
    status.textContent = t(dirty ? "unsaved" : "saved");
    status.classList.toggle("is-dirty", dirty);
  }
  if (count) count.textContent = t("chars", { count: String(state.settings.knowledge || "").length });
  if (cancel) cancel.disabled = liveReadOnly || !dirty;
  if (save) save.disabled = liveReadOnly || !dirty;
}

function updatePromptValidation() {
  const valid = promptPlaceholdersValid(state.settings.locationHintPrompt);
  const validation = document.querySelector("[data-wa-prompt-validation]");
  const save = document.querySelector('[data-wa-save="prompts"]');
  if (validation) {
    validation.textContent = t(valid ? "promptValid" : "placeholderMissing");
    validation.classList.toggle("is-valid", valid);
    validation.classList.toggle("is-invalid", !valid);
  }
  if (save) save.disabled = liveReadOnly || !valid;
}

function handleDateFilterClick(event) {
  const root = event.target.closest?.("[data-date-filter]");
  if (!root) {
    conversationDateFilter.close();
    logDateFilter.close();
    return false;
  }
  const id = root.getAttribute("data-date-filter");
  if (id === "whatsapp-conversations") {
    logDateFilter.close();
    return conversationDateFilter.handleClick(event);
  }
  if (id === "whatsapp-logs") {
    conversationDateFilter.close();
    return logDateFilter.handleClick(event);
  }
  return false;
}

function onWhatsappClick(event) {
  if (handleDateFilterClick(event)) return;
  if (liveReadOnly && event.target.closest("[data-wa-write]")) return;

  const tab = event.target.closest("[data-wa-tab]");
  if (tab) {
    const key = tab.getAttribute("data-wa-tab");
    if (whatsappTabs.includes(key)) state.tab = key;
    state.savedSection = "";
    rerender();
    return;
  }
  if (event.target.closest("[data-wa-guide]")) {
    state.guideOpen = true;
    rerender();
    return;
  }
  if (event.target.closest("[data-wa-guide-close]") || event.target.matches("[data-wa-guide-overlay]")) {
    closeGuide();
    return;
  }
  const mode = event.target.closest("[data-wa-mode]");
  if (mode && mode.tagName === "BUTTON") {
    state.settings.claudeMode = mode.getAttribute("data-wa-mode");
    rerender();
    return;
  }
  const save = event.target.closest("[data-wa-save]");
  if (save && !save.disabled) {
    const section = save.getAttribute("data-wa-save");
    if (section === "knowledge") state.savedKnowledge = state.settings.knowledge;
    if (section === "prompts") state.savedPrompts = {
      chargersPrompt: state.settings.chargersPrompt,
      locationHintPrompt: state.settings.locationHintPrompt
    };
    state.savedSettings = { ...state.settings };
    state.savedSection = section;
    rerender();
    return;
  }
  if (event.target.closest("[data-wa-knowledge-cancel]")) {
    state.settings.knowledge = state.savedKnowledge;
    rerender();
    return;
  }
  const remove = event.target.closest("[data-wa-whitelist-remove]");
  if (remove) {
    const id = remove.getAttribute("data-wa-whitelist-remove");
    state.whitelist = state.whitelist.filter((row) => String(row.id) !== id);
    rerender();
    return;
  }
  const add = event.target.closest("[data-wa-whitelist-add]");
  if (add && !add.disabled) {
    const kind = add.getAttribute("data-wa-whitelist-add");
    const draft = state.whitelistDrafts[kind];
    state.whitelist.push({ id: nextLocalId("wa-allow"), kind, value: draft.value.trim(), note: draft.note.trim(), active: true });
    state.whitelistDrafts[kind] = { value: "", note: "" };
    rerender();
    return;
  }
  const conversationChannel = event.target.closest("[data-wa-conversation-channel]");
  if (conversationChannel) {
    state.conversationChannel = conversationChannel.getAttribute("data-wa-conversation-channel");
    state.selectedCustomer = null;
    rerender();
    return;
  }
  const conversation = event.target.closest("[data-wa-conversation]");
  if (conversation) {
    state.selectedCustomer = conversation.getAttribute("data-wa-conversation");
    rerender();
    return;
  }
  const replySkip = event.target.closest("[data-wa-reply-skip]");
  if (replySkip) {
    state.skippedReplyIds.add(replySkip.getAttribute("data-wa-reply-skip"));
    rerender();
    return;
  }
  const resolve = event.target.closest("[data-wa-resolve]");
  if (resolve) {
    state.resolvedIds.add(resolve.getAttribute("data-wa-resolve"));
    rerender();
    return;
  }
  const logChannel = event.target.closest("[data-wa-log-channel]");
  if (logChannel) {
    state.logChannel = logChannel.getAttribute("data-wa-log-channel");
    state.logLimit = 50;
    rerender();
    return;
  }
  const logCategory = event.target.closest("[data-wa-log-category]");
  if (logCategory) {
    state.logCategory = logCategory.getAttribute("data-wa-log-category");
    state.logLimit = 50;
    rerender();
    return;
  }
  if (event.target.closest("[data-wa-log-more]")) {
    state.logLimit += 50;
    rerender();
  }
}

function onWhatsappInput(event) {
  if (liveReadOnly && event.target.closest("[data-wa-write]")) return;
  const setting = event.target.closest("[data-wa-setting]");
  if (setting && setting.type !== "checkbox") {
    const key = setting.getAttribute("data-wa-setting");
    state.settings[key] = setting.value;
    state.savedSection = "";
    if (key === "knowledge") updateKnowledgeMeta();
    if (key === "locationHintPrompt") updatePromptValidation();
  }
  const draft = event.target.closest("[data-wa-whitelist-draft]");
  if (draft) {
    const kind = draft.getAttribute("data-wa-whitelist-kind");
    const key = draft.getAttribute("data-wa-whitelist-draft");
    state.whitelistDrafts[kind][key] = draft.value;
    const button = document.querySelector(`[data-wa-whitelist-add="${kind}"]`);
    if (button) button.disabled = liveReadOnly || !state.whitelistDrafts[kind].value.trim();
  }
}

function onWhatsappChange(event) {
  if (liveReadOnly && event.target.closest("[data-wa-write]")) return;
  const setting = event.target.closest("[data-wa-setting]");
  if (setting?.type === "checkbox") {
    state.settings[setting.getAttribute("data-wa-setting")] = setting.checked;
    state.savedSection = "";
  }
  const toggle = event.target.closest("[data-wa-whitelist-toggle]");
  if (toggle) {
    const row = state.whitelist.find((item) => String(item.id) === toggle.getAttribute("data-wa-whitelist-toggle"));
    if (row) row.active = toggle.checked;
  }
  if (conversationDateFilter.handleChange(event) || logDateFilter.handleChange(event)) return;
}

function onWhatsappFocus(event) {
  conversationDateFilter.handleFocus(event);
  logDateFilter.handleFocus(event);
}

function onWhatsappKeydown(event) {
  if (event.key !== "Escape") return;
  if (state.guideOpen) closeGuide();
  conversationDateFilter.close();
  logDateFilter.close();
}

function hasWhatsappUnsavedChanges() {
  if (liveReadOnly || !state) return false;
  const draftDirty = Object.values(state.whitelistDrafts).some((draft) => draft.value.trim() || draft.note.trim());
  return JSON.stringify(state.settings) !== JSON.stringify(state.savedSettings)
    || JSON.stringify(state.whitelist) !== JSON.stringify(state.initialWhitelist)
    || draftDirty;
}

export async function mountPage({ scope, signal, historyState = null } = {}) {
  const [nextSnapshot, nextCurrentUser, nextUnread] = await Promise.all([getWhatsappData(), getCurrentUser(), getUnread()]);
  throwIfPageAborted(signal, scope);
  snapshot = nextSnapshot;
  currentUser = nextCurrentUser;
  unread = nextUnread;
  liveReadOnly = typeof currentUser?.hasPermission === "function";
  initializeWhatsappState(historyState);

  return {
    page: {
      menu: createBizflowMenu("whatsapp"),
      data: { unread, user: currentUser },
      render: renderWhatsapp,
      title: "Honnmono · WhatsApp"
    },
    activate() {
      scope.listen(document, "click", onWhatsappClick);
      scope.listen(document, "input", onWhatsappInput);
      scope.listen(document, "change", onWhatsappChange);
      scope.listen(document, "focusin", onWhatsappFocus);
      scope.listen(document, "keydown", onWhatsappKeydown);
    },
    hasUnsavedChanges: hasWhatsappUnsavedChanges,
    async canLeave() {
      if (!hasWhatsappUnsavedChanges()) return true;
      return confirmInPage(t("leaveUnsaved"));
    },
    captureState() {
      return {
        tab: state.tab,
        conversationChannel: state.conversationChannel,
        selectedCustomer: state.selectedCustomer,
        logChannel: state.logChannel,
        logCategory: state.logCategory,
        logLimit: state.logLimit,
        conversationDateFilter: conversationDateFilter.captureState(),
        logDateFilter: logDateFilter.captureState()
      };
    },
    dispose() {
      conversationDateFilter?.close();
      logDateFilter?.close();
      snapshot = null;
      currentUser = null;
      unread = null;
      state = null;
      currentHelpers = null;
      conversationDateFilter = null;
      logDateFilter = null;
    }
  };
}
