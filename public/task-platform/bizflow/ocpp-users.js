import {
  getCurrentUser,
  getOcppUsersData,
  getUnread,
} from "../data/provider.js";
import { renderMoneyText } from "../components/money-text.js";
import { formatUnix, paginate, textMatch } from "./ocpp-model.js";
import {
  detailGrid,
  filterInput,
  filterSelect,
  makeOcppContext,
  mountOcppShell,
  requireOcppAccess,
  renderOcppLayout,
  renderPager,
  renderTable,
  statusChip,
} from "./ocpp-shared.js";

const currentUser = await getCurrentUser();
await requireOcppAccess(currentUser);
const [data, unread] = await Promise.all([getOcppUsersData(), getUnread()]);
// Admin 后台按现网惯例明文显示 email/mobile/loginip/joinip；认证凭证不属于快照字段。
const context = makeOcppContext();
const state = {
  tab: "users",
  query: "",
  status: "all",
  bind: "all",
  page: 1,
  expanded: null,
};
const tabs = [
  { key: "users", labelKey: "userInfoTab", badge: data.users.length },
  { key: "tags", labelKey: "rfidTab", badge: data.tags.length },
];
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
  const filtered = data.users.filter(
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
  const result = paginate(filtered, state.page);
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
    attrs: `data-ocpp-users="${data.users.length}" data-ocpp-tags="${data.tags.length}"`,
  });
}
function rerender() {
  const page = document.querySelector("[data-ocpp-page]");
  if (page && h()) page.outerHTML = render(h());
}
document.addEventListener("click", (event) => {
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
    state.page = Number(pager.getAttribute("data-ocpp-user-page")) || 1;
    rerender();
    return;
  }
  const detail = event.target.closest("[data-ocpp-user-detail]");
  if (detail) {
    const id = detail.getAttribute("data-ocpp-user-detail");
    state.expanded = state.expanded === id ? null : id;
    rerender();
  }
});
document.addEventListener("input", (event) => {
  if (event.target.matches("[data-ocpp-user-query]"))
    state.query = event.target.value;
});
document.addEventListener("change", (event) => {
  if (event.target.matches("[data-ocpp-user-query]")) {
    state.page = 1;
    rerender();
  }
  if (event.target.matches("[data-ocpp-user-status]")) {
    state.status = event.target.value;
    state.page = 1;
    rerender();
  }
  if (event.target.matches("[data-ocpp-bind]")) {
    state.bind = event.target.value;
    state.page = 1;
    rerender();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches("[data-ocpp-user-query]")) {
    state.page = 1;
    rerender();
  }
});
await mountOcppShell({ activeKey: "ocpp-users", currentUser, unread, render });
