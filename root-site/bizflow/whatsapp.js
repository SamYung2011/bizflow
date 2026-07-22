import { getCurrentUser, getUnread, getWhatsappData } from "../data/provider.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { createDateRangeFilter, latestDateInput } from "../components/date-range-filter.js";
import { renderSegment } from "../components/segment.js";
import { renderWhatsappActivity } from "./whatsapp-activity.js";
import { renderWhatsappConfig, renderWhatsappGuide } from "./whatsapp-config.js";
import { translateWhatsapp } from "./whatsapp-i18n.js";
import {
  WHATSAPP_CLIENT_HEARTBEAT_INTERVAL_MS,
  whatsappClientOnlineState
} from "./whatsapp-client-status.js";
import { channelOf, dateOnly, nextLocalId, promptPlaceholdersValid, whatsappTabs, whitelistKinds } from "./whatsapp-model.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import { attachLiveSnapshotRefresh } from "../data/live-snapshot-listener.js";
import { WHATSAPP_REALTIME_TABLES, WHATSAPP_SNAPSHOT } from "../data/live-whatsapp-contract.js";
import {
  addLiveWhatsappWhitelist,
  removeLiveWhatsappWhitelist,
  setLiveWhatsappWhitelistActive,
  updateLiveWhatsappSettings
} from "../data/live-whatsapp-writes.js";

let snapshot = null;
let currentUser = null;
let unread = null;
let liveMode = false;
let settingsReadOnly = false;
let whatsappLiveRefresh = null;

const blankWhitelistDrafts = () => Object.fromEntries(whitelistKinds.map((kind) => [kind, { value: "", note: "" }]));
let state = null;
let currentHelpers = null;
let conversationDateFilter = null;
let logDateFilter = null;

