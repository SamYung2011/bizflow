import { classNames, escapeHtml, icon, pill, redDot, styleVars, titleAttr } from "./shared.js";

const componentClass = (component, variant, extra = []) =>
  classNames("tp-component", component.className, component.mods, variant.mods, extra);

const sizeAttrs = (variant) => styleVars(variant);

const line = (text, className = "tp-line") =>
  `<span class="${className}"${titleAttr(text)}>${escapeHtml(text)}</span>`;

const label = (text) => line(text, "tp-title");

const muted = (text) => line(text, "tp-muted");

const avatarInitial = (t, size = 40) =>
  `<span class="avatar--initial" style="--component-width:${size}px;--component-height:${size}px"${titleAttr(t("content.helen"))}>H</span>`;

const sampleAvatar = (size = 40) =>
  `<span class="avatar avatar--image" style="--component-width:${size}px;--component-height:${size}px"></span>`;

const simpleButton = (className, text, variant, extraMods = []) =>
  `<button class="${classNames(className, variant.mods, extraMods)}"${sizeAttrs(variant)}${titleAttr(text)}>${escapeHtml(text)}</button>`;

function renderTopbar(component, variant, t) {
  const isMobile = variant.key === "mobile";
  return `<div class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    <div class="topbar__brand">
      ${icon("icon-nav-honnmono", "icon icon--frame", t("content.logo"))}
      ${line("HONNMONO", "tp-title")}
    </div>
    <div class="topbar__search">${renderSearchInput(component, { key: "topbar-search", width: 320, height: 40, mods: [] }, t)}</div>
    <div class="${isMobile ? "topbar__mobile-tools" : "topbar__tools"}">
      ${renderMessenger({ className: "btn-messenger" }, { key: "update", width: 40, height: 40, mods: ["btn-messenger--update"] }, t)}
      ${icon("icon-nav-language", "icon", t("content.language"))}
      ${avatarInitial(t, 40)}
      ${isMobile ? renderToggle(component, { key: "open", width: 40, height: 40, mods: ["btn-toggle-sidebar--open"] }, t) : ""}
    </div>
  </div>`;
}

function renderBoardCard(component, variant, t) {
  if (variant.key === "mobile") {
    return `<article class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
      <div class="board-card__metric">
        ${label(t("content.todoBoard"))}
        <span class="tp-number">8</span>
      </div>
      <span class="board-card__divider" aria-hidden="true"></span>
      <div class="board-card__metric">
        ${label(t("content.inProgress"))}
        <span class="tp-number">3</span>
      </div>
    </article>`;
  }
  const showTaskIcon = !variant.key.endsWith("-u");
  return `<article class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    <div>
      ${label(t("content.todoBoard"))}
    </div>
    ${showTaskIcon ? icon("icon-task-list", "icon-task", t("content.task")) : ""}
    <span class="tp-number">${variant.key.includes("mobile") ? "8" : variant.key.includes("blue") ? "24" : "12"}</span>
  </article>`;
}

function renderMenuItem(component, variant, t) {
  return `<div class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    ${icon("icon-nav-inventory", "icon", t("content.inventory"))}
    ${line(t("content.inventory"), "tp-line")}
    ${variant.key.includes("update") ? redDot() : ""}
  </div>`;
}

function renderSearchInput(component, variant, t) {
  const rootClass = component.className?.includes("select") ? "select" : "search-input";
  return `<div class="${classNames("tp-component", rootClass, variant.mods)}"${sizeAttrs(variant)}>
    ${icon("icon-nav-search", "icon", t("content.search"))}
    ${line(t(variant.key === "error" ? "content.searchError" : "content.searchPlaceholder"), "tp-line")}
    ${variant.key === "select" || rootClass === "select" ? icon("icon-arrow-down", "icon-arrow", t("content.open")) : ""}
  </div>`;
}

function renderFixedButton(component, variant, t) {
  const text = variant.key.includes("red") ? t("content.delete") : variant.key.includes("blue") ? t("content.save") : t("content.edit");
  return simpleButton("btn", text, variant);
}

function renderHugButton(component, variant, t) {
  const text = variant.key.includes("red") ? t("content.reject") : variant.key.includes("blue") ? t("content.confirm") : t("content.filter");
  return `<button class="${classNames("btn--hug", variant.mods)}"${sizeAttrs(variant)}${titleAttr(text)}>
    ${escapeHtml(text)}
    ${variant.key.includes("update") ? redDot() : ""}
  </button>`;
}

