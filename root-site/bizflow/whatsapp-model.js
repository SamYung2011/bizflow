export const WHATSAPP_MASK = "●●●●";
export const whatsappTabs = [
  "settings", "meta", "knowledge", "chargerPrompt", "bossPrompt", "whitelist",
  "conversations", "replies", "unresolved", "dailyReports", "logs"
];
export const whitelistKinds = ["phone", "group", "group_fuzzy", "staff"];

export function channelOf(row) {
  return row?.channel === "meta" ? "meta" : "extension";
}

export function dateOnly(value) {
  const match = String(value || "").match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function timeValue(value) {
  const match = String(value || "").match(/^(\d{4})[/-](\d{2})[/-](\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return 0;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part || 0));
  const date = new Date(year, month - 1, day, hour, minute, second);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day &&
    date.getHours() === hour && date.getMinutes() === minute && date.getSeconds() === second
    ? date.getTime()
    : 0;
}

export function groupConversations(messages, channel, dateFilter) {
  const grouped = new Map();
  messages.forEach((message) => {
    if (channel !== "all" && channelOf(message) !== channel) return;
    if (!dateFilter.matches(dateOnly(message.time))) return;
    // Mirrors bizflow_samyung/src/views/Whatsapp.jsx:200-205: one customer can have one conversation per channel.
    const key = `${channelOf(message)}:${String(message.customerId || "")}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(message);
  });
  return [...grouped.entries()].map(([key, rows]) => {
    rows.sort((a, b) => timeValue(a.time) - timeValue(b.time));
    return { key, customerId: String(rows[0]?.customerId || ""), rows, latest: rows[rows.length - 1] };
  }).sort((a, b) => timeValue(b.latest.time) - timeValue(a.latest.time));
}

export function replyPreview(segments) {
  try {
    const rows = JSON.parse(segments || "[]");
    return rows.map((row) => row?.content).filter((value) => typeof value === "string" && value.trim()).join(" ");
  } catch {
    return "";
  }
}

export function filterLogs(logs, channel, category, dateFilter) {
  return logs.filter((row) => (channel === "all" || channelOf(row) === channel) &&
    (category === "all" || row.category === category) && dateFilter.matches(dateOnly(row.time)));
}

export function promptPlaceholdersValid(value) {
  return String(value || "").includes("{LOCATION_DESC}") && String(value || "").includes("{STATIONS_OR_EMPTY}");
}

export function nextLocalId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
