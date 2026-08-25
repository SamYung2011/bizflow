import {
  getCurrentUser,
  getOcppUsersData,
  getUnread,
} from "../data/provider.js";
import { renderMoneyText } from "../components/money-text.js";
import {
  appendRemainingPages,
  filterNeedsAllRows,
  filteredPaginationTotal,
  formatUnix,
  OCPP_PAGE_SIZE,
  paginate,
  paginateWithTotal,
  textMatch,
} from "./ocpp-model.js";
import { getLiveOcppUsersPage, OCPP_CACHE_SNAPSHOTS } from "../data/live-ocpp.js";
import { LIVE_SNAPSHOT_UPDATED_EVENT } from "../data/live-snapshot-dependencies.js";
import {
  detailGrid,
  filterInput,
  filterSelect,
  makeOcppContext,
  createOcppPage,
  requireOcppRouteAccess,
  renderOcppLayout,
  renderPager,
  renderTable,
  statusChip,
} from "./ocpp-shared.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";

// Admin 后台按现网惯例明文显示 email/mobile/loginip/joinip；认证凭证不属于快照字段。
let data = null;
let context = null;
let state = null;
let tabs = [];
let usersFullLoad = null;
let userFilterSequence = 0;
function h() {
  return context.helpers();
}
function e(v) {
  return h().escapeHtml(v ?? "—");
}
function t(k, v = {}) {
  return context.t(k, v);
}
function money(v) {
  return renderMoneyText(v, { escapeHtml: h().escapeHtml });
}
function toolbar(controls, count, total) {
  return `<div class="ocpp-toolbar"><div>${controls}</div><strong>${e(t("visible", { count, total }))}</strong></div>`;
}
function renderUsers() {
  const filtered = filteredUsers();
  const result = paginateWithTotal(
    filtered,
    state.page,
    filteredPaginationTotal({
      loaded: data.users.length,
      total: data.userTotal,
      filtered: filtered.length,
      active: userFiltersActive(),
    }),
  );
  const controls = `${filterSelect({
    helpers: h(),
    value: state.status,
    attribute: "ocpp-user-status",
    options: [
      ["all", t("all")],
      ["normal", t("normal")],
      ["hidden", t("hidden")],
    ],
  })}${filterInput({ helpers: h(), t, value: state.query, attribute: "ocpp-user-query", placeholderKey: "userSearch" })}`;
  const rows = result.rows
    .map((r) => {
      const open = String(r.rowId) === String(state.expanded);
      return `<tr><td class="ocpp-mono">${e(r.userId)}</td><td>${e(r.email || "—")}</td><td>${e(r.nickname || r.username || "—")}</td><td>${money(r.money)}</td><td>${statusChip(r.status, { helpers: h(), t })}</td><td><button class="ocpp-link" data-ocpp-user-detail="${e(r.rowId)}">${e(open ? t("collapse") : t("details"))}</button></td></tr>${
        open
          ? `<tr class="ocpp-expanded"><td colspan="6">${detailGrid(
              [
                [t("username"), r.username],
                ["tagid", r.tagid],
                [t("group"), r.groupName],
                [t("level"), r.level],
                [t("gender"), r.gender],
                [t("birthday"), r.birthday || "—"],
                [t("address"), r.address || "—"],
                [t("mobile"), r.mobile || "—"],
                [t("income"), money(r.income), true],
                [t("score"), r.score],
                [t("loginIp"), r.loginip || "—"],
                [t("joinIp"), r.joinip || "—"],
                [t("lastLogin"), formatUnix(r.lastLoginAt, h().lang)],
                [t("joinedAt"), formatUnix(r.joinedAt, h().lang)],
              ],
              h(),
            )}</td></tr>`
          : ""
      }`;
    })
    .join("");
  return `${toolbar(controls, result.rows.length, result.total)}${renderTable([t("userId"), t("email"), t("nickname"), t("money"), t("status"), t("profile")], rows, { emptyText: t("empty"), helpers: h(), minWidth: "wide", attrs: `data-ocpp-users-total="${result.total}" data-ocpp-users-page-size="${result.rows.length}"` })}${renderPager(result, { helpers: h(), t, attribute: "ocpp-user-page" })}`;
}

function filteredUsers() {
  return data.users.filter(
    (r) =>
      (state.status === "all" || r.status === state.status) &&
      textMatch(r, state.query, [
        "userId",
        "email",
        "nickname",
        "username",
        "mobile",
      ]),
  );
}

function userFiltersActive() {
  return Boolean(state.query.trim() || state.status !== "all");
}

function markUsersBusy(busy) {
  document.querySelector('[data-ocpp-route="users"]')?.setAttribute("aria-busy", busy ? "true" : "false");
}

