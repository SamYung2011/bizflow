// Clipboard API 只在安全上下文及较新浏览器可用；旧浏览器/WebView/http 环境走 execCommand 兜底。
function legacyCopy(value) {
  const area = document.createElement("textarea")
  area.value = value
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.top = "-1000px"
  area.style.opacity = "0"

  const selection = typeof window.getSelection === "function" ? window.getSelection() : null
  const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  let copied = false

  document.body.append(area)
  try {
    area.select()
    area.setSelectionRange(0, area.value.length)
    copied = document.execCommand("copy") === true
  } catch {
    copied = false
  } finally {
    area.remove()
    if (savedRange && selection) {
      selection.removeAllRanges()
      selection.addRange(savedRange)
    }
  }

  return copied
}

export async function copyTextWithFallback(text) {
  const value = String(text ?? "").trim()
  if (!value) return false

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Permission/focus failures continue through the legacy path below.
    }
  }

  return legacyCopy(value)
}
