export function formatMoney(value) {
  if (value == null || value === "") return "0.00";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : String(value);
}

export function moneyTone(typeKey, value) {
  const number = Number(value);
  if (Number.isFinite(number) && number < 0) return "out";
  if (["recharge", "refund", "income"].includes(typeKey)) return "in";
  if (["consume", "withdrawal"].includes(typeKey)) return "out";
  return "neutral";
}

export function renderMoneyText(
  value,
  { escapeHtml, tone = "neutral", currency = "HK$" } = {},
) {
  const e = escapeHtml ?? ((text) => String(text));
  return `<span class="money-text money-text--${e(tone)}">${e(currency)} ${e(formatMoney(value))}</span>`;
}
