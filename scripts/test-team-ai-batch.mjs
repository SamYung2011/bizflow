import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildTeamTaskPrompt,
  isIsoDate,
  normalizeTeamParseInput,
  sanitizeParsedTasks,
  TeamParseContractError,
} from "../supabase/functions/team-parse-tasks/contract.mjs";
import { callTeamTaskParser, TeamAiParseError } from "../root-site/data/live-ai-parse.js";
import { featureAiBatchForCompany } from "../root-site/data/team-feature-flags.js";
import {
  createTaskAiState,
  createTaskAiTasks,
  normalizeTaskAiCards,
  renderTaskAiDialog,
  taskAiCardsReady,
  taskAiPublishItems,
  updateTaskAiCardDepartment,
} from "../root-site/team/tasks-ai.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };

assert.deepEqual(normalizeTeamParseInput({ text: "  整理任務  ", companyId: " company-a " }), {
  text: "整理任務",
  companyId: "company-a",
});
assert.throws(() => normalizeTeamParseInput({ text: "", companyId: "company-a" }),
  (error) => error instanceof TeamParseContractError && error.code === "text_required");
assert.throws(() => normalizeTeamParseInput({ text: "x".repeat(20_001), companyId: "company-a" }),
  (error) => error instanceof TeamParseContractError && error.code === "text_too_long");
assert.equal(isIsoDate("2026-02-28"), true);
assert.equal(isIsoDate("2026-02-30"), false);

const prompt = buildTeamTaskPrompt({
  meName: "Helen",
  colleagueNames: ["Sam", "Vicky"],
  departmentNames: ["技術", "客服"],
  today: "2026-08-07",
});
assert.match(prompt, /當前使用者：Helen/);
assert.match(prompt, /Sam、Vicky/);
assert.match(prompt, /技術 \/ 客服/);
assert.match(prompt, /"priority": "high" \| "mid" \| "low"/);

const sanitized = sanitizeParsedTasks({ tasks: [
  {
    title: `  ${"T".repeat(110)}  `,
    description: "D".repeat(2_100),
    department_name: "技術",
    due_date: "2026-02-30",
    priority: "urgent",
  },
  { title: "有效任務", description: "內容", department_name: "未知", due_date: "2026-08-31", priority: "high" },
] }, ["技術", "客服"]);
assert.equal(sanitized[0].title.length, 100);
assert.equal(sanitized[0].description.length, 2_000);
assert.equal(sanitized[0].department_name, "技術");
assert.equal(sanitized[0].due_date, null);
assert.equal(sanitized[0].priority, "mid");
assert.deepEqual(sanitized[1], {
  title: "有效任務",
  description: "內容",
  department_name: null,
  due_date: "2026-08-31",
  priority: "high",
});
for (const payload of [{}, { tasks: [] }, { tasks: [{ title: "" }] }]) {
  assert.throws(() => sanitizeParsedTasks(payload, []), (error) => error instanceof TeamParseContractError);
}

assert.equal(featureAiBatchForCompany([
  { id: "company-a", featureAiBatch: false },
  { id: "company-b", featureAiBatch: true },
], "company-a"), false, "another visible company's flag must not enable the active company");
assert.equal(featureAiBatchForCompany([{ id: "company-b", featureAiBatch: true }], "company-b"), true);
assert.equal(featureAiBatchForCompany([{ id: "company-b", featureAiBatch: 1 }], "company-b"), false);

const departments = [
  { id: "dept-tech", name: "技術", memberIds: ["employee-helen", "employee-sam"] },
  { id: "dept-sales", name: "銷售", memberIds: ["employee-sam"] },
];
const members = [
  { id: "employee-helen", name: "Helen" },
  { id: "employee-sam", name: "Sam" },
];
const context = { departments, members, currentUserId: "employee-helen", canAssignOthers: true };
const cards = normalizeTaskAiCards([
  { title: " 技術任務 ", description: "內容", department_name: "技術", due_date: "2026-08-20", priority: "mid" },
  { title: "未知部門", department_name: "外部", due_date: "bad", priority: "bad" },
], context, (index) => `card-${index}`);
assert.deepEqual(cards[0], {
  id: "card-0",
  title: "技術任務",
  description: "內容",
  departmentId: "dept-tech",
  due: "2026-08-20",
  priority: "medium",
  assigneeId: "employee-helen",
});
assert.equal(cards[1].departmentId, "");
assert.equal(cards[1].due, "");
assert.equal(cards[1].priority, "medium");
const moved = updateTaskAiCardDepartment(cards[0], "dept-sales", context);
assert.equal(moved.assigneeId, "employee-sam", "changing department must reconcile the assignee");
const restricted = { ...context, canAssignOthers: false };
const restrictedCard = updateTaskAiCardDepartment(cards[0], "dept-sales", restricted);
assert.equal(restrictedCard.assigneeId, "", "users without assign-others permission cannot inherit another assignee");
assert.equal(taskAiCardsReady([restrictedCard], restricted), false);
const publishItems = taskAiPublishItems([moved], context);
assert.deepEqual(publishItems[0].assigneeIds, ["employee-sam"]);
assert.equal(publishItems[0].priority, "medium");
assert.equal(publishItems[0].departmentId, "dept-sales");
assert.equal(publishItems[0].requiresReview, false);
assert.equal(publishItems[0].completionMode, "ratio");

