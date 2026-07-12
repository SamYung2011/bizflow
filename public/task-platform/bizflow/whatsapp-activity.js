import { channelOf, filterLogs, groupConversations, replyPreview } from "./whatsapp-model.js";

function channelKey(channel) {
  return channel === "meta" ? "metaApi" : "chrome";
}

function filterBar({ stateKey, value, helpers, t, dateFilter = null, categories = [] }) {
  const e = helpers.escapeHtml;
  const channels = [["all", "all"], ["extension", "chrome"], ["meta", "metaApi"]];
  return `<div class="wa-filter-bar"><div class="wa-filter-group"><span>${e(t("channel"))}</span>${channels.map(([key, label]) => `<button type="button" class="wa-chip${value === key ? " is-active" : ""}" data-wa-${stateKey}-channel="${key}" aria-pressed="${value === key}">${e(t(label))}</button>`).join("")}</div>${categories.length ? `<div class="wa-filter-group"><span>${e(t("category"))}</span><button type="button" class="wa-chip${stateKey === "log" && categories.active === "all" ? " is-active" : ""}" data-wa-log-category="all">${e(t("all"))}</button>${categories.items.map((category) => `<button type="button" class="wa-chip${categories.active === category ? " is-active" : ""}" data-wa-log-category="${e(category)}">${e(t(category))}</button>`).join("")}</div>` : ""}${dateFilter ? `<div class="wa-filter-date">${dateFilter.render(helpers)}</div>` : ""}</div>`;
}

function renderConversations(state, helpers, t, dateFilter) {
  const e = helpers.escapeHtml;
  const conversations = groupConversations(state.messages, state.conversationChannel, dateFilter);
  if (!conversations.some((row) => row.key === state.selectedCustomer)) {
    state.selectedCustomer = conversations[0]?.key ?? null;
  }
  const selected = conversations.find((row) => row.key === state.selectedCustomer);
  const list = conversations.length ? conversations.map((conversation) => `<button type="button" class="wa-conversation${conversation.key === state.selectedCustomer ? " is-active" : ""}" data-wa-conversation="${e(conversation.key)}"><span class="wa-conversation__top"><strong>${e(conversation.customerId)}</strong><time>${e(conversation.latest.time || t("empty"))}</time></span><span class="wa-conversation__preview">${e(conversation.latest.content || t("empty"))}</span><span class="wa-conversation__meta"><span class="wa-channel wa-channel--${channelOf(conversation.latest)}">${e(t(channelKey(channelOf(conversation.latest))))}</span><span>${e(t("messageCount", { count: conversation.rows.length }))}</span></span></button>`).join("") : `<div class="wa-empty">${e(t("noConversations"))}</div>`;
  const flow = selected ? selected.rows.map((message) => `<article class="wa-bubble-row wa-bubble-row--${message.role === "assistant" ? "assistant" : "user"}"><div class="wa-bubble"><header><strong>${e(t(message.role === "assistant" ? "ai" : "customer"))}</strong><span class="wa-channel wa-channel--${channelOf(message)}">${e(t(channelKey(channelOf(message))))}</span></header><p>${e(message.content || t("empty"))}</p><time>${e(message.time || t("empty"))}</time></div></article>`).join("") : `<div class="wa-empty">${e(t("selectConversation"))}</div>`;
  return `${filterBar({ stateKey: "conversation", value: state.conversationChannel, helpers, t, dateFilter })}<div class="wa-chat-layout" data-wa-conversation-count="${conversations.length}"><aside class="wa-conversation-list">${list}</aside><section class="wa-chat-flow" data-wa-selected-bubbles="${selected?.rows.length || 0}">${flow}</section></div>`;
}

function renderReplies(state, helpers, t) {
  const e = helpers.escapeHtml;
  const visible = state.replies.filter((row) => !state.skippedReplyIds.has(String(row.id)));
  const pending = visible.filter((row) => !row.deliveredAt);
  const delivered = visible.filter((row) => row.deliveredAt);
  const rows = (items, isPending) => items.map((row) => `<li class="wa-queue-row"><div><strong>${e(row.chatName || row.customerId || t("empty"))}</strong><p>${e(replyPreview(row.segments) || t("empty"))}</p><span class="wa-channel wa-channel--${channelOf(row)}">${e(t(channelKey(channelOf(row))))}</span></div><div><time>${e(row.time || t("empty"))}</time>${isPending ? `<button type="button" class="wa-button wa-button--secondary" data-wa-reply-skip="${e(row.id)}" data-wa-write${state.liveReadOnly ? ' disabled aria-disabled="true"' : ""}>${e(t("skip"))}</button>` : `<small>${e(t("deliveredAt"))}: ${e(row.deliveredAt)}</small>`}</div></li>`).join("");
  return `<section class="wa-panel"><h2>${e(t("pending"))} <span class="wa-count">${pending.length}</span></h2>${pending.length ? `<ul class="wa-queue-list">${rows(pending, true)}</ul>` : `<div class="wa-empty">${e(t("noPending"))}</div>`}</section><section class="wa-panel"><h2>${e(t("deliveredHistory"))} <span class="wa-count">${delivered.length}</span></h2><ul class="wa-queue-list">${rows(delivered, false)}</ul></section>`;
}