function renderAvatarInitial(component, variant, t) {
  const size = variant.width || 40;
  return avatarInitial(t, size);
}

function renderAvatar(component, variant, t) {
  const size = variant.width || 40;
  const cls = variant.key === "image" ? "avatar avatar--image" : "avatar";
  return `<span class="${cls}" style="--component-width:${size}px;--component-height:${size}px"${titleAttr(t("content.avatar"))}>H</span>`;
}

function renderMemberTaskRow(component, variant, t) {
  return `<div class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    ${sampleAvatar(40)}
    <div style="min-width:0;flex:1">
      ${label(t("content.projectReview"))}
      ${muted(t("content.helen"))}
    </div>
    ${pill(t("content.inProgress"), "blue")}
    ${variant.key.includes("update") ? redDot() : ""}
  </div>`;
}

function renderTaskItem(component, variant, t) {
  return `<article class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    <div style="min-width:0;flex:1">
      ${label(t("content.taskTitle"))}
      ${variant.key === "home-view" ? "" : muted(t("content.dueLine"))}
      ${variant.key === "Default-信息" ? muted(t("content.assigneeLine")) : ""}
    </div>
    ${pill("3", "red")}
  </article>`;
}

function renderMemberRow(component, variant, t) {
  return `<div class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    ${sampleAvatar(40)}
    <div style="min-width:0">
      ${label(t("content.helen"))}
      ${muted(t("content.designDept"))}
    </div>
  </div>`;
}

function renderAddRow(component, variant, t) {
  return `<button class="${componentClass(component, variant)}"${sizeAttrs(variant)}${titleAttr(t("content.addRow"))}>
    ${icon("icon-add-surface-add", "icon-add", t("content.add"))}
    ${line(t("content.addRow"), "tp-line")}
  </button>`;
}

function renderNewTask(component, variant, t) {
  if (variant.key === "mobile") {
    return `<button class="tp-component fab"${sizeAttrs(variant)}${titleAttr(t("content.newTask"))}>+</button>`;
  }
  return `<button class="tp-component btn-new-task"${sizeAttrs(variant)}${titleAttr(t("content.newTask"))}>+ ${escapeHtml(t("content.newTask"))}</button>`;
}

function renderMemberCard(component, variant, t) {
  if (variant.key === "add") {
    return `<article class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
      ${icon("icon-add-line-add", "icon-add-line icon--frame", t("content.add"))}
      ${label(t("content.addMember"))}
    </article>`;
  }
  return `<article class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    ${sampleAvatar(60)}
    ${label(t("content.helen"))}
    ${muted(t("content.designDept"))}
    ${pill(t(variant.key === "off" ? "content.offDuty" : "content.onDuty"), variant.key === "off" ? "neutral" : "green")}
  </article>`;
}

function renderStatusIcon(component, variant, t) {
  const map = {
    ok: "✓",
    reject: "×",
    error: "!",
    progress: "...",
    none: "-"
  };
  return `<span class="${componentClass(component, variant)}"${sizeAttrs(variant)}${titleAttr(t(`variant.${variant.key}`))}>${escapeHtml(map[variant.key] || "-")}</span>`;
}

function renderInput(component, variant, t) {
  return `<label class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    ${muted(t("content.inputLabel"))}
    <span class="input__control">
      ${line(t(variant.key === "error" ? "content.inputError" : variant.key === "disabled" ? "content.noPermission" : "content.inputValue"), "tp-line")}
      ${icon("icon-arrow-down", "icon-arrow", t("content.open"))}
    </span>
  </label>`;
}

function renderPrint(component, variant, t) {
  return `<button class="${componentClass(component, variant)}"${sizeAttrs(variant)}${titleAttr(t("content.print"))}>
    ${icon("icon-nav-print", "icon", t("content.print"))}
  </button>`;
}

function renderForm(component, variant, t) {
  const isMobile = (variant.width || 0) <= 400;
  const fields = ["content.name", "content.department", "content.phone", "content.email"];
  return `<section class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    ${label(t(component.titleKey || "content.formTitle"))}
    <div class="form-grid ${isMobile ? "form-grid--single" : ""}">
      ${fields.map((key) => renderInput({ className: "input" }, { key: "default", width: isMobile ? 320 : 240, height: 60, mods: [] }, (k) => (k === "content.inputLabel" ? t(key) : t(k)))).join("")}
    </div>
    <div class="form-footer">
      ${simpleButton("btn--hug", t("content.cancel"), { width: 75, height: 35, mods: [] })}
      ${simpleButton("btn--hug", t("content.save"), { width: 75, height: 35, mods: ["btn--hug--blue"] })}
    </div>
  </section>`;
}

