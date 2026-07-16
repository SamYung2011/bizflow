import { dictionaries } from "./shell-i18n.js";
import { mountIconSprite } from "../assets/icons/inline-sprite.js";
import { renderLanguageMenu, renderUserPanel, attachMenuBehaviors } from "../components/menus.js";
import { attachGlobalSearch, renderGlobalSearch } from "./shell-search.js";
import { getRememberedUnreadWatermarks, markRead, READ_STATE_STORAGE_KEY } from "../data/read-state.js";
import { installNavigationPrerender } from "../components/navigation-prerender.js";

const iconsUrl = "../assets/icons/icons.svg";
const root = document.getElementById("shell-root");
const mobileViewport = window.matchMedia?.("(max-width: 768px)") ?? null;
let mode = mobileViewport
  ? (mobileViewport.matches ? "mobile" : "desktop")
  : (document.body.dataset.shellMode === "mobile" ? "mobile" : "desktop");
const initialLang = new URLSearchParams(window.location.search).get("lang");
const langs = ["zh", "en", "fr"];
let companies = [
  { key: "honnmono", labelKey: "shell.company" },
  // 品牌名称固定使用官方字面量，不参与界面语言本地化。
  { key: "driver-ez", label: "Driver EZ" }
];
const state = {
  lang: langs.includes(initialLang) ? initialLang : "zh",
  company: companies[0].key,
  drawerOpen: false,
  profileUser: null,
  profileJoinRequest: null,
  authEnabled: false,
  forcePasswordOpen: false,
  forcePasswordBusy: false
};
let authApi = null;
let authSubscription = null;
let lastResumeRefreshAt = 0;

// 红点=数据驱动(煊煊 2026-07-08:有未读才亮,禁照版面摆装饰红点)。
// 屏页在 import 本文件前设 window.__shellData = { unread: {...} }。
// 分站菜单(煊煊 2026-07-08:team/bizflow 两个网页):屏页可设 window.__shellMenu 覆盖;
// 不设=壳演示用全量 7 项(Figma 模板帧原样)。
let unread = window.__shellData?.unread ?? {};
let unreadWatermarks = getRememberedUnreadWatermarks();

const defaultMenu = [
  { key: "nav.home", icon: "icon-nav-home", active: true },
  { key: "nav.tasks", icon: "icon-nav-task", unreadKey: "tasks" },
  { key: "nav.team", icon: "icon-nav-user" },
  { key: "nav.orders", icon: "icon-nav-list", unreadKey: "orders" },
  { key: "nav.customers", icon: "icon-nav-user" },
  { key: "nav.inventory", icon: "icon-nav-inventory", unreadKey: "inventory" }
];

const menuSource = window.__shellMenu ?? defaultMenu;

function buildMenuItems(user) {
  const authenticated = typeof user?.hasPermission === "function";
  const canViewAdminItems = !authenticated || user.isBfAdmin === true;
  return menuSource
    .filter((item) => !item.adminOnly || canViewAdminItems)
    .map((item) => ({
      ...item,
      update: item.unreadKey ? (unread[item.unreadKey] ?? 0) > 0 : false
    }));
}

let menuItems = buildMenuItems(window.__shellData?.user);

let hasUnreadMessages = (unread.messages ?? 0) > 0;

mountIconSprite();

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function t(key) {
  return dictionaries[state.lang]?.[key] ?? dictionaries.zh[key] ?? key;
}

function icon(id, className = "icon") {
  const safeId = escapeHtml(id);
  const href = document.getElementById("tp-icon-sprite") ? `#${safeId}` : `${iconsUrl}#${safeId}`;
  return `<svg class="${className}" aria-hidden="true"><use href="${href}"></use></svg>`;
}