function loadAllUsers() {
  const target = data;
  if (!filterNeedsAllRows({ loaded: target.users.length, total: target.userTotal, active: true })) {
    return Promise.resolve();
  }
  if (usersFullLoad?.target === target) return usersFullLoad.promise;
  const entry = { target, promise: null };
  entry.promise = (async () => {
    target.userTotal = await appendRemainingPages({
      rows: target.users,
      total: target.userTotal,
      fetchPage: (offset) => getLiveOcppUsersPage({ offset, status: "all" }),
      onPage: (page) => { target.userPage = page.page; },
    });
  })().finally(() => {
    if (usersFullLoad === entry) usersFullLoad = null;
  });
  usersFullLoad = entry;
  return entry.promise;
}

function preloadUserFilters() {
  const target = data;
  if (!filterNeedsAllRows({
    loaded: target.users.length,
    total: target.userTotal,
    active: userFiltersActive(),
  })) return;
  markUsersBusy(true);
  void loadAllUsers()
    .catch((error) => {
      console.warn("OCPP user filter preload failed", error);
    })
    .finally(() => {
      if (data === target && state && state.tab === "users") markUsersBusy(false);
    });
}

async function refreshUserFilters() {
  const sequence = ++userFilterSequence;
  const target = data;
  const needsLoad = filterNeedsAllRows({
    loaded: target.users.length,
    total: target.userTotal,
    active: userFiltersActive(),
  });
  if (needsLoad) markUsersBusy(true);
  try {
    if (needsLoad) await loadAllUsers();
  } catch (error) {
    console.warn("OCPP user filter preload failed", error);
  } finally {
    if (sequence === userFilterSequence && data === target && state && state.tab === "users") {
      markUsersBusy(false);
      state.page = 1;
      rerender();
    }
  }
}

async function ensureUsersForPage(targetPage) {
  const needed = targetPage * OCPP_PAGE_SIZE;
  for (let guard = 0; filteredUsers().length < needed && data.users.length < data.userTotal && guard < 10; guard += 1) {
    const page = await getLiveOcppUsersPage({ offset: data.users.length, status: "all" });
    if (!Array.isArray(page?.rows) || !page.rows.length) break;
    data.users.push(...page.rows);
    data.userPage = page.page;
    data.userTotal = Number(page.page?.total) || data.userTotal;
    if (!page.page?.hasMore) break;
  }
}
function renderTags() {
  const filtered = data.tags.filter(
    (r) =>
      (state.bind === "all" || String(r.isBind) === state.bind) &&
      (state.status === "all" || r.status === state.status) &&
      textMatch(r, state.query, [
        "tag",
        "name",
        "userId",
        "userEmail",
        "userNickname",
      ]),
  );
  const result = paginate(filtered, state.page);
  const controls = `${filterSelect({
    helpers: h(),
    value: state.bind,
    attribute: "ocpp-bind",
    options: [
      ["all", t("all")],
      ["true", t("bound")],
      ["false", t("unbound")],
    ],
  })}${filterSelect({
    helpers: h(),
    value: state.status,
    attribute: "ocpp-user-status",
    options: [
      ["all", t("all")],
      ["normal", t("normal")],
      ["hidden", t("hidden")],
    ],
  })}${filterInput({ helpers: h(), t, value: state.query, attribute: "ocpp-user-query", placeholderKey: "tagSearch" })}`;
  const rows = result.rows
    .map(
      (r) =>
        `<tr><td class="ocpp-mono">${e(r.tag)}</td><td>${e(r.name)}</td><td class="ocpp-mono">${e(r.userNickname || r.userUsername || r.userId || "—")}</td><td>${e(r.userEmail || "—")}</td><td>${e(r.operatorName || "—")}</td><td>${e(r.stationName || "—")}</td><td>${statusChip(r.isBind ? "normal" : "hidden", { helpers: h(), t, labelKey: r.isBind ? "bound" : "unbound" })}</td><td>${statusChip(r.status, { helpers: h(), t })}</td><td>${e(formatUnix(r.createdAt, h().lang))}</td></tr>`,
    )
    .join("");
  return `${toolbar(controls, result.rows.length, result.total)}${renderTable([t("tag"), t("tagName"), t("user"), t("email"), t("operatorName"), t("stationName"), t("binding"), t("status"), t("createdAt")], rows, { emptyText: t("empty"), helpers: h(), minWidth: "wide", attrs: `data-ocpp-tags-total="${result.total}"` })}${renderPager(result, { helpers: h(), t, attribute: "ocpp-user-page" })}`;
}
function render(helpers) {
  context.setHelpers(helpers);
  return renderOcppLayout({
    helpers,
    t,
    titleKey: "usersTitle",
    subtitleKey: "usersSubtitle",
    tabs,
    activeTab: state.tab,
    tabAttribute: "data-ocpp-users-tab",
    body: state.tab === "users" ? renderUsers() : renderTags(),
    attrs: `data-ocpp-route="users" data-ocpp-users="${data.users.length}" data-ocpp-tags="${data.tags.length}"`,
  });
}
function rerender() {
  const page = document.querySelector('[data-ocpp-route="users"]');
  if (page && h()) page.outerHTML = render(h());
}
async function onUsersClick(event) {
  const tab = event.target.closest("[data-ocpp-users-tab]");
  if (tab) {
    state.tab = tab.getAttribute("data-ocpp-users-tab");
    state.query = "";
    state.status = state.bind = "all";
    state.page = 1;
    state.expanded = null;
    rerender();
    return;
  }
  const pager = event.target.closest("button[data-ocpp-user-page]");
  if (pager) {
    const targetPage = Number(pager.getAttribute("data-ocpp-user-page")) || 1;
    if (state.tab === "users") await ensureUsersForPage(targetPage);
    state.page = targetPage;
    rerender();
    return;
  }
  const detail = event.target.closest("[data-ocpp-user-detail]");
  if (detail) {
    const id = detail.getAttribute("data-ocpp-user-detail");
    state.expanded = state.expanded === id ? null : id;
    rerender();
  }
}
function onUsersInput(event) {
  if (event.target.matches("[data-ocpp-user-query]")) {
    state.query = event.target.value;
    if (state.tab === "users") preloadUserFilters();
  }
}
function onUsersChange(event) {
  if (event.target.matches("[data-ocpp-user-query]")) {
    state.page = 1;
    if (state.tab === "users") void refreshUserFilters();
    else rerender();
  }
  if (event.target.matches("[data-ocpp-user-status]")) {
    state.status = event.target.value;
    state.page = 1;
    if (state.tab === "users") void refreshUserFilters();
    else rerender();
  }
  if (event.target.matches("[data-ocpp-bind]")) {
    state.bind = event.target.value;
    state.page = 1;
    rerender();
  }
}
function onUsersKeydown(event) {
  if (event.key === "Enter" && event.target.matches("[data-ocpp-user-query]")) {
    state.page = 1;
    if (state.tab === "users") void refreshUserFilters();
    else rerender();
  }
}

