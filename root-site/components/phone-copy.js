const copy = Object.freeze({
  zh: Object.freeze({ label: "複製電話 {phone}", copied: "已複製 {phone}", failed: "未能複製" }),
  en: Object.freeze({ label: "Copy phone {phone}", copied: "Copied {phone}", failed: "Could not copy" }),
  fr: Object.freeze({ label: "Copier le téléphone {phone}", copied: "Copié {phone}", failed: "Copie impossible" })
});

let noticeTimer = 0;

function text(lang, key, phone = "") {
  return (copy[lang]?.[key] ?? copy.zh[key] ?? key).replace("{phone}", String(phone));
}

function showNotice(message, tone = "success") {
  clearPhoneCopyNotice();
  const notice = document.createElement("p");
  notice.className = `phone-copy-notice phone-copy-notice--${tone}`;
  notice.dataset.phoneCopyNotice = "";
  notice.setAttribute("role", tone === "success" ? "status" : "alert");
  notice.setAttribute("aria-live", "polite");
  notice.textContent = message;
  document.body.append(notice);
  noticeTimer = window.setTimeout(() => {
    notice.remove();
    noticeTimer = 0;
  }, 1800);
}

export function phoneCopyLabel(phone, lang = "zh") {
  return text(lang, "label", String(phone || "").trim());
}

export async function copyPhoneNumber(phone, lang = "zh", { scope = null } = {}) {
  const value = String(phone || "").trim();
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    if (scope && !scope.isCurrent()) return false;
    showNotice(text(lang, "copied", value));
    return true;
  } catch (error) {
    if (scope && !scope.isCurrent()) return false;
    console.warn("Phone copy failed", error);
    showNotice(text(lang, "failed"), "error");
    return false;
  }
}

export function clearPhoneCopyNotice() {
  window.clearTimeout(noticeTimer);
  noticeTimer = 0;
  document.querySelector("[data-phone-copy-notice]")?.remove();
}