function renderDropdownItem(component, variant, t) {
  return `<div class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    ${line(t("content.dropdownOption"), "tp-line")}
    ${variant.key === "selected" ? "✓" : ""}
  </div>`;
}

function renderIcon(component, variant, t) {
  const iconId = variant.icon || component.icon || "icon-nav-home";
  const shellClass = component.kind === "dept-icon" ? classNames("icon-dept-shell", variant.shell) : "";
  const svg = icon(iconId, classNames(component.iconClass || component.className, "icon--frame"), t(variant.labelKey || component.nameKey));
  return shellClass ? `<span class="${shellClass}"${titleAttr(t(variant.labelKey || component.nameKey))}>${svg}</span>` : svg;
}

function renderToggle(component, variant, t) {
  return `<button class="${classNames("tp-component btn-toggle-sidebar", variant.mods)}"${sizeAttrs(variant)}${titleAttr(t("content.toggle"))}>
    ${variant.key === "update" ? redDot() : ""}
  </button>`;
}

function renderMessenger(component, variant, t) {
  return `<button class="${classNames("tp-component btn-messenger", variant.mods)}"${sizeAttrs(variant)}${titleAttr(t("content.message"))}>
    ${icon("icon-nav-messenger", "icon", t("content.message"))}
    ${variant.key.includes("update") ? redDot() : ""}
  </button>`;
}

function renderIconButton(component, variant, t) {
  const iconId = variant.icon || component.icon || "icon-arrow-right";
  return `<button class="${componentClass(component, variant)}"${sizeAttrs(variant)}${titleAttr(t(variant.labelKey || "content.open"))}>
    ${icon(iconId, "icon", t(variant.labelKey || "content.open"))}
    ${variant.key === "update" ? redDot() : ""}
  </button>`;
}

function renderReviewCard(component, variant, t) {
  return `<article class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    ${label(t("content.reviewTitle"))}
    <div style="display:flex;gap:var(--space-20);align-items:center">${sampleAvatar(60)}<div>${label(t("content.helen"))}${muted(t("content.email"))}</div></div>
    <p class="tp-two-line">${escapeHtml(t("content.reviewCopy"))}</p>
    <div class="review-card__actions">
      ${simpleButton("btn--hug", t("content.approve"), { width: 75, height: 35, mods: ["btn--hug--blue"] })}
      ${simpleButton("btn--hug", t("content.reject"), { width: 75, height: 35, mods: ["btn--hug--red"] })}
    </div>
  </article>`;
}

function renderDeptCard(component, variant, t) {
  if (variant.key === "add") {
    return `<article class="${componentClass(component, variant)}"${sizeAttrs(variant)}>${icon("icon-add-line-add", "icon-add-line", t("content.add"))}${label(t("content.addDept"))}</article>`;
  }
  return `<article class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    <div style="display:flex;gap:var(--space-10);align-items:center">${renderIcon({ kind: "dept-icon", className: "icon-dept", iconClass: "icon-dept" }, { icon: "icon-dept-design", shell: "", labelKey: "content.designDept" }, t)}${label(t("content.designDept"))}</div>
    ${muted(t("content.memberCount"))}
    ${pill(t("content.helen"), "blue")}
  </article>`;
}

function renderImageTile(component, variant, t) {
  return `<div class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    ${icon("icon-nav-inventory", "icon icon--frame", t("content.image"))}
    <span class="image-tile__overlay">${icon("icon-edit-default", "icon", t("content.edit"))}</span>
  </div>`;
}

function renderChatBubble(component, variant, t) {
  return `<div class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    <div class="chat-bubble__body">${escapeHtml(t(variant.key.includes("own") ? "content.ownMessage" : "content.otherMessage"))}</div>
  </div>`;
}