function createState(historyState) {
  const saved = historyState && typeof historyState === "object" ? historyState : {};
  return {
    tab: ["users", "tags"].includes(saved.tab) ? saved.tab : "users",
    query: typeof saved.query === "string" ? saved.query : "",
    status: ["all", "normal", "hidden"].includes(saved.status) ? saved.status : "all",
    bind: ["all", "true", "false"].includes(saved.bind) ? saved.bind : "all",
    page: Number.isInteger(saved.page) && saved.page > 0 ? saved.page : 1,
    expanded: saved.expanded == null ? null : String(saved.expanded),
  };
}

export async function mountPage({ scope, signal, url, navigation, historyState }) {
  const currentUser = await getCurrentUser();
  throwIfPageAborted(signal, scope);
  requireOcppRouteAccess(currentUser, { url, navigation });
  const [nextData, unread] = await Promise.all([getOcppUsersData(), getUnread()]);
  throwIfPageAborted(signal, scope);
  data = nextData;
  context = makeOcppContext();
  state = createState(historyState);
  tabs = [
    { key: "users", labelKey: "userInfoTab", badge: data.userTotal },
    { key: "tags", labelKey: "rfidTab", badge: data.tags.length },
  ];
  return {
    page: createOcppPage({ activeKey: "ocpp-users", currentUser, unread, render, title: "OCPP 用戶" }),
    activate() {
      scope.listen(document, "click", onUsersClick);
      scope.listen(document, "input", onUsersInput);
      scope.listen(document, "change", onUsersChange);
      scope.listen(document, "keydown", onUsersKeydown);
      scope.listen(window, LIVE_SNAPSHOT_UPDATED_EVENT, (event) => {
        if (event.detail?.snapshot !== OCPP_CACHE_SNAPSHOTS.users || !event.detail?.value) return;
        data = event.detail.value;
        tabs.find((tab) => tab.key === "users").badge = data.userTotal;
        tabs.find((tab) => tab.key === "tags").badge = data.tags.length;
        rerender();
      });
    },
    captureState: () => ({ ...state }),
    dispose() {
      userFilterSequence += 1;
      usersFullLoad = null;
      data = null;
      context = null;
      state = null;
      tabs = [];
    },
  };
}
