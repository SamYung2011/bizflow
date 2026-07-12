// menus.js — 顶栏浮层组件构造器 + 交互
// Figma 真值:
//   语言下拉  = Frame 784 容器 (r20 / pad10 / gray-5 底 / 宽280) + 弹窗按钮 506:14878 (dropdown-item) 选项行
//               状态取自组件母版:Default 透明 / hover gray-10+蓝字 / state2(当前) 实蓝底+白字 / 不可选 gray
//   用户面板  = Frame 786 = 538:18828 (400 宽 / 白底 r20 / 三内容态,菜单态 404 高)
//               头部 60px 首字母头像 + 姓名 + 邮箱 + 编辑钮;分隔线;当前权限段;底部蓝主钮 + 深灰退出钮
// 纯 ES module,无框架。样式只引 tokens 变量与既有组件类(.dropdown-item / .user-panel / .avatar--initial),
// 新样式见 menus.css。

import { icon, escapeHtml } from "./shared.js";

function identity(value) {
  return value;
}

function pickInitial(name, initial) {
  if (initial) return String(initial).trim().charAt(0).toUpperCase();
  const trimmed = String(name || "").trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

// 语言下拉 (Frame 784) —— langs: [{ code, label }], current: 当前语言 code, t: 文案字典
//   placement: "end"(默认,右对齐锚点=顶栏 globe 场景) | "start"(左对齐锚点=侧栏场景)
export function renderLanguageMenu({ langs = [], current = "", t = identity, placement = "end" } = {}) {
  const translate = typeof t === "function" ? t : identity;
  const placementClass = placement === "start" ? " menu-popover--start" : "";
  const options = langs
    .map((lang) => {
      const code = lang && lang.code != null ? String(lang.code) : "";
      const label = lang && lang.label != null ? String(lang.label) : code;
      const isCurrent = code !== "" && code === String(current);
      const className = [
        "dropdown-item",
        "lang-menu__item",
        isCurrent ? "dropdown-item--current" : ""
      ]
        .filter(Boolean)
        .join(" ");
      const ariaCurrent = isCurrent ? ' aria-current="true"' : "";
      return `<button type="button" class="${className}" role="option" data-lang="${escapeHtml(code)}" aria-selected="${isCurrent}"${ariaCurrent} title="${escapeHtml(label)}">
      <span class="tp-line">${escapeHtml(label)}</span>
    </button>`;
    })
    .join("\n    ");

  return `<div class="tp-component menu-popover lang-menu${placementClass}" data-menu-popover role="listbox" aria-label="${escapeHtml(translate("menu.language"))}">
    ${options}
  </div>`;
}

// 用户面板 (Frame 786) —— user: { name, email, initial, company, role }, t: 文案字典
// 三态照 Figma 538:18828 母版集实装:
//   菜单态 538:18827 (400×404)  = 当前权限 + 修改密码/退出登入
//   密码态 538:18829 (400×492)  = 舊密碼(聚焦) + 新密碼(占位) + 確認修改/返回
//   基本信息态 538:18878 (400×580) = 姓名(聚焦) + 職位/Email(占位) + 確認修改/返回
// 态切换 = 根节点 data-panel-view 属性(menu↔password↔profile),交互见 attachMenuBehaviors。
export function renderUserPanel({ user = {}, t = identity, links = [], joinRequest = null, profileReadOnly = false } = {}) {
  const translate = typeof t === "function" ? t : identity;
  const name = user && user.name != null ? String(user.name) : "";
  const email = user && user.email != null ? String(user.email) : "";
  const company = user && user.company != null ? String(user.company) : "";
  const role = user && user.role != null ? String(user.role) : "";
  const position = user && user.position != null ? String(user.position) : "";
  const phone = user && user.phone != null ? String(user.phone) : "";
  const note = user && user.note != null ? String(user.note) : "";
  const availableCompanies = Array.isArray(user?.availableCompanies) ? user.availableCompanies : [];
  const initial = pickInitial(name, user && user.initial);

  function field(label, { value = "", placeholder = "", focus = false } = {}) {
    const body = value
      ? `<span class="user-panel__field-value">${escapeHtml(value)}</span>`
      : `<span class="user-panel__field-ph">${escapeHtml(placeholder)}</span>`;
    return `<div class="user-panel__field-group">
        <span class="user-panel__label">${escapeHtml(label)}</span>
        <div class="user-panel__field${focus ? " user-panel__field--focus" : ""}">${body}</div>
      </div>`;
  }

  const linksHtml = Array.isArray(links) && links.length
    ? `<div class="user-panel__section user-panel__links">
        ${links.map((l) => `<a class="dropdown-item user-panel__link" href="${escapeHtml(l.href)}" title="${escapeHtml(l.label)}"><span class="tp-line">${escapeHtml(l.label)}</span></a>`).join("")}
      </div>`
    : "";
  const profileField = (label, name, value, { type = "text", multiline = false } = {}) => `<label class="user-panel__field-group">
      <span class="user-panel__label">${escapeHtml(label)}</span>
      ${multiline
        ? `<textarea class="user-panel__field-control" name="${escapeHtml(name)}"${profileReadOnly ? " disabled" : ""}>${escapeHtml(value)}</textarea>`
        : `<input class="user-panel__field-control" name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}"${profileReadOnly ? " disabled" : ""}>`}
    </label>`;
  const companyOptions = availableCompanies.map((company) =>
    `<option value="${escapeHtml(company.id)}">${escapeHtml(company.name)}</option>`).join("");
  const joinCompany = joinRequest
    ? `<article class="user-panel__join-status" data-profile-join-status="pending"><div><strong>${escapeHtml(joinRequest.companyName)}</strong><span>${escapeHtml(translate("menu.joinPending"))}</span></div>${joinRequest.note ? `<p>${escapeHtml(joinRequest.note)}</p>` : ""}<button type="button" class="user-panel__action user-panel__action--exit" data-profile-join-withdraw>${escapeHtml(translate("menu.withdrawJoin"))}</button></article>`
    : `<form class="user-panel__join-form" data-profile-join-form>
        <label class="user-panel__field-group"><span class="user-panel__label">${escapeHtml(translate("menu.company"))}</span><select class="user-panel__field-control" name="companyId"${availableCompanies.length && !profileReadOnly ? "" : " disabled"}>${companyOptions || `<option value="">${escapeHtml(translate("menu.noCompanies"))}</option>`}</select></label>
        ${profileField(translate("menu.joinNote"), "note", "", { multiline: true })}
        <button type="submit" class="user-panel__action user-panel__action--primary"${availableCompanies.length && !profileReadOnly ? "" : " disabled"}>${escapeHtml(translate("menu.submitJoin"))}</button>
      </form>`;
  const passwordView = profileReadOnly
    ? `<form class="user-panel__form" data-password-form>
        <label class="user-panel__field-group"><span class="user-panel__label">${escapeHtml(translate("menu.oldPassword"))}</span><input class="user-panel__field-control" name="oldPassword" type="password" required minlength="6" autocomplete="current-password"></label>
        <label class="user-panel__field-group"><span class="user-panel__label">${escapeHtml(translate("menu.newPassword"))}</span><input class="user-panel__field-control" name="newPassword" type="password" required minlength="6" autocomplete="new-password" placeholder="${escapeHtml(translate("menu.newPasswordPlaceholder"))}"></label>
        <div class="user-panel__footer">
          <button type="submit" class="user-panel__action user-panel__action--primary">${escapeHtml(translate("menu.confirmChange"))}</button>
          <button type="button" class="user-panel__action user-panel__action--exit" data-panel-view="menu">${escapeHtml(translate("menu.back"))}</button>
        </div>
      </form>`
    : `<div class="user-panel__form">
        ${field(translate("menu.oldPassword"), { value: "············", focus: true })}
        ${field(translate("menu.newPassword"), { placeholder: translate("menu.newPasswordPlaceholder") })}
      </div>
      <div class="user-panel__footer">
        <button type="button" class="user-panel__action user-panel__action--primary" data-panel-view="menu">${escapeHtml(translate("menu.confirmChange"))}</button>
        <button type="button" class="user-panel__action user-panel__action--exit" data-panel-view="menu">${escapeHtml(translate("menu.back"))}</button>
      </div>`;

  return `<div class="tp-component menu-popover user-panel user-panel--menu" data-menu-popover data-panel-view="menu" role="menu" aria-label="${escapeHtml(translate("menu.user"))}">
    <div class="user-panel__head">
      <span class="avatar avatar--initial user-panel__avatar" aria-hidden="true">${escapeHtml(initial)}</span>
      <span class="user-panel__id">
        <span class="tp-title user-panel__name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <span class="user-panel__email" title="${escapeHtml(email)}">${escapeHtml(email)}</span>
      </span>
      <button type="button" class="user-panel__edit" data-panel-view="profile" aria-label="${escapeHtml(translate("menu.edit"))}">
        ${icon("icon-edit-default", "icon icon--sm")}
      </button>
    </div>

    <div class="user-panel__divider" role="separator"></div>

    <div class="user-panel__view user-panel__view--menu">
      <div class="user-panel__section">
        <p class="user-panel__label">${escapeHtml(translate("menu.currentRole"))}</p>
        <div class="user-panel__perm">
          <span class="tp-line">${escapeHtml(company)}</span>
          <span class="user-panel__role">${escapeHtml(role)}</span>
        </div>
      </div>
      ${linksHtml}
      <div class="user-panel__footer">
        <button type="button" class="user-panel__action user-panel__action--primary" data-panel-view="password">${escapeHtml(translate("menu.changePassword"))}</button>
        <button type="button" class="user-panel__action user-panel__action--exit" data-menu-action="logout">${escapeHtml(translate("menu.logout"))}</button>
      </div>
    </div>

    <div class="user-panel__view user-panel__view--password">
      ${passwordView}
    </div>

    <div class="user-panel__view user-panel__view--profile">
      <form class="user-panel__form" data-profile-form>
        ${profileField(translate("menu.name"), "name", name)}
        ${profileField(translate("menu.position"), "position", position)}
        ${profileField(translate("menu.phone"), "phone", phone)}
        ${profileField(translate("menu.email"), "email", email, { type: "email" })}
        ${profileField(translate("menu.note"), "note", note, { multiline: true })}
        <button type="submit" class="user-panel__action user-panel__action--primary"${profileReadOnly ? " disabled" : ""}>${escapeHtml(translate("menu.saveProfile"))}</button>
      </form>
      <div class="user-panel__divider" role="separator"></div>
      <section class="user-panel__join"><h3>${escapeHtml(translate("menu.joinCompany"))}</h3>${joinCompany}</section>
      <button type="button" class="user-panel__action user-panel__action--exit" data-panel-view="menu">${escapeHtml(translate("menu.back"))}</button>
    </div>
  </div>`;
}

// 交互:点击开合 / 点外部关闭 / Esc 关闭 / 语言项点击回调 onSelectLang(code, itemEl)
// 约定结构:锚点 [data-menu] 内含 触发器 [data-menu-trigger] 与 浮层 [data-menu-popover]。
// 事件委托挂在 document 上,故 popover innerHTML 重渲染不会失效;返回 detach() 供清理。
export function attachMenuBehaviors(root, { onSelectLang, onBeforeUserPanelOpen, onProfileSave, onJoinCompany, onWithdrawJoin, onPasswordChange, onLogout } = {}) {
  if (!root) return function detach() {};

  function eachAnchor(fn) {
    root.querySelectorAll("[data-menu]").forEach(fn);
  }

  // 视口防溢:开合时测浮层 rect,溢出右/左缘就沿 x 轴纠偏(CSS 方案兜底,见 menus.css --menu-nudge)。
  function clampIntoViewport(popover) {
    if (!popover) return;
    popover.style.removeProperty("--menu-nudge");
    const gap = 10;
    const rect = popover.getBoundingClientRect();
    let nudge = 0;
    if (rect.right > window.innerWidth - gap) nudge = window.innerWidth - gap - rect.right;
    else if (rect.left < gap) nudge = gap - rect.left;
    if (nudge) popover.style.setProperty("--menu-nudge", `${Math.round(nudge)}px`);
  }

  function setOpen(anchor, open) {
    const popover = anchor.querySelector("[data-menu-popover]");
    const trigger = anchor.querySelector("[data-menu-trigger]");
    if (popover) {
      popover.classList.toggle("menu-popover--open", open);
      if (open) clampIntoViewport(popover);
    }
    if (trigger) trigger.setAttribute("aria-expanded", String(open));
    // 关闭用户面板时复位到菜单态,下次打开从菜单态起手。
    if (!open) {
      const panel = anchor.querySelector(".user-panel[data-panel-view]");
      if (panel) panel.setAttribute("data-panel-view", "menu");
    }
  }

  function closeAll(exceptAnchor) {
    eachAnchor((anchor) => {
      if (anchor !== exceptAnchor) setOpen(anchor, false);
    });
  }

  function highlightLang(menu, itemEl) {
    menu.querySelectorAll("[data-lang]").forEach((el) => {
      const on = el === itemEl;
      el.classList.toggle("dropdown-item--current", on);
      el.setAttribute("aria-selected", String(on));
      if (on) el.setAttribute("aria-current", "true");
      else el.removeAttribute("aria-current");
    });
  }

  function onDocClick(event) {
    const logout = event.target.closest('[data-menu-action="logout"]');
    if (logout && root.contains(logout)) {
      if (typeof onLogout === "function") onLogout();
      return;
    }

    const trigger = event.target.closest("[data-menu-trigger]");
    if (trigger && root.contains(trigger)) {
      const anchor = trigger.closest("[data-menu]");
      if (trigger.classList.contains("shell-avatar-trigger") && typeof onBeforeUserPanelOpen === "function") {
        onBeforeUserPanelOpen(anchor, trigger);
      }
      const popover = anchor && anchor.querySelector("[data-menu-popover]");
      const willOpen = !!popover && !popover.classList.contains("menu-popover--open");
      closeAll(willOpen ? anchor : null);
      if (anchor) setOpen(anchor, willOpen);
      return;
    }

    const withdrawJoin = event.target.closest("[data-profile-join-withdraw]");
    if (withdrawJoin && root.contains(withdrawJoin)) {
      if (typeof onWithdrawJoin === "function") onWithdrawJoin();
      return;
    }

    // 用户面板态切换(修改密码 / 编辑基本信息 / 返回);停在浮层内,不关闭。
    const viewBtn = event.target.closest("[data-panel-view]");
    if (viewBtn && root.contains(viewBtn)) {
      const nextView = viewBtn.getAttribute("data-panel-view");
      const anchor = viewBtn.closest("[data-menu]");
      if (nextView === "profile" && typeof onBeforeUserPanelOpen === "function") {
        onBeforeUserPanelOpen(anchor, viewBtn);
      }
      const panel = anchor?.querySelector(".user-panel[data-panel-view]") ?? viewBtn.closest(".user-panel[data-panel-view]");
      if (panel) panel.setAttribute("data-panel-view", nextView);
      return;
    }

    const langItem = event.target.closest("[data-lang]");
    if (langItem && root.contains(langItem)) {
      const menu = langItem.closest("[data-menu-popover]");
      if (menu) highlightLang(menu, langItem);
      if (typeof onSelectLang === "function") {
        onSelectLang(langItem.getAttribute("data-lang"), langItem);
      }
      closeAll(null);
      return;
    }

    // 点浮层内部的其它内容:不关闭;点浮层外部:全部关闭
    if (!event.target.closest("[data-menu-popover]")) {
      closeAll(null);
    }
  }

  function onKeydown(event) {
    if (event.key === "Escape") closeAll(null);
  }

  function onSubmit(event) {
    const profileForm = event.target.closest("[data-profile-form]");
    const joinForm = event.target.closest("[data-profile-join-form]");
    const passwordForm = event.target.closest("[data-password-form]");
    if (!profileForm && !joinForm && !passwordForm) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    if (profileForm && typeof onProfileSave === "function") onProfileSave(values);
    if (joinForm && typeof onJoinCompany === "function") onJoinCompany(values);
    if (passwordForm && typeof onPasswordChange === "function") onPasswordChange(values, passwordForm);
  }

  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("submit", onSubmit);

  return function detach() {
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("submit", onSubmit);
  };
}
