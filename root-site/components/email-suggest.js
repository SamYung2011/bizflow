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