function line(text, className = "tp-line") {
  return `<span class="${className}" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
}

function redDot() {
  return '<span class="tp-dot" aria-hidden="true"></span>';
}

function currentLanguageLabel() {
  return t(`lang.${state.lang}`);
}

function companyLabel(company = companies.find((item) => item.key === state.company)) {
  if (!company) return t("shell.company");
  return company.labelKey ? t(company.labelKey) : company.label;
}

function renderCompanyMenu() {
  const options = companies.map((company) => {
    const selected = company.key === state.company;
    const label = companyLabel(company);
    return `<button type="button" class="dropdown-item shell-company-menu__item${selected ? " dropdown-item--current" : ""}" role="option" data-company="${escapeHtml(company.key)}" aria-selected="${selected}"${selected ? " disabled" : ""} title="${escapeHtml(label)}">
      ${line(label)}
    </button>`;
  }).join("");

  return `<div class="tp-component menu-popover menu-popover--start shell-company-menu" data-menu-popover role="listbox" aria-label="${escapeHtml(t("shell.companyMenu"))}">
    ${options}
  </div>`;
}

function renderCompanySelect({ mobile = false } = {}) {
  const label = companyLabel();
  const triggerClass = mobile
    ? "shell-mobile-company-trigger"
    : "tp-component shell-select shell-company-select";
  const triggerBody = mobile
    ? `${icon("icon-nav-honnmono", "icon icon--frame")}${line(label, "shell-mobile-brand")}`
    : line(label);

  return `<span class="shell-menu-anchor shell-company-anchor${mobile ? " shell-company-anchor--mobile" : ""}" data-menu>
    <button type="button" class="${triggerClass}" data-menu-trigger aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeHtml(t("shell.companyMenu"))}">
      ${triggerBody}
    </button>
    ${renderCompanyMenu()}
  </span>`;
}

function renderLanguageSelect() {
  // 侧栏语言下拉(改 cycle 盲轮换为浮层选择):左对齐锚点向下弹(placement:start),不溢出。
  return `<span class="shell-menu-anchor shell-language-anchor" data-menu>
    <button type="button" class="tp-component shell-select shell-language-select" data-menu-trigger aria-label="${escapeHtml(t("shell.language"))}">
      ${icon("icon-nav-language")}
      ${line(currentLanguageLabel())}
    </button>
    ${renderLanguageMenu({ langs: langs.map((code) => ({ code, label: t(`lang.${code}`) })), current: state.lang, t, placement: "start" })}
  </span>`;
}

function renderMessageButton() {
  // 消息钮=快跳 team 未读入口(煊煊 2026-07-08 定):两站所有页统一跳 team 站主页。
  return `<a href="../team/index.html" class="tp-component btn-messenger shell-icon-button ${hasUnreadMessages ? "btn-messenger--update" : ""}" data-shell-message aria-label="${escapeHtml(t("shell.message"))}">
    ${icon("icon-nav-messenger")}
    ${hasUnreadMessages ? redDot() : ""}
  </a>`;
}

function renderLanguageButton() {
  // 语言下拉(106-12 参考):globe 触发浮层选择,不再盲轮换
  return `<span class="shell-menu-anchor" data-menu>
    <button type="button" class="tp-component btn-messenger shell-icon-button" data-menu-trigger aria-label="${escapeHtml(t("shell.language"))}">
      ${icon("icon-nav-language")}
    </button>
    ${renderLanguageMenu({ langs: langs.map((code) => ({ code, label: t(`lang.${code}`) })), current: state.lang, t })}
  </span>`;
}

function syncProfileUser() {
  if (!state.profileUser && window.__shellData?.user) {
    state.profileUser = {
      ...window.__shellData.user,
      availableCompanies: (window.__shellData.user.availableCompanies ?? []).map((company) => ({ ...company }))
    };
  }
}

function avatarPanelContext() {
  syncProfileUser();
  const user = state.profileUser;
  const onTeamSite = window.location.pathname.includes("/team/");
  // 返回 bizflow:仅 team 站 + bizflow_main_access=true(宁关不假开)
  const links = user && user.bizflowMainAccess === true && onTeamSite
    ? [{ href: "../bizflow/home.html", label: t("menu.backToBizflow") }]
    : [];
  const panelUser = user
    ? { ...user, company: companyLabel() }
    : { name: t("shell.avatar"), email: "", company: companyLabel() };
  return { links, panelUser };
}

function renderAvatarPanel() {
  const { links, panelUser } = avatarPanelContext();
  return renderUserPanel({
    user: panelUser,
    t,
    links,
    joinRequest: state.profileJoinRequest,
    profileReadOnly: state.authEnabled
  });
}

function renderAvatarMenu() {
  const { panelUser } = avatarPanelContext();
  return `<span class="shell-menu-anchor" data-menu>
    <button type="button" class="tp-component avatar avatar--image shell-avatar shell-avatar-trigger" data-menu-trigger title="${escapeHtml(panelUser.name)}" aria-label="${escapeHtml(t("menu.user"))}"></button>
    ${renderAvatarPanel()}
  </span>`;
}

function renderDrawerButton() {
  const anyMenuUnread = menuItems.some((item) => item.update);
  return `<button type="button" class="tp-component btn-toggle-sidebar shell-icon-button btn-toggle-sidebar--open ${anyMenuUnread ? "btn-toggle-sidebar--update" : ""}" data-action="open-drawer" data-shell-drawer-unread aria-expanded="${state.drawerOpen}" aria-label="${escapeHtml(t("shell.menu"))}">
    ${anyMenuUnread ? redDot() : ""}
  </button>`;
}

function renderTopbar() {
  return `<header class="shell-topbar">
    <div class="shell-topbar__brand">
      <span class="shell-topbar__desktop-brand">${renderCompanySelect()}</span>
      <span class="shell-topbar__mobile-brand">${renderCompanySelect({ mobile: true })}</span>
    </div>
    ${renderGlobalSearch({ t, icon, escapeHtml })}
    <div class="shell-topbar__actions">
      ${renderMessageButton()}
      ${renderLanguageButton()}
      ${renderAvatarMenu()}
    </div>
    <div class="shell-topbar__mobile-actions">
      ${renderMessageButton()}
      ${renderLanguageButton()}
      ${renderDrawerButton()}
    </div>
  </header>`;
}

function renderMenuItem(item) {
  const text = t(item.key);
  const classes = `tp-component menu-item ${item.active ? "menu-item--blue" : ""} ${item.update ? "menu-item--update" : ""}`;
  const inner = `${icon(item.icon)}${line(text)}${item.update ? redDot() : ""}`;
  const unreadAttribute = item.unreadKey ? ` data-unread-key="${escapeHtml(item.unreadKey)}"` : "";
  // href=真链接(煊煊 2026-07-08:页面联通);无 href=壳演示项,保持 div 不可点。
  if (item.href) {
    return `<a href="${escapeHtml(item.href)}" class="${classes}"${unreadAttribute} title="${escapeHtml(text)}">${inner}</a>`;
  }
  return `<div class="${classes}"${unreadAttribute} title="${escapeHtml(text)}">${inner}</div>`;
}

function renderNav() {
  return `<nav class="shell-nav" aria-label="${escapeHtml(t("shell.menu"))}">
    ${menuItems.map(renderMenuItem).join("")}
  </nav>`;
}

function renderAddRow() {
  const user = state.profileUser ?? window.__shellData?.user;
  const liveReadOnly = typeof user?.hasPermission === "function";
  return `<button type="button" class="tp-component add-row shell-add-row" aria-label="${escapeHtml(t("shell.add"))}"${liveReadOnly ? " disabled aria-disabled=\"true\"" : ""}>
    ${icon("icon-add-surface-add")}
  </button>`;
}

function renderSidebar() {
  return `<aside class="shell-sidebar">
    ${renderLanguageSelect()}
    ${renderNav()}
    ${renderAddRow()}
  </aside>`;
}

function renderDrawer() {
  return `<div class="shell-mobile-overlay" data-action="close-drawer"></div>
  <aside class="shell-mobile-drawer" aria-hidden="${!state.drawerOpen}" aria-label="${escapeHtml(t("shell.menu"))}">
    ${renderLanguageSelect()}
    ${renderNav()}
    ${renderAddRow()}
  </aside>`;
}

function renderContent() {
  // 屏幕页注入钩子:screens/*.js 在 import 本文件前设 window.__shellContent,壳只管骨架
  if (typeof window.__shellContent === "function") {
    return `<main class="shell-main">
      <div class="shell-page-inner">${window.__shellContent({ t, icon, line, redDot, escapeHtml, lang: state.lang })}</div>
    </main>`;
  }
  return `<main class="shell-main">
    <div class="shell-page-inner">
      <div class="shell-grid" aria-label="${escapeHtml(t("shell.menu"))}">
        <section class="shell-card" aria-hidden="true"></section>
        <section class="shell-card shell-card--desktop-only" aria-hidden="true"></section>
        <section class="shell-card shell-card--wide" aria-hidden="true"></section>
      </div>
    </div>
  </main>`;
}

function renderForcedPasswordModal() {
  if (!state.forcePasswordOpen) return "";
  return `<div class="shell-auth-overlay">
    <form class="tp-component shell-auth-modal" data-force-password-form role="dialog" aria-modal="true" aria-labelledby="shell-force-password-title">
      <h2 id="shell-force-password-title">${escapeHtml(t("menu.changePassword"))}</h2>
      <label class="user-panel__field-group"><span class="user-panel__label">${escapeHtml(t("menu.newPassword"))}</span><input class="user-panel__field-control" name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="${escapeHtml(t("menu.newPasswordPlaceholder"))}"></label>
      <label class="user-panel__field-group"><span class="user-panel__label">${escapeHtml(t("menu.newPassword"))}</span><input class="user-panel__field-control" name="confirmation" type="password" required minlength="6" autocomplete="new-password" placeholder="${escapeHtml(t("menu.newPasswordPlaceholder"))}"></label>
      <button type="submit" class="user-panel__action user-panel__action--primary"${state.forcePasswordBusy ? " disabled" : ""}>${escapeHtml(t("menu.confirmChange"))}</button>
    </form>
  </div>`;
}

function render() {
  window.__shellBootCleanup?.();
  document.documentElement.lang = state.lang === "zh" ? "zh-Hant" : state.lang;
  root.innerHTML = `<div class="shell-app shell-app--${mode} ${state.drawerOpen ? "is-drawer-open" : ""}">
    ${renderTopbar()}
    ${renderSidebar()}
    ${renderDrawer()}
    ${renderContent()}
  </div>${renderForcedPasswordModal()}`;
}

function renderProfileView() {
  render();
  const trigger = root.querySelector(".shell-avatar-trigger");
  const anchor = trigger?.closest("[data-menu]");
  const panel = anchor?.querySelector(".user-panel[data-panel-view]");
  const popover = anchor?.querySelector("[data-menu-popover]");
  if (!trigger || !panel || !popover) return;
  trigger.setAttribute("aria-expanded", "true");
  panel.setAttribute("data-panel-view", "profile");
  popover.classList.add("menu-popover--open");
}

function syncShellState() {
  const app = root.querySelector(".shell-app");
  if (!app) return;
  app.classList.toggle("shell-app--mobile", mode === "mobile");
  app.classList.toggle("shell-app--desktop", mode === "desktop");
  app.classList.toggle("is-drawer-open", state.drawerOpen);
  app.querySelector('[data-action="open-drawer"]')?.setAttribute("aria-expanded", String(state.drawerOpen));
  app.querySelector(".shell-mobile-drawer")?.setAttribute("aria-hidden", String(!state.drawerOpen));
}

function syncDirectDot(element, visible) {
  const dot = [...element.children].find((child) => child.classList.contains("tp-dot"));
  if (visible && !dot) element.insertAdjacentHTML("beforeend", redDot());
  if (!visible) dot?.remove();
}

function syncUnreadIndicators() {
  menuItems = menuItems.map((item) => ({
    ...item,
    update: item.unreadKey ? (unread[item.unreadKey] ?? 0) > 0 : false
  }));
  for (const item of menuItems) {
    if (!item.unreadKey) continue;
    root.querySelectorAll(`[data-unread-key="${item.unreadKey}"]`).forEach((element) => {
      element.classList.toggle("menu-item--update", item.update);
      syncDirectDot(element, item.update);
    });
  }
  hasUnreadMessages = (unread.messages ?? 0) > 0;
  root.querySelectorAll("[data-shell-message]").forEach((element) => {
    element.classList.toggle("btn-messenger--update", hasUnreadMessages);
    syncDirectDot(element, hasUnreadMessages);
  });
  const anyMenuUnread = menuItems.some((item) => item.update);
  root.querySelectorAll("[data-shell-drawer-unread]").forEach((element) => {
    element.classList.toggle("btn-toggle-sidebar--update", anyMenuUnread);
    syncDirectDot(element, anyMenuUnread);
  });
}

async function refreshUnreadIndicators(event) {
  const key = event.detail?.key;
  if (key) {
    unread = { ...unread, [key]: 0 };
  } else {
    // Keep provider external to the classic shell demo bundle; screen modules already share this ESM instance.
    const providerPath = "../data/provider.js";
    const { getUnread } = await import(providerPath);
    unread = await getUnread();
  }
  if (window.__shellData) window.__shellData.unread = { ...unread };
  unreadWatermarks = getRememberedUnreadWatermarks();
  syncUnreadIndicators();
}

function closeTransientShellUi() {
  state.drawerOpen = false;
  root.querySelectorAll(".menu-popover--open").forEach((popover) => popover.classList.remove("menu-popover--open"));
  root.querySelectorAll("[data-menu-trigger]").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
}

function setViewportMode(isMobile) {
  const nextMode = isMobile ? "mobile" : "desktop";
  if (nextMode === mode) return;
  const app = root.querySelector(".shell-app");
  app?.classList.add("is-viewport-switching");
  mode = nextMode;
  closeTransientShellUi();
  syncShellState();
  app?.getBoundingClientRect();
  app?.classList.remove("is-viewport-switching");
}

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-shell-message]")) {
    markRead("messages", unreadWatermarks.messages);
  }

  const companyItem = event.target.closest("[data-company]");
  if (companyItem && !companyItem.disabled) {
    const nextCompany = companyItem.getAttribute("data-company");
    if (companies.some((company) => company.key === nextCompany)) {
      if (state.authEnabled && authApi) {
        try {
          await authApi.setActiveCompany(nextCompany);
          window.location.reload();
        } catch (error) {
          console.warn("[auth] company switch failed", error);
        }
        return;
      }
      state.company = nextCompany;
      render();
    }
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;

  if (action === "open-drawer") {
    state.drawerOpen = true;
    syncShellState();
  }
  if (action === "close-drawer") {
    state.drawerOpen = false;
    syncShellState();
  }
});

document.addEventListener("keydown", (event) => {
  if (state.forcePasswordOpen) return;
  if (event.key !== "Escape" || !state.drawerOpen) return;
  state.drawerOpen = false;
  syncShellState();
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-force-password-form]");
  if (!form || !authApi || !state.profileUser) return;
  event.preventDefault();
  const values = new FormData(form);
  const password = String(values.get("password") || "");
  const confirmation = String(values.get("confirmation") || "");
  const inputs = [...form.querySelectorAll("input")];
  const valid = password.length >= 6 && password === confirmation;
  inputs.forEach((input) => input.setAttribute("aria-invalid", String(!valid)));
  if (!valid) {
    inputs.find((input) => input.value.length < 6 || input.name === "confirmation")?.focus();
    return;
  }
  state.forcePasswordBusy = true;
  render();
  try {
    await authApi.completeForcedPasswordChange(password, state.profileUser.employeeId);
    window.location.replace("../login/index.html");
  } catch (error) {
    console.warn("[auth] forced password change failed", error);
    state.forcePasswordBusy = false;
    render();
    root.querySelector('[data-force-password-form] input[name="password"]')?.setAttribute("aria-invalid", "true");
  }
});

function attachShellBehaviors() {
  attachGlobalSearch(root);
  window.addEventListener("tp:unread-change", refreshUnreadIndicators);
  window.addEventListener("storage", (event) => {
    if (event.key !== READ_STATE_STORAGE_KEY) return;
    window.dispatchEvent(new CustomEvent("tp:unread-change"));
  });

  if (mobileViewport) {
    const onViewportChange = (event) => setViewportMode(event.matches);
    if (typeof mobileViewport.addEventListener === "function") mobileViewport.addEventListener("change", onViewportChange);
    else mobileViewport.addListener(onViewportChange);
  }

  if (state.authEnabled && authApi) {
    const refreshStaleCaches = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastResumeRefreshAt < 1_000) return;
      lastResumeRefreshAt = now;
      const snapshotsPath = "../data/live-snapshot-utils.js";
      void Promise.all([
        authApi.getCurrentUser({ refresh: true }),
        import(snapshotsPath).then(({ refreshStaleLiveTables }) => refreshStaleLiveTables())
      ]).catch((error) => console.warn("[live-cache] resume refresh failed", error));
    };
    document.addEventListener("visibilitychange", refreshStaleCaches);
    window.addEventListener("focus", refreshStaleCaches);
  }

  attachMenuBehaviors(document, {
  onSelectLang(code) {
    if (langs.includes(code)) {
      state.lang = code;
      render();
    }
  },
  onBeforeUserPanelOpen(anchor) {
    if (!anchor) return;
    syncProfileUser();
    if (!state.profileUser) return;
    const panel = anchor.querySelector(".user-panel[data-panel-view]");
    if (panel) panel.outerHTML = renderAvatarPanel();
  },
  onProfileSave(values) {
    if (state.authEnabled) return;
    if (!state.profileUser) return;
    state.profileUser = {
      ...state.profileUser,
      name: String(values.name || "").trim(),
      position: String(values.position || "").trim(),
      phone: String(values.phone || "").trim(),
      email: String(values.email || "").trim(),
      note: String(values.note || "").trim()
    };
    renderProfileView();
  },
  onJoinCompany(values) {
    if (state.authEnabled) return;
    const company = state.profileUser?.availableCompanies.find((item) => item.id === values.companyId);
    if (!company) return;
    state.profileJoinRequest = {
      companyId: company.id,
      companyName: company.name,
      note: String(values.note || "").trim(),
      status: "pending"
    };
    renderProfileView();
  },
  onWithdrawJoin() {
    if (state.authEnabled) return;
    state.profileJoinRequest = null;
    renderProfileView();
  },
  async onPasswordChange(values, form) {
    if (!state.authEnabled || !authApi || !state.profileUser?.email) {
      form.closest(".user-panel")?.setAttribute("data-panel-view", "menu");
      return;
    }
    const controls = [...form.querySelectorAll("input")];
    controls.forEach((control) => control.removeAttribute("aria-invalid"));
    try {
      await authApi.signInWithPassword({ email: state.profileUser.email, password: String(values.oldPassword || "") });
      await authApi.updatePassword(String(values.newPassword || ""));
      form.closest(".user-panel")?.setAttribute("data-panel-view", "menu");
      form.reset();
    } catch (error) {
      console.warn("[auth] password change failed", error);
      controls.forEach((control) => control.setAttribute("aria-invalid", "true"));
      controls[0]?.focus();
    }
  },
  async onLogout() {
    if (!state.authEnabled || !authApi) return;
    try {
      await authApi.signOut();
    } finally {
      window.location.replace("../login/index.html");
    }
  }
});
}

async function guardAuthenticatedShell() {
  const authPath = "../data/auth.js";
  authApi = await import(authPath);
  if (!await authApi.isAuthConfigured()) return true;
  state.authEnabled = true;
  const session = await authApi.getSession();
  if (!session) {
    window.location.replace("../login/index.html");
    return false;
  }
  const user = await authApi.getCurrentUser({ refresh: true });
  if (!user) {
    await authApi.signOut();
    window.location.replace("../login/index.html");
    return false;
  }
  const isBizflowPage = window.location.pathname.includes("/bizflow/");
  if (isBizflowPage && !user.isBfAdmin && user.bizflowMainAccess !== true) {
    await authApi.signOut();
    window.location.replace("https://team.honnmono.top");
    return false;
  }
  state.profileUser = { ...user, availableCompanies: user.availableCompanies.map((company) => ({ ...company })) };
  if (window.__shellData) window.__shellData.user = state.profileUser;
  menuItems = buildMenuItems(state.profileUser);
  const switchable = user.switchableCompanies.map((company) => ({ key: company.id, label: company.name }));
  if (switchable.length) {
    companies = switchable;
    state.company = user.activeCompanyId || switchable[0].key;
  }
  state.forcePasswordOpen = user.mustChangePassword === true;
  authSubscription = await authApi.onAuthStateChange((event, nextSession) => {
    if (event === "SIGNED_OUT" || !nextSession) window.location.replace("../login/index.html");
  });
  window.addEventListener("pagehide", () => authSubscription?.unsubscribe(), { once: true });
  return true;
}

async function bootShell() {
  try {
    if (!await guardAuthenticatedShell()) return;
  } catch (error) {
    console.warn("[auth] shell guard failed", error);
    window.location.replace("../login/index.html");
    return;
  }
  render();
  installNavigationPrerender(menuItems);
  attachShellBehaviors();
  if (state.forcePasswordOpen) root.querySelector('[data-force-password-form] input[name="password"]')?.focus();
}

bootShell();