function initializeWhatsappState(historyState = null) {
  const restored = historyState && typeof historyState === "object" ? historyState : {};
  const settings = { ...snapshot.settings };
  state = {
    liveMode,
    liveReadOnly: settingsReadOnly,
    activityReadOnly: liveMode,
    writeBlocked: settingsReadOnly,
    savingSection: "",
    writeError: "",
    tab: whatsappTabs.includes(restored.tab) ? restored.tab : "settings",
    settings,
    savedSettings: { ...settings },
    savedKnowledge: settings.knowledge || "",
    savedPrompts: {
      chargersPrompt: settings.chargersPrompt || "",
      locationHintPrompt: settings.locationHintPrompt || ""
    },
    clients: snapshot.clients,
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

  conversationDateFilter = createDateRangeFilter({
    id: "whatsapp-conversations",
    initialDate: latestDateInput(state.messages.map((row) => dateOnly(row.time))),
    onChange: ({ filterChanged }) => {
      if (filterChanged) state.selectedCustomer = null;
      rerender();
    }
  });
  logDateFilter = createDateRangeFilter({
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

function robotStatusView() {
  const onlineState = whatsappClientOnlineState(state.clients);
  return {
    ...onlineState,
    label: t(onlineState.status),
    lastSeenLabel: onlineState.lastSeen || t("empty")
  };
}

function updateRobotStatus() {
  if (!state || !currentHelpers) return;
  const root = document.querySelector("[data-wa-robot-status]");
  if (!root) return;
  const status = robotStatusView();
  root.classList.remove("wa-status--online", "wa-status--offline", "wa-status--never");
  root.classList.add(`wa-status--${status.status}`);
  root.dataset.waRobotStatus = status.status;
  root.dataset.waClientLastSeen = status.lastSeen;
  const label = root.querySelector("[data-wa-robot-status-label]");
  const heartbeat = root.querySelector("[data-wa-client-last-heartbeat]");
  if (label) label.textContent = `${t("robotStatus")}: ${status.label}`;
  if (heartbeat) heartbeat.textContent = `${t("lastHeartbeat")}: ${status.lastSeenLabel}`;
}

function renderHeader(helpers) {
  const e = helpers.escapeHtml;
  const customerCount = new Set(state.messages.filter((row) => row.customerId)
    .map((row) => `${channelOf(row)}:${row.customerId}`)).size;
  const openUnresolved = unresolvedCount();
  const robotStatus = robotStatusView();
  return `<header class="wa-head"><div><h1>${e(t("title"))}</h1><p>${e(t("subtitle"))}</p></div><div class="wa-status wa-status--${e(robotStatus.status)}" data-wa-robot-status="${e(robotStatus.status)}" data-wa-client-last-seen="${e(robotStatus.lastSeen)}"><span class="wa-status__dot"></span><div><strong data-wa-robot-status-label>${e(t("robotStatus"))}: ${e(robotStatus.label)}</strong><small data-wa-client-last-heartbeat>${e(t("lastHeartbeat"))}: ${e(robotStatus.lastSeenLabel)}</small></div></div></header><div class="wa-stats" data-wa-mode="${e(state.settings.claudeMode || "")}" data-wa-customers="${customerCount}" data-wa-messages="${state.messages.length}" data-wa-unresolved="${openUnresolved}"><span>${e(t("mode"))}<strong>${e(state.settings.claudeMode || t("unknown"))}</strong></span><span>${e(t("customers"))}<strong>${customerCount}</strong></span><span>${e(t("messages"))}<strong>${state.messages.length}</strong></span><span>${e(t("unresolved"))}<strong>${openUnresolved}</strong></span></div>`;
}

export function renderWhatsapp(helpers) {
  currentHelpers = helpers;
  state.writeBlocked = state.liveReadOnly || Boolean(state.savingSection);
  const segment = renderSegment({
    items: tabItems(),
    active: state.tab,
    ariaLabel: t("title"),
    escapeHtml: helpers.escapeHtml,
    dataAttribute: "data-wa-tab",
    sliding: false
  });
  const body = renderWhatsappConfig(state.tab, state, helpers, t) || renderWhatsappActivity(state.tab, state, helpers, t, {
    conversations: conversationDateFilter,
    logs: logDateFilter
  });
  const writeNotice = state.writeError
    ? `<div class="wa-write-notice is-error" role="alert">${helpers.escapeHtml(t(state.writeError))}</div>`
    : state.savingSection
      ? `<div class="wa-write-notice" role="status">${helpers.escapeHtml(t("savingLive"))}</div>`
      : "";
  return `<main class="wa-page" data-wa-page data-live-mode="${liveMode}" data-live-read-only="${settingsReadOnly}" data-wa-active-tab="${helpers.escapeHtml(state.tab)}" data-wa-admin="${currentUser?.isWaAdmin === true}">${renderHeader(helpers)}${writeNotice}<div class="wa-segment">${segment}</div><div class="wa-content">${body}</div>${renderWhatsappGuide(state, helpers, t)}</main>`;
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
  if (cancel) cancel.disabled = state.writeBlocked || !dirty;
  if (save) save.disabled = state.writeBlocked || !dirty;
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
  if (save) save.disabled = state.writeBlocked || !valid;
}

function handleDateFilterClick(event) {
  const root = event.target.closest?.("[data-date-range-filter]");
  if (!root) return false;
  const id = root.getAttribute("data-date-range-filter");
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

const SETTINGS_SECTION_KEYS = Object.freeze({
  runtime: ["botName", "botPhone", "bossChatName", "replyDelayBase", "cooldownMinutes", "maxRepliesPerMin", "dailyReportHour"],
  meta: ["metaGraphVersion", "metaPhoneNumberId", "metaWabaId"],
  tts: ["metaTtsEnabled", "metaTtsRelayUrl", "metaTtsVoiceId", "metaTtsLanguageBoost", "metaTtsPrompt"],
  knowledge: ["knowledge"],
  prompts: ["chargersPrompt", "locationHintPrompt"]
});

function settingsPatch(section) {
  return Object.fromEntries((SETTINGS_SECTION_KEYS[section] ?? [])
    .map((key) => [key, state.settings[key]]));
}

function markSettingsSaved(target, patch) {
  target.savedSettings = { ...target.savedSettings, ...patch };
  if (Object.hasOwn(patch, "knowledge")) target.savedKnowledge = patch.knowledge;
  if (Object.hasOwn(patch, "chargersPrompt") || Object.hasOwn(patch, "locationHintPrompt")) {
    target.savedPrompts = {
      chargersPrompt: Object.hasOwn(patch, "chargersPrompt") ? patch.chargersPrompt : target.savedPrompts.chargersPrompt,
      locationHintPrompt: Object.hasOwn(patch, "locationHintPrompt") ? patch.locationHintPrompt : target.savedPrompts.locationHintPrompt
    };
  }
}

async function runLiveWrite(section, operation, commit) {
  if (!state || state.writeBlocked) return false;
  const target = state;
  target.savingSection = section;
  target.writeError = "";
  rerender();
  let succeeded = false;
  try {
    const result = await operation();
    if (state !== target) return false;
    commit?.(result, target);
    target.savedSection = section;
    target.generatedAt = new Date().toISOString();
    succeeded = true;
  } catch (error) {
    if (state !== target) return false;
    console.error("[live-whatsapp] write failed", error);
    target.writeError = "writeFailed";
  } finally {
    if (state === target) {
      target.savingSection = "";
      rerender();
      await whatsappLiveRefresh?.flush();
    }
  }
  return succeeded;
}

async function onWhatsappClick(event) {
  if (handleDateFilterClick(event)) return;
  const writeControl = event.target.closest("[data-wa-write]");
  if (writeControl?.disabled || (state.writeBlocked && writeControl)) return;

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
    const previous = state.settings.claudeMode;
    const next = mode.getAttribute("data-wa-mode");
    state.settings.claudeMode = next;
    state.savedSection = "";
    if (state.liveMode) {
      const saved = await runLiveWrite("mode", () => updateLiveWhatsappSettings({ claudeMode: next }), (_result, target) => {
        markSettingsSaved(target, { claudeMode: next });
      });
      if (!saved && state) state.settings.claudeMode = previous;
    }
    rerender();
    return;
  }
  const save = event.target.closest("[data-wa-save]");
  if (save && !save.disabled) {
    const section = save.getAttribute("data-wa-save");
    const patch = settingsPatch(section);
    if (state.liveMode) {
      await runLiveWrite(section, () => updateLiveWhatsappSettings(patch), (_result, target) => markSettingsSaved(target, patch));
    } else {
      markSettingsSaved(state, patch);
      state.savedSection = section;
    }
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
    if (state.liveMode) {
      if (!await confirmInPage(t("removeLiveConfirm"), { danger: true })) return;
      await runLiveWrite("whitelist", () => removeLiveWhatsappWhitelist(id), (_result, target) => {
        target.whitelist = target.whitelist.filter((row) => String(row.id) !== id);
        target.initialWhitelist = target.whitelist.map((row) => ({ ...row }));
      });
    } else {
      state.whitelist = state.whitelist.filter((row) => String(row.id) !== id);
    }
    rerender();
    return;
  }
  const add = event.target.closest("[data-wa-whitelist-add]");
  if (add && !add.disabled) {
    const kind = add.getAttribute("data-wa-whitelist-add");
    const draft = state.whitelistDrafts[kind];
    if (state.liveMode) {
      await runLiveWrite("whitelist", () => addLiveWhatsappWhitelist({ kind, ...draft }), (row, target) => {
        target.whitelist.unshift({
          id: row.id,
          kind: row.kind,
          value: row.value,
          note: row.note || "",
          active: row.active === true
        });
        target.initialWhitelist = target.whitelist.map((item) => ({ ...item }));
        target.whitelistDrafts[kind] = { value: "", note: "" };
      });
    } else {
      state.whitelist.push({ id: nextLocalId("wa-allow"), kind, value: draft.value.trim(), note: draft.note.trim(), active: true });
      state.whitelistDrafts[kind] = { value: "", note: "" };
    }
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
    if (state.activityReadOnly) return;
    state.skippedReplyIds.add(replySkip.getAttribute("data-wa-reply-skip"));
    rerender();
    return;
  }
  const resolve = event.target.closest("[data-wa-resolve]");
  if (resolve) {
    if (state.activityReadOnly) return;
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
  if (state.writeBlocked && event.target.closest("[data-wa-write]")) return;
  const setting = event.target.closest("[data-wa-setting]");
  if (setting && setting.type !== "checkbox") {
    const key = setting.getAttribute("data-wa-setting");
    state.settings[key] = setting.value;
    state.savedSection = "";
    state.writeError = "";
    if (key === "knowledge") updateKnowledgeMeta();
    if (key === "locationHintPrompt") updatePromptValidation();
  }
  const draft = event.target.closest("[data-wa-whitelist-draft]");
  if (draft) {
    const kind = draft.getAttribute("data-wa-whitelist-kind");
    const key = draft.getAttribute("data-wa-whitelist-draft");
    state.whitelistDrafts[kind][key] = draft.value;
    const button = document.querySelector(`[data-wa-whitelist-add="${kind}"]`);
    if (button) button.disabled = state.writeBlocked || !state.whitelistDrafts[kind].value.trim();
  }
}

async function onWhatsappChange(event) {
  if (state.writeBlocked && event.target.closest("[data-wa-write]")) return;
  const setting = event.target.closest("[data-wa-setting]");
  if (setting?.type === "checkbox") {
    state.settings[setting.getAttribute("data-wa-setting")] = setting.checked;
    state.savedSection = "";
    state.writeError = "";
  }
  const toggle = event.target.closest("[data-wa-whitelist-toggle]");
  if (toggle) {
    const row = state.whitelist.find((item) => String(item.id) === toggle.getAttribute("data-wa-whitelist-toggle"));
    if (row && state.liveMode) {
      await runLiveWrite("whitelist", () => setLiveWhatsappWhitelistActive(row.id, toggle.checked), (_result, target) => {
        const saved = target.whitelist.find((item) => String(item.id) === String(row.id));
        if (saved) saved.active = toggle.checked;
        target.initialWhitelist = target.whitelist.map((item) => ({ ...item }));
      });
    } else if (row) {
      row.active = toggle.checked;
    }
  }
}

function onWhatsappKeydown(event) {
  if (event.key !== "Escape") return;
  if (state.guideOpen) closeGuide();
  conversationDateFilter.close();
  logDateFilter.close();
}

function hasWhatsappUnsavedChanges() {
  if (!state || state.liveReadOnly) return false;
  if (state.savingSection) return true;
  const draftDirty = Object.values(state.whitelistDrafts).some((draft) => draft.value.trim() || draft.note.trim());
  return JSON.stringify(state.settings) !== JSON.stringify(state.savedSettings)
    || JSON.stringify(state.whitelist) !== JSON.stringify(state.initialWhitelist)
    || draftDirty;
}

function hasWhatsappRefreshBlock() {
  if (!state) return false;
  const focusedWrite = typeof document !== "undefined" && document.activeElement?.closest?.("[data-wa-write]");
  return Boolean(state.savingSection || focusedWrite || hasWhatsappUnsavedChanges());
}

function applyWhatsappSnapshot(nextSnapshot) {
  snapshot = nextSnapshot;
  state.settings = { ...nextSnapshot.settings };
  state.savedSettings = { ...nextSnapshot.settings };
  state.savedKnowledge = nextSnapshot.settings.knowledge || "";
  state.savedPrompts = {
    chargersPrompt: nextSnapshot.settings.chargersPrompt || "",
    locationHintPrompt: nextSnapshot.settings.locationHintPrompt || ""
  };
  state.clients = nextSnapshot.clients;
  state.generatedAt = nextSnapshot.generatedAt;
  state.whitelist = nextSnapshot.whitelist.map((row) => ({ ...row }));
  state.initialWhitelist = nextSnapshot.whitelist.map((row) => ({ ...row }));
  state.whitelistDrafts = blankWhitelistDrafts();
  state.messages = nextSnapshot.messages;
  state.replies = nextSnapshot.replies;
  state.unresolved = nextSnapshot.unresolved;
  state.dailyReports = nextSnapshot.dailyReports;
  state.logs = nextSnapshot.logs;
  state.savedSection = "";
  state.writeError = "";
}

function flushWhatsappRefreshAfterFocus() {
  queueMicrotask(() => {
    if (!hasWhatsappRefreshBlock()) void whatsappLiveRefresh?.flush();
  });
}

export async function mountPage({ scope, signal, historyState = null } = {}) {
  const [nextSnapshot, nextCurrentUser, nextUnread] = await Promise.all([getWhatsappData(), getCurrentUser(), getUnread()]);
  throwIfPageAborted(signal, scope);
  snapshot = nextSnapshot;
  currentUser = nextCurrentUser;
  unread = nextUnread;
  liveMode = nextSnapshot?.__live === true || typeof currentUser?.hasPermission === "function";
  settingsReadOnly = liveMode && currentUser?.isWaAdmin !== true;
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
      scope.listen(document, "focusout", flushWhatsappRefreshAfterFocus);
      scope.listen(document, "keydown", onWhatsappKeydown);
      const robotStatusInterval = setInterval(updateRobotStatus, WHATSAPP_CLIENT_HEARTBEAT_INTERVAL_MS);
      scope.onCleanup(() => clearInterval(robotStatusInterval));
      whatsappLiveRefresh = attachLiveSnapshotRefresh({
        scope,
        snapshots: [WHATSAPP_SNAPSHOT],
        tables: WHATSAPP_REALTIME_TABLES,
        isBlocked: hasWhatsappRefreshBlock,
        async refresh({ defer, isCurrent }) {
          const nextData = await getWhatsappData();
          if (!isCurrent()) return;
          if (hasWhatsappRefreshBlock()) {
            state.clients = nextData.clients;
            updateRobotStatus();
            defer();
            return;
          }
          applyWhatsappSnapshot(nextData);
          rerender();
        }
      });
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
      liveMode = false;
      settingsReadOnly = false;
      whatsappLiveRefresh = null;
    }
  };
}
