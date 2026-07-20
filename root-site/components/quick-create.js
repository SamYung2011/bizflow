import { navigationPresetKeys, setNavigationPreset } from "./navigation-presets.js";

const ACTIONS = Object.freeze({
  task: {
    href: "/team/index.html",
    labelKey: "quickCreate.task",
    icon: "icon-nav-task",
    preset: [navigationPresetKeys.taskCreate, "1"]
  },
  order: {
    href: "/bizflow/orders-create.html",
    labelKey: "quickCreate.order",
    icon: "icon-nav-list"
  },
  customer: {
    href: "/bizflow/customers.html",
    labelKey: "quickCreate.customer",
    icon: "icon-nav-user",
    preset: [navigationPresetKeys.customersAdd, "1"]
  }
});

export function availableQuickCreateActions(user) {
  const authenticated = typeof user?.hasPermission === "function";
  const canCreateTask = !authenticated || user.hasPermission("can_create_task");
  const canUseBizflow = !authenticated || user.isBfAdmin === true || user.bizflowMainAccess === true;
  return [
    ...(canCreateTask ? ["task"] : []),
    ...(canUseBizflow ? ["order", "customer"] : [])
  ];
}

export function attachQuickCreate({ root, getUser, t, icon, escapeHtml, onOpen } = {}) {
  let panel = null;
  let returnFocus = null;

  function close({ restoreFocus = true } = {}) {
    panel?.remove();
    panel = null;
    document.querySelectorAll("[data-quick-create-open]").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
    if (restoreFocus && returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus());
    returnFocus = null;
  }

  function position(anchor) {
    const menu = panel?.querySelector("[data-quick-create-menu]");
    if (!menu || matchMedia("(max-width: 768px)").matches) return;
    const rect = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const gap = 10;
    const left = Math.min(Math.max(gap, rect.left), window.innerWidth - width - gap);
    const below = rect.bottom + gap;
    const top = below + height <= window.innerHeight - gap
      ? below
      : Math.max(gap, rect.top - height - gap);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function render(anchor, actionKeys) {
    const items = actionKeys.map((key) => {
      const action = ACTIONS[key];
      const label = t(action.labelKey);
      return `<a class="quick-create__item" href="${escapeHtml(action.href)}" data-quick-create-action="${escapeHtml(key)}" role="menuitem" title="${escapeHtml(label)}">
        ${icon(action.icon, "icon")}
        <span>${escapeHtml(label)}</span>
      </a>`;
    }).join("");
    root.insertAdjacentHTML("beforeend", `<div class="quick-create" data-quick-create-portal>
      <button type="button" class="quick-create__overlay" data-quick-create-close tabindex="-1" aria-label="${escapeHtml(t("quickCreate.close"))}"></button>
      <section class="tp-component quick-create__menu" data-quick-create-menu role="menu" aria-label="${escapeHtml(t("quickCreate.title"))}">
        <header><strong>${escapeHtml(t("quickCreate.title"))}</strong><button type="button" data-quick-create-close aria-label="${escapeHtml(t("quickCreate.close"))}">×</button></header>
        <div>${items}</div>
      </section>
    </div>`);
    panel = root.querySelector("[data-quick-create-portal]");
    position(anchor);
    requestAnimationFrame(() => panel?.querySelector("[data-quick-create-action]")?.focus());
  }

  function open(anchor) {
    const actionKeys = availableQuickCreateActions(getUser?.());
    if (!anchor || !actionKeys.length) return;
    if (panel && returnFocus === anchor) {
      close();
      return;
    }
    close({ restoreFocus: false });
    onOpen?.();
    returnFocus = anchor;
    anchor.setAttribute("aria-expanded", "true");
    render(anchor, actionKeys);
  }

  function onClick(event) {
    const trigger = event.target.closest("[data-quick-create-open]");
    if (trigger) {
      event.preventDefault();
      open(trigger);
      return;
    }
    const actionLink = event.target.closest("[data-quick-create-action]");
    if (actionLink) {
      const action = ACTIONS[actionLink.getAttribute("data-quick-create-action")];
      if (action?.preset) setNavigationPreset(...action.preset);
      close({ restoreFocus: false });
      return;
    }
    if (event.target.closest("[data-quick-create-close]") || (panel && !event.target.closest("[data-quick-create-menu]"))) close();
  }

  function onKeydown(event) {
    if (!panel) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...panel.querySelectorAll("a[href], button:not([disabled])")].filter((element) => element.tabIndex >= 0);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onResize() {
    if (!panel || !returnFocus?.isConnected) return;
    position(returnFocus);
  }

  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", onResize);
  return Object.freeze({ close, dispose() {
    close({ restoreFocus: false });
    document.removeEventListener("click", onClick);
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("resize", onResize);
  } });
}
