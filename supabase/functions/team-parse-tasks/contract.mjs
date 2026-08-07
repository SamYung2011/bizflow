export const TEAM_PARSE_TEXT_LIMIT = 20_000;

export class TeamParseContractError extends Error {
  constructor(code) {
    super(code);
    this.name = "TeamParseContractError";
    this.code = code;
  }
}

export function normalizeTeamParseInput(value) {
  const text = typeof value?.text === "string" ? value.text.trim() : "";
  const companyId = typeof value?.companyId === "string" ? value.companyId.trim() : "";
  if (!text) throw new TeamParseContractError("text_required");
  if (text.length > TEAM_PARSE_TEXT_LIMIT) throw new TeamParseContractError("text_too_long");
  if (!companyId) throw new TeamParseContractError("company_required");
  return { text, companyId };
}

export function hongKongDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function buildTeamTaskPrompt({ meName, colleagueNames = [], departmentNames = [], today }) {
  const colleagues = colleagueNames.length ? colleagueNames.join("、") : "無";
  const departments = departmentNames.length ? departmentNames.join(" / ") : "無";
  return `你是任務整理助手。使用者會給你一段非結構化文案（會議記錄、待辦清單、群聊截圖文字等），請拆解成獨立的任務項。

當前使用者：${meName}
- 文案中的「我」「咱」「咱們」一律指代 ${meName}
- description 中必須把這些代詞替換成「${meName}」，方便他人閱讀；不要保留第一人稱代詞

同公司同事名單（文案中可能出現的人名）：${colleagues}
- 文案出現的人名如果在這個列表裡，保留該名字，不要改寫或意譯
- 不在列表的人名或外部人物代稱原樣保留

可選部門列表（如果無法確定就填 null）：${departments}

優先級規則：
- high：緊急、關鍵、deadline 在本週內，或帶「急」「立刻」「ASAP」字眼
- mid：常規任務（默認）
- low：可延期、探索性，或「有空看看」

截止日期：
- 文案中明確出現的日期（例如「周五」「6月10日」「本月底」）按今天往後推算成 YYYY-MM-DD
- 沒提到留 null
- 今天是 ${today}

返回格式：必須是合法 JSON，不要 markdown 圍籬，不要其他文字。Schema：
{"tasks": [{"title": "...", "description": "...", "department_name": "..." | null, "due_date": "YYYY-MM-DD" | null, "priority": "high" | "mid" | "low"}]}

title 簡短（不超過 30 字），description 寫清楚誰做什麼、為什麼，不要只抄原文。`;
}

export function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function isIsoDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function sanitizeParsedTasks(value, departmentNames = []) {
  if (!Array.isArray(value?.tasks)) throw new TeamParseContractError("invalid_ai_response");
  if (value.tasks.length === 0) throw new TeamParseContractError("no_tasks");
  const departments = new Set(departmentNames);
  const tasks = value.tasks.map((item) => {
    const departmentName = typeof item?.department_name === "string"
      ? item.department_name.trim()
      : "";
    return {
      title: String(item?.title || "").trim().slice(0, 100),
      description: String(item?.description || "").trim().slice(0, 2000),
      department_name: departmentName && departments.has(departmentName) ? departmentName : null,
      due_date: isIsoDate(item?.due_date) ? String(item.due_date) : null,
      priority: ["high", "mid", "low"].includes(item?.priority) ? item.priority : "mid",
    };
  }).filter((task) => task.title);
  if (tasks.length === 0) throw new TeamParseContractError("no_tasks");
  return tasks;
}

export function parsedTasksFailure(error) {
  const diagnostic = error instanceof TeamParseContractError
    ? error.code
    : "invalid_ai_response";
  return {
    code: diagnostic === "no_tasks" ? "no_tasks" : "ai_invalid_response",
    diagnostic,
  };
}

export function departmentNamesForEmployee(
  departments = [],
  employeeDepartments = [],
  unrestricted = false,
) {
  const allowedIds = new Set(employeeDepartments.map((row) => String(row?.department_id || "")));
  return [...new Set(departments
    .filter((department) => unrestricted || allowedIds.has(String(department?.id || "")))
    .map((department) => String(department?.name || "").trim())
    .filter(Boolean))];
}