function renderUnresolved(state, helpers, t) {
  const e = helpers.escapeHtml;
  const rows = state.unresolved.map((row) => {
    const resolved = Boolean(row.resolvedAt) || state.resolvedIds.has(String(row.id));
    return `<li class="wa-unresolved-row${resolved ? " is-resolved" : ""}"><div><header><strong>${e(row.customerId || t("empty"))}</strong><time>${e(row.time || t("empty"))}</time></header><p>${e(row.question || t("empty"))}</p><div class="wa-tag-row">${(row.categories || []).map((category) => `<span class="wa-chip">${e(category)}</span>`).join("")}</div></div>${resolved ? `<span class="wa-resolved">${e(t("resolved"))}</span>` : `<button type="button" class="wa-button" data-wa-resolve="${e(row.id)}" data-wa-write${state.liveReadOnly ? ' disabled aria-disabled="true"' : ""}>${e(t("markResolved"))}</button>`}</li>`;
  }).join("");
  return `<section class="wa-panel"><h2>${e(t("unresolved"))}</h2>${rows ? `<ul class="wa-unresolved-list">${rows}</ul>` : `<div class="wa-empty">${e(t("noUnresolved"))}</div>`}</section>`;
}

function renderDailyReports(state, helpers, t) {
  const e = helpers.escapeHtml;
  if (!state.dailyReports.length) return `<section class="wa-panel"><div class="wa-empty wa-empty--large">${helpers.icon("icon-nav-file", "icon")}${e(t("noReports"))}</div></section>`;
  return `<section class="wa-panel"><ul class="wa-report-list">${state.dailyReports.map((row) => `<li><time>${e(row.date || row.createdAt || t("empty"))}</time><p>${e(row.content || t("empty"))}</p></li>`).join("")}</ul></section>`;
}

function renderLogs(state, helpers, t, dateFilter) {
  const e = helpers.escapeHtml;
  const categoryItems = [...new Set(state.logs.map((row) => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const categories = { items: categoryItems, active: state.logCategory, length: categoryItems.length };
  const filtered = filterLogs(state.logs, state.logChannel, state.logCategory, dateFilter);
  const visible = filtered.slice(0, state.logLimit);
  return `${filterBar({ stateKey: "log", value: state.logChannel, helpers, t, dateFilter, categories })}<section class="wa-panel wa-panel--logs" data-wa-log-total="${filtered.length}" data-wa-log-visible="${visible.length}"><div class="wa-log-summary">${e(t("visibleLogs", { visible: visible.length, total: filtered.length }))}</div>${visible.length ? `<ol class="wa-log-list">${visible.map((row) => `<li><time>${e(row.time || t("empty"))}</time><span class="wa-channel wa-channel--${channelOf(row)}">${e(t(channelKey(channelOf(row))))}</span><span class="wa-log-category wa-log-category--${Math.max(0, categoryItems.indexOf(row.category)) % 5}">${e(row.category ? t(row.category) : t("unknown"))}</span><code>${e(row.message || t("empty"))}</code></li>`).join("")}</ol>` : `<div class="wa-empty">${e(t("noLogs"))}</div>`}${visible.length < filtered.length ? `<button type="button" class="wa-button wa-load-more" data-wa-log-more>${e(t("loadMore"))}</button>` : ""}</section>`;
}

export function renderWhatsappActivity(tab, state, helpers, t, filters) {
  if (tab === "conversations") return renderConversations(state, helpers, t, filters.conversations);
  if (tab === "replies") return renderReplies(state, helpers, t);
  if (tab === "unresolved") return renderUnresolved(state, helpers, t);
  if (tab === "dailyReports") return renderDailyReports(state, helpers, t);
  if (tab === "logs") return renderLogs(state, helpers, t, filters.logs);
  return "";
}
