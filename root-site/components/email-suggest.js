const COMMON_EMAIL_DOMAINS = [
  "gmail.com", "yahoo.com", "yahoo.com.hk", "yahoo.com.tw",
  "hotmail.com", "outlook.com", "live.com", "icloud.com", "me.com",
  "qq.com", "163.com", "126.com", "foxmail.com", "sina.com", "aol.com"
];

const copy = {
  zh: "是不是 {email}？",
  en: "Did you mean {email}?",
  fr: "Vouliez-vous dire {email} ?"
};

function editDistance(left, right) {
  const rows = [Array.from({ length: right.length + 1 }, (_, index) => index)];
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const row = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      row[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? rows[leftIndex - 1][rightIndex - 1]
        : 1 + Math.min(rows[leftIndex - 1][rightIndex - 1], rows[leftIndex - 1][rightIndex], row[rightIndex - 1]);
    }
    rows.push(row);
  }
  return rows[left.length][right.length];
}

export function suggestEmail(value) {
  const email = String(value || "").trim();
  const separator = email.indexOf("@");
  if (separator <= 0 || separator >= email.length - 1) return null;
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1).toLocaleLowerCase();
  if (COMMON_EMAIL_DOMAINS.includes(domain)) return null;

  let closest = null;
  let closestDistance = Infinity;
  for (const candidate of COMMON_EMAIL_DOMAINS) {
    const distance = editDistance(domain, candidate);
    if (distance > 0 && distance <= 2 && distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }
  return closest ? `${local}@${closest}` : null;
}

export function renderEmailSuggestion({ value, lang = "zh", escapeHtml, target }) {
  const suggestion = suggestEmail(value);
  if (!suggestion) return "";
  const label = (copy[lang] ?? copy.zh).replace("{email}", suggestion);
  return `<button type="button" class="email-suggestion" data-email-suggestion="${escapeHtml(suggestion)}" data-email-suggestion-target="${escapeHtml(target)}">${escapeHtml(label)}</button>`;
}

// Input types whose HTML spec-defined "selection direction" is non-null, i.e. setSelectionRange()
// is allowed. type="email" (along with number/date/... ) throws InvalidStateError instead — see
// https://html.spec.whatwg.org/#do-not-apply. Both customer forms re-render then restore the caret
// after an email-suggestion swap, so that restore must always go through this guard rather than
// calling setSelectionRange() on the field directly (G-cus-1, 2026-08-04 nightrun cust-1 FAIL).
const SELECTION_RANGE_INPUT_TYPES = new Set(["text", "search", "url", "tel", "password"]);

// type="email" can't use setSelectionRange (throws InvalidStateError above), but it was left as a
// silent no-op, so the caret defaulted to index 0 after a suggestion-click re-render and the next
// keystroke landed at the front instead of the end (todo #259). Re-assigning .value on a focused
// control is not gated by the same "selection API applies" restriction — it moves the caret to the
// end as an ordinary side effect of the native text-editing behavior, not through setSelectionRange/
// selectionStart. Verified against real Chrome (2026-08-04): the value round-trips intact (no
// sanitization-clear for a non-"multiple" email input) and a synthetic keystroke right after lands
// at the tail. Deliberately not the "flip type to text and back" alternative — that path re-runs the
// email value-sanitization algorithm on the way back and risks clearing the field when the live value
// isn't a syntactically valid address yet (e.g. mid-typing); reassigning .value never touches `type`.
// Only recovers "caret to end" (no arbitrary offset), which is all every call site here ever asks for.
const CARET_TO_END_VALUE_REASSIGN_TYPES = new Set(["email"]);

export function safeSetSelectionRange(input, start = input?.value.length, end = start) {
  if (!input || typeof input.setSelectionRange !== "function") return;
  if (SELECTION_RANGE_INPUT_TYPES.has(input.type)) {
    input.setSelectionRange(start, end);
    return;
  }
  if (CARET_TO_END_VALUE_REASSIGN_TYPES.has(input.type) && start === input.value.length && end === input.value.length) {
    const value = input.value;
    input.value = "";
    input.value = value;
  }
}
