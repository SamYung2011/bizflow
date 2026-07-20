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

// navigator.clipboard 只在安全上下文 + 新内核存在；老内核壳浏览器/WebView/http 环境走 execCommand 兜底
function legacyCopy(value) {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.append(area);
  const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
  const saved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  let done = false;
  try {
    area.select();
    area.setSelectionRange(0, area.value.length);
    done = document.execCommand("copy") === true;
  } catch {
    done = false;
  }
  area.remove();
  if (saved && selection) {
    selection.removeAllRanges();
    selection.addRange(saved);
  }
  return done;
}

export async function copyPhoneNumber(phone, lang = "zh", { scope = null } = {}) {
  const value = String(phone || "").trim();
  if (!value) return false;
  let copied = false;
  let failure = null;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch (error) {
      failure = error;
    }
  }
  if (scope && !scope.isCurrent()) return false;
  if (!copied) copied = legacyCopy(value);
  if (copied) {
    showNotice(text(lang, "copied", value));
    return true;
  }
  console.warn("Phone copy failed", failure);
  showNotice(text(lang, "failed"), "error");
  return false;
}

export function clearPhoneCopyNotice() {
  window.clearTimeout(noticeTimer);
  noticeTimer = 0;
  document.querySelector("[data-phone-copy-notice]")?.remove();
}
