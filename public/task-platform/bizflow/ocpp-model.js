export const OCPP_PAGE_SIZE = 18;

export function textMatch(row, query, keys) {
  const needle = String(query || "")
    .trim()
    .toLowerCase();
  return (
    !needle ||
    keys.some((key) =>
      String(row?.[key] ?? "")
        .toLowerCase()
        .includes(needle),
    )
  );
}

export function paginate(rows, page, pageSize = OCPP_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  return {
    page: safePage,
    pages,
    rows: rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    total: rows.length,
  };
}

export function dateInputFromUnix(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  const date = new Date(number * 1000);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatUnix(value, lang = "zh") {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "—";
  const locale = lang === "fr" ? "fr-FR" : lang === "en" ? "en-GB" : "zh-HK";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(number * 1000));
}

export function clockRange(start, end) {
  const clock = (value) => {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return "—";
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  };
  return `${clock(start)} - ${Number(end) === 86400 ? "24:00" : clock(end)}`;
}

export function pileTypeKey(value) {
  return ["public", "private"].includes(value) ? value : "unassigned";
}

export function stateKey(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (["normal", "success", "transferred", "1", "true"].includes(normalized))
    return "normal";
  if (["hidden", "failed", "fault", "0", "false"].includes(normalized))
    return "hidden";
  return "unknown";
}

const flowTypeKeys = new Set(["consume", "recharge", "refund", "income", "withdrawal"]);

export function flowTypeLabel(value, translate) {
  const key = String(value ?? "");
  return flowTypeKeys.has(key) ? translate(`flow.${key}`) : translate("unknown");
}