function renderMemberPanel(component, variant, t) {
  const active = variant.key;
  return `<section class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    <div class="member-panel__head">${sampleAvatar(60)}<div>${label(t("content.helen"))}${muted(t("content.email"))}</div></div>
    <div class="member-panel__tabs">
      ${["base", "tasking", "tasked"].map((key) => `<span class="tab-chip ${key === active ? "tab-chip--active" : ""}"${titleAttr(t(`variant.${key}`))}>${escapeHtml(t(`variant.${key}`))}</span>`).join("")}
    </div>
    <div class="member-panel__body">${renderTaskItem({ className: "task-item" }, { key: "home-view", width: 360, height: 51, mods: ["task-item--compact"] }, t)}</div>
  </section>`;
}

function renderTaskDetail(component, variant, t) {
  return `<section class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    ${label(t("content.taskDetail"))}
    <div class="task-detail__tabs">
      <span class="tab-chip tab-chip--active">${escapeHtml(t("content.detail"))}</span>
      <span class="tab-chip">${escapeHtml(t("content.feedback"))}</span>
    </div>
    <div class="task-detail__body">
      <div class="task-detail__section">${label(t("content.taskTitle"))}${muted(t("content.dueLine"))}</div>
      ${renderChatBubble({ className: "chat-bubble" }, { key: "other", width: 337, height: 54, mods: [] }, t)}
      ${renderChatBubble({ className: "chat-bubble" }, { key: "own", width: 337, height: 54, mods: ["chat-bubble--own"] }, t)}
    </div>
  </section>`;
}

function renderTaskSubmit(component, variant, t) {
  return `<section class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    ${label(t("content.submitTask"))}
    <div class="form-task-submit__body">
      ${renderInput({ className: "input" }, { key: "default", width: Math.min((variant.width || 360) - 40, 360), height: 60, mods: [] }, t)}
      ${renderAddRow({ className: "add-row" }, { key: "default", width: Math.min((variant.width || 360) - 40, 360), height: 40, mods: [] }, t)}
      ${renderTaskItem({ className: "task-item" }, { key: "Default", width: Math.min((variant.width || 360) - 40, 360), height: 84, mods: [] }, t)}
    </div>
  </section>`;
}

function renderKanban(component, variant, t) {
  const tone = variant.key.split("-")[0];
  const openState = variant.key.split("-")[1];
  const taskCount = openState === "close" ? 0 : openState === "less" ? 1 : 3;
  const width = Math.min((variant.width || 373) - 20, 360);
  return `<section class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    <div class="kanban-column__head">
      ${label(t(`content.${tone}Priority`))}
      ${pill(String(taskCount), tone === "red" ? "red" : tone === "green" ? "green" : "blue")}
    </div>
    <div class="kanban-column__stack">
      ${Array.from({ length: taskCount }, () => renderTaskItem({ className: "task-item" }, { key: "home-view", width, height: 51, mods: ["task-item--compact"] }, t)).join("")}
      ${openState !== "close" ? renderAddRow({ className: "add-row" }, { key: "default", width, height: 40, mods: [] }, t) : ""}
    </div>
  </section>`;
}

function renderOrder(component, variant, t) {
  const status = variant.key.includes("cancelled") ? "cancelled" : variant.key.includes("progress") ? "inProgress" : "completed";
  return `<div class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    <div style="display:flex;align-items:center;gap:var(--space-10);min-width:0">
      ${renderStatusIcon({ className: "status-icon" }, { key: status === "completed" ? "ok" : status === "cancelled" ? "reject" : "progress", width: 40, height: 40, mods: [`status-icon--${status === "completed" ? "ok" : status === "cancelled" ? "reject" : "progress"}`] }, t)}
      <div style="min-width:0">${label(t("content.orderNo"))}${muted(t(`content.${status}`))}</div>
    </div>
    ${renderPrint({ className: "btn-print" }, { key: "active", width: 40, height: 40, mods: ["btn-print--active"] }, t)}
  </div>`;
}

function renderUserPanel(component, variant, t) {
  const body = variant.key === "password"
    ? renderInput({ className: "input" }, { key: "default", width: 320, height: 60, mods: [] }, (k) => (k === "content.inputLabel" ? t("content.password") : t(k)))
    : variant.key === "profile"
      ? renderInput({ className: "input" }, { key: "focus", width: 320, height: 60, mods: ["input--focus"] }, (k) => (k === "content.inputLabel" ? t("content.name") : t(k)))
      : `<div class="dropdown-item" style="--component-width:320px;--component-height:39px">${line(t("content.profile"), "tp-line")}</div><div class="dropdown-item" style="--component-width:320px;--component-height:39px">${line(t("content.password"), "tp-line")}</div>`;
  return `<section class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    <div class="user-panel__head">${avatarInitial(t, 60)}<div>${label(t("content.helen"))}${muted(t("content.email"))}</div></div>
    ${body}
    ${simpleButton("btn--hug", t("content.logout"), { width: 100, height: 35, mods: [] })}
  </section>`;
}

