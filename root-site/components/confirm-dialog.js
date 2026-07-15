const DIALOG_COPY = Object.freeze({
  zh: { title: "確認操作", cancel: "取消", confirm: "確認" },
  en: { title: "Confirm action", cancel: "Cancel", confirm: "Confirm" },
  fr: { title: "Confirmer l’action", cancel: "Annuler", confirm: "Confirmer" }
});

let closeActiveDialog = null;

function currentCopy() {
  const lang = String(document.documentElement.lang || "").toLowerCase();
  return DIALOG_COPY[lang.startsWith("fr") ? "fr" : lang.startsWith("en") ? "en" : "zh"];
}

function button(text, className, attribute) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.setAttribute(attribute, "");
  node.textContent = text;
  return node;
}

export function confirmInPage(message, options = {}) {
  closeActiveDialog?.(false);
  const copy = currentCopy();
  const returnFocus = document.activeElement;
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "tp-confirm-overlay";
    overlay.setAttribute("data-tp-confirm-overlay", "");

    const dialog = document.createElement("section");
    dialog.className = "tp-component tp-confirm-dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "tp-confirm-dialog-title");
    dialog.setAttribute("aria-describedby", "tp-confirm-dialog-message");

    const title = document.createElement("h2");
    title.id = "tp-confirm-dialog-title";
    title.textContent = String(options.title || copy.title);
    const body = document.createElement("p");
    body.id = "tp-confirm-dialog-message";
    body.textContent = String(message || "");
    const actions = document.createElement("footer");
    const cancel = button(String(options.cancelLabel || copy.cancel), "tp-confirm-dialog__button tp-confirm-dialog__button--cancel", "data-tp-confirm-cancel");
    const confirmClass = `tp-confirm-dialog__button tp-confirm-dialog__button--confirm${options.danger === true ? " tp-confirm-dialog__button--danger" : ""}`;
    const confirm = button(String(options.confirmLabel || copy.confirm), confirmClass, "data-tp-confirm-accept");
    actions.append(cancel, confirm);
    dialog.append(title, body, actions);
    overlay.append(dialog);
    document.body.append(overlay);

    let settled = false;
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      closeActiveDialog = null;
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
      resolve(accepted);
    };
    const onKeydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    };
    closeActiveDialog = finish;
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(false);
    });
    document.addEventListener("keydown", onKeydown, true);
    requestAnimationFrame(() => cancel.focus());
  });
}
