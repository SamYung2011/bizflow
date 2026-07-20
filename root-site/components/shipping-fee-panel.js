export function createShippingFeePanel() {
  let panel = null;
  let returnFocus = null;
  let helpers = null;
  let mode = "free";
  let amount = "";

  function focusableControls() {
    return panel ? [...panel.querySelectorAll("button:not([disabled]), input:not([disabled])")] : [];
  }

  function position() {
    const dialog = panel?.querySelector("[data-shipping-fee-dialog]");
    if (!dialog || !returnFocus?.isConnected || matchMedia("(max-width: 768px)").matches) return;
    const rect = returnFocus.getBoundingClientRect();
    const gap = 10;
    const left = Math.min(Math.max(gap, rect.left), window.innerWidth - dialog.offsetWidth - gap);
    const below = rect.bottom + gap;
    const top = below + dialog.offsetHeight <= window.innerHeight - gap
      ? below
      : Math.max(gap, rect.top - dialog.offsetHeight - gap);
    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
  }

  function detach() {
    document.removeEventListener("click", onClick);
    document.removeEventListener("input", onInput);
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("resize", position);
  }

  function close({ restoreFocus = true } = {}) {
    detach();
    panel?.remove();
    panel = null;
    document.querySelectorAll("[data-shipping-fee-trigger]").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
    if (restoreFocus && returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus());
    returnFocus = null;
    helpers = null;
  }

  function render({ focusAmount = false } = {}) {
    if (!helpers) return;
    const { escapeHtml, t } = helpers;
    panel?.remove();
    document.body.insertAdjacentHTML("beforeend", `<div class="shipping-fee-panel" data-shipping-fee-panel>
      <button type="button" class="shipping-fee-panel__overlay" data-shipping-fee-close tabindex="-1" aria-label="${escapeHtml(t("orders.shippingFee.close"))}"></button>
      <section class="tp-component shipping-fee-panel__dialog" data-shipping-fee-dialog role="dialog" aria-modal="true" aria-label="${escapeHtml(t("orders.shippingFee.title"))}">
        <header><strong>${escapeHtml(t("orders.shippingFee.title"))}</strong><button type="button" data-shipping-fee-close aria-label="${escapeHtml(t("orders.shippingFee.close"))}">×</button></header>
        <button type="button" class="shipping-fee-panel__choice${mode === "free" ? " is-selected" : ""}" data-shipping-fee-mode="free" aria-pressed="${mode === "free"}">${escapeHtml(t("orders.free"))}<span>HKD$ 0.00</span></button>
        <button type="button" class="shipping-fee-panel__choice${mode === "custom" ? " is-selected" : ""}" data-shipping-fee-mode="custom" aria-pressed="${mode === "custom"}">${escapeHtml(t("orders.shippingFee.custom"))}</button>
        <label class="shipping-fee-panel__amount"><span>${escapeHtml(t("orders.shippingFee.amount"))}</span><span><b>HKD$</b><input type="number" min="0" step="0.01" data-shipping-fee-draft value="${escapeHtml(amount)}"${mode === "custom" ? "" : " disabled"}></span></label>
        <footer><button type="button" class="btn--hug btn--hug--gray" data-shipping-fee-close>${escapeHtml(t("orders.cancel"))}</button><button type="button" class="btn--hug btn--hug--blue" data-shipping-fee-confirm>${escapeHtml(t("orders.shippingFee.confirm"))}</button></footer>
      </section>
    </div>`);
    panel = document.querySelector("[data-shipping-fee-panel]");
    position();
    requestAnimationFrame(() => {
      const target = focusAmount ? panel?.querySelector("[data-shipping-fee-draft]") : panel?.querySelector(`[data-shipping-fee-mode="${mode}"]`);
      target?.focus();
    });
  }

  function onClick(event) {
    const modeButton = event.target.closest("[data-shipping-fee-mode]");
    if (modeButton) {
      mode = modeButton.getAttribute("data-shipping-fee-mode") === "custom" ? "custom" : "free";
      if (mode === "free") amount = "0";
      render({ focusAmount: mode === "custom" });
      return;
    }
    if (event.target.closest("[data-shipping-fee-confirm]")) {
      const value = mode === "free" ? 0 : Math.max(0, Number(amount) || 0);
      const commit = helpers?.onCommit;
      close({ restoreFocus: false });
      commit?.(value);
      requestAnimationFrame(() => document.querySelector("[data-shipping-fee-trigger]")?.focus());
      return;
    }
    if (event.target.closest("[data-shipping-fee-close]") || (panel && !event.target.closest("[data-shipping-fee-dialog]"))) close();
  }

  function onInput(event) {
    const input = event.target.closest("[data-shipping-fee-draft]");
    if (input) amount = input.value;
  }

  function onKeydown(event) {
    if (!panel) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = focusableControls();
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  function open({ anchor, value = 0, escapeHtml, t, onCommit } = {}) {
    if (!anchor) return;
    close({ restoreFocus: false });
    returnFocus = anchor;
    helpers = { escapeHtml, t, onCommit };
    const numeric = Math.max(0, Number(value) || 0);
    mode = numeric === 0 ? "free" : "custom";
    amount = numeric === 0 ? "" : String(numeric);
    anchor.setAttribute("aria-expanded", "true");
    render({ focusAmount: mode === "custom" });
    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", position);
  }

  return Object.freeze({ open, close, isOpen: () => panel !== null, dispose: () => close({ restoreFocus: false }) });
}