function renderBadge(component, variant, t) {
  return `<span class="${componentClass(component, variant)}"${sizeAttrs(variant)}>${escapeHtml(t("content.noBadge"))}</span>`;
}

function renderCustomerRow(component, variant, t) {
  return `<div class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    <div style="min-width:0">${label(t("content.customerName"))}${muted(t("content.phone"))}</div>
    ${pill(t("content.activeCustomer"), "green")}
    ${simpleButton("btn", t("content.edit"), { width: 36, height: 39, mods: [] })}
  </div>`;
}

function renderModal(component, variant, t) {
  return `<section class="${componentClass(component, variant)}"${sizeAttrs(variant)}>
    ${label(t(component.titleKey || "content.modalTitle"))}
    ${renderInput({ className: "input" }, { key: "default", width: Math.min((variant.width || 320) - 40, 360), height: 60, mods: [] }, t)}
    ${renderInput({ className: "input" }, { key: "focus", width: Math.min((variant.width || 320) - 40, 360), height: 60, mods: ["input--focus"] }, t)}
    <div class="form-footer">
      ${simpleButton("btn--hug", t("content.cancel"), { width: 75, height: 35, mods: [] })}
      ${simpleButton("btn--hug", t("content.save"), { width: 75, height: 35, mods: ["btn--hug--blue"] })}
    </div>
  </section>`;
}

export function renderComponent(component, variant, t) {
  switch (component.kind) {
    case "topbar":
      return renderTopbar(component, variant, t);
    case "board-card":
      return renderBoardCard(component, variant, t);
    case "menu-item":
      return renderMenuItem(component, variant, t);
    case "field":
      return renderSearchInput(component, variant, t);
    case "fixed-button":
      return renderFixedButton(component, variant, t);
    case "hug-button":
      return renderHugButton(component, variant, t);
    case "avatar-initial":
      return renderAvatarInitial(component, variant, t);
    case "avatar":
      return renderAvatar(component, variant, t);
    case "member-task-row":
      return renderMemberTaskRow(component, variant, t);
    case "task-item":
      return renderTaskItem(component, variant, t);
    case "member-row":
      return renderMemberRow(component, variant, t);
    case "add-row":
      return renderAddRow(component, variant, t);
    case "new-task":
      return renderNewTask(component, variant, t);
    case "member-card":
      return renderMemberCard(component, variant, t);
    case "status-icon":
      return renderStatusIcon(component, variant, t);
    case "input":
      return renderInput(component, variant, t);
    case "print":
      return renderPrint(component, variant, t);
    case "form":
      return renderForm(component, variant, t);
    case "dropdown-item":
      return renderDropdownItem(component, variant, t);
    case "icon":
    case "dept-icon":
      return renderIcon(component, variant, t);
    case "toggle":
      return renderToggle(component, variant, t);
    case "messenger":
      return renderMessenger(component, variant, t);
    case "icon-button":
      return renderIconButton(component, variant, t);
    case "review-card":
      return renderReviewCard(component, variant, t);
    case "dept-card":
      return renderDeptCard(component, variant, t);
    case "image-tile":
      return renderImageTile(component, variant, t);
    case "chat-bubble":
      return renderChatBubble(component, variant, t);
    case "member-panel":
      return renderMemberPanel(component, variant, t);
    case "task-detail":
      return renderTaskDetail(component, variant, t);
    case "task-submit":
      return renderTaskSubmit(component, variant, t);
    case "kanban":
      return renderKanban(component, variant, t);
    case "order-row":
      return renderOrder(component, variant, t);
    case "user-panel":
      return renderUserPanel(component, variant, t);
    case "badge":
      return renderBadge(component, variant, t);
    case "customer-row":
      return renderCustomerRow(component, variant, t);
    case "modal":
      return renderModal(component, variant, t);
    default:
      return `<div class="${componentClass(component, variant)}"${sizeAttrs(variant)}>${label(t(component.nameKey))}</div>`;
  }
}
