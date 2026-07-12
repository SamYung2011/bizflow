import { escapeHtml } from "../../components/shared.js";
import { printInvoice } from "./print-invoice.js";

const copy = {
  zh: {
    select: "選擇列印內容",
    invoice: "打印發票",
    receipt: "打印收據",
    cancel: "取消",
    confirm: "確認列印",
    close: "關閉",
    blocked: "瀏覽器已阻擋彈出視窗，請允許本網站開啟彈窗後再試。",
    unavailable: "無法載入此訂單的完整資料，暫不能列印。"
  },
  en: {
    select: "Select print content",
    invoice: "Print invoice",
    receipt: "Print receipt",
    cancel: "Cancel",
    confirm: "Confirm print",
    close: "Close",
    blocked: "The browser blocked the print window. Allow pop-ups for this site and try again.",
    unavailable: "The complete order data could not be loaded, so printing is unavailable."
  },
  fr: {
    select: "Choisir le contenu à imprimer",
    invoice: "Imprimer facture",
    receipt: "Imprimer reçu",
    cancel: "Annuler",
    confirm: "Confirmer l’impression",
    close: "Fermer",
    blocked: "Le navigateur a bloqué la fenêtre d’impression. Autorisez les fenêtres contextuelles pour ce site, puis réessayez.",
    unavailable: "Les données complètes de la commande n’ont pas pu être chargées. L’impression est indisponible."
  }
};

export function createPrintDialog({ getLang = () => "zh" } = {}) {
  const state = {
    open: false,
    order: null,
    trigger: "both",
    mode: { invoice: true, receipt: true },
    errorKey: "",
    opener: null
  };

  function text(key) {
    const lang = getLang();
    return copy[lang]?.[key] ?? copy.zh[key] ?? key;
  }

  function titleKey() {
    if (state.trigger === "invoice") return "invoice";
    if (state.trigger === "receipt") return "receipt";
    return "select";
  }

  function canPrint() {
    return !!state.order && (state.mode.invoice || state.mode.receipt);
  }

  function render() {
    document.querySelector("[data-print-dialog-root]")?.remove();
    if (!state.open) return;
    document.body.insertAdjacentHTML("beforeend", `<div class="print-dialog-overlay" data-print-dialog-root>
      <section class="print-dialog" role="dialog" aria-modal="true" aria-labelledby="print-dialog-title">
        <header class="print-dialog__head">
          <h2 class="print-dialog__title" id="print-dialog-title">${escapeHtml(text(titleKey()))}</h2>
          <button type="button" class="print-dialog__close" data-print-dialog-close aria-label="${escapeHtml(text("close"))}"></button>
        </header>
        <div class="print-dialog__options">
          <label class="print-dialog__option">
            <input type="checkbox" data-print-dialog-option="invoice"${state.mode.invoice ? " checked" : ""}>
            <span>${escapeHtml(text("invoice"))}</span>
          </label>
          <label class="print-dialog__option">
            <input type="checkbox" data-print-dialog-option="receipt"${state.mode.receipt ? " checked" : ""}>
            <span>${escapeHtml(text("receipt"))}</span>
          </label>
        </div>
        ${state.errorKey ? `<p class="print-dialog__error" role="alert">${escapeHtml(text(state.errorKey))}</p>` : ""}
        <footer class="print-dialog__footer">
          <button type="button" class="orders-secondary" data-print-dialog-close>${escapeHtml(text("cancel"))}</button>
          <button type="button" class="orders-primary" data-print-dialog-confirm${canPrint() ? "" : " disabled"}>${escapeHtml(text("confirm"))}</button>
        </footer>
      </section>
    </div>`);
  }

  function focusOption(option = "invoice") {
    document.querySelector(`[data-print-dialog-option="${option}"]`)?.focus();
  }

  function open(order, trigger = "both", opener = document.activeElement) {
    state.open = true;
    state.order = order || null;
    state.trigger = ["invoice", "receipt"].includes(trigger) ? trigger : "both";
    state.mode = {
      invoice: state.trigger !== "receipt",
      receipt: state.trigger !== "invoice"
    };
    state.errorKey = state.order ? "" : "unavailable";
    state.opener = opener;
    render();
    focusOption(state.trigger === "receipt" ? "receipt" : "invoice");
  }

  function close() {
    if (!state.open) return;
    const opener = state.opener;
    state.open = false;
    state.order = null;
    state.errorKey = "";
    state.opener = null;
    document.querySelector("[data-print-dialog-root]")?.remove();
    if (opener?.isConnected) opener.focus();
  }

  document.addEventListener("click", (event) => {
    const root = event.target.closest("[data-print-dialog-root]");
    if (!root) return;
    if (event.target.matches("[data-print-dialog-root]") || event.target.closest("[data-print-dialog-close]")) {
      close();
      return;
    }
    if (!event.target.closest("[data-print-dialog-confirm]") || !canPrint()) return;
    if (!printInvoice(state.order, state.mode)) {
      state.errorKey = "blocked";
      render();
      document.querySelector("[data-print-dialog-confirm]")?.focus();
      return;
    }
    close();
  });

  document.addEventListener("change", (event) => {
    const option = event.target.closest("[data-print-dialog-option]");
    if (!option || !state.open) return;
    const key = option.getAttribute("data-print-dialog-option");
    state.mode[key] = option.checked;
    state.errorKey = state.errorKey === "blocked" ? "" : state.errorKey;
    render();
    focusOption(key);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  });

  new MutationObserver(() => {
    if (!state.open) return;
    render();
    focusOption(state.trigger === "receipt" ? "receipt" : "invoice");
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  return { open, close, isOpen: () => state.open };
}
