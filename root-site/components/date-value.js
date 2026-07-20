function pad2(value) {
  return String(value).padStart(2, "0");
}

function isValidDateParts(year, month, day) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function normalizeDateInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const parts = ymd
    ? [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])]
    : mdy
      ? [Number(mdy[3]), Number(mdy[1]), Number(mdy[2])]
      : null;
  if (!parts || !isValidDateParts(...parts)) return "";
  return `${parts[0]}-${pad2(parts[1])}-${pad2(parts[2])}`;
}

export function latestDateInput(values = []) {
  return values.reduce((latest, value) => {
    const normalized = normalizeDateInput(value);
    return normalized && (!latest || normalized > latest) ? normalized : latest;
  }, "");
}

export function displayDateInput(value) {
  return normalizeDateInput(value).replaceAll("-", "/");
}