const attempted = [];
const sequence = await createTaskAiTasks({
  items: [{ title: "one" }, { title: "two" }, { title: "three" }],
  createTask: async (item) => {
    attempted.push(item.title);
    if (item.title === "two") throw new Error("write failed");
    return { task: { id: item.title } };
  },
});
assert.deepEqual(attempted, ["one", "two"]);
assert.deepEqual(sequence.created.map((entry) => entry.item.title), ["one"]);
assert.equal(sequence.failure.item.title, "two");
let active = true;
const stopped = await createTaskAiTasks({
  items: [{ title: "one" }, { title: "two" }],
  shouldContinue: () => active,
  createTask: async (item) => {
    active = false;
    return { task: { id: item.title } };
  },
});
assert.equal(stopped.created.length, 1);
assert.equal(stopped.failure.error.code, "page_inactive");

let request = null;
const parsed = await callTeamTaskParser(
  { text: "source", companyId: "company-a" },
  {
    loadContext: async () => ({ baseUrl: "https://project.supabase.co", anonKey: "anon", accessToken: "access" }),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ tasks: [{ title: "ok" }] }), { status: 200 });
    },
  },
);
assert.equal(parsed[0].title, "ok");
assert.equal(request.url, "https://project.supabase.co/functions/v1/team-parse-tasks");
assert.equal(request.options.headers.apikey, "anon");
assert.equal(request.options.headers.Authorization, "Bearer access");
assert.deepEqual(JSON.parse(request.options.body), { text: "source", companyId: "company-a" });
await assert.rejects(
  callTeamTaskParser(
    { text: "source", companyId: "company-a" },
    {
      loadContext: async () => ({ baseUrl: "https://project.supabase.co", anonKey: "anon", accessToken: "access" }),
      fetchImpl: async () => new Response(JSON.stringify({ code: "feature_not_enabled", diagnostic: "brief" }), { status: 403 }),
    },
  ),
  (error) => error instanceof TeamAiParseError && error.code === "feature_not_enabled" && error.status === 403,
);

const aiState = { aiOpen: true, ai: { ...createTaskAiState(), text: "待整理" } };
const inputHtml = renderTaskAiDialog({ state: aiState, context, helpers });
assert.match(inputHtml, /data-task-ai-form="parse"/);
assert.doesNotMatch(inputHtml, /unavailable|正式接入後可用/);
aiState.ai = { ...aiState.ai, stage: "preview", cards };
const previewHtml = renderTaskAiDialog({ state: aiState, context, helpers });
assert.match(previewHtml, /data-task-ai-form="publish"/);
for (const field of ["title", "description", "departmentId", "assigneeId", "due", "priority"]) {
  assert.match(previewHtml, new RegExp(`data-task-ai-field="${field}"`));
}

const aiKeys = Object.keys(taskDictionaries.zh).filter((key) => key.startsWith("tasks.ai.")).sort();
for (const lang of ["zh", "en", "fr"]) {
  assert.deepEqual(Object.keys(taskDictionaries[lang]).filter((key) => key.startsWith("tasks.ai.")).sort(), aiKeys,
    `${lang} AI copy must match the Traditional Chinese key set`);
  assert.equal("tasks.ai.unavailable" in taskDictionaries[lang], false);
}

const [edgeSource, providerSource, boardSource, tasksSource] = await Promise.all([
  readFile(new URL("../supabase/functions/team-parse-tasks/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/provider.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-board.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
]);
assert.match(edgeSource, /\.eq\("employee_id", employee\.id\)\s*\.eq\("company_id", input\.companyId\)/,
  "the Edge Function must bind the caller to the exact requested company");
assert.match(edgeSource, /\.from\("companies"\)[\s\S]*?\.eq\("id", input\.companyId\)/);
assert.match(edgeSource, /companyResult\.data\?\.feature_ai_batch !== true/);
assert.match(edgeSource, /\.from\("wa_settings"\)[\s\S]*?\.select\("openai_api_key,openai_base_url,model"\)[\s\S]*?\.eq\("id", 1\)/);
const featureFlow = providerSource.slice(providerSource.indexOf("export async function getTeamTaskData"), providerSource.indexOf("// team/團隊成員屏"));
assert.match(featureFlow, /featureAiBatchForCompany\(teamExtras\?\.companies, authUser\?\.activeCompanyId\)/);
assert.doesNotMatch(providerSource, /company\.name\s*===\s*"Honnmono"\s*&&\s*company\.featureAiBatch/);
assert.match(boardSource, /featureAiBatch && state\.permissions\.canCreate/);
assert.match(tasksSource, /createTaskAiTasks\([\s\S]*?createTask: createLiveTask/);
assert.match(tasksSource, /state\.ai\.cards = state\.ai\.cards\.slice\(outcome\.created\.length\)/,
  "successful cards must leave the retry preview after a partial write failure");

console.log("team-ai-batch contracts: PASS (Edge sanitize/scope, active-company gate, preview mapping, permissions, fixed endpoint, sequential partial writes, i18n)");
