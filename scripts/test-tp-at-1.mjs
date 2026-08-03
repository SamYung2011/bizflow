import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderTaskDetail } from "../root-site/team/tasks-detail.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";
import { liveSnapshotCacheVersion } from "../root-site/data/live-table-cache.js";
import {
  createTaskFeedbackDraft,
  findTaskFeedbackMention,
  removeTaskFeedbackMention,
  selectTaskFeedbackMention,
  taskFeedbackMentionCandidates,
  updateTaskFeedbackMentionInput
} from "../root-site/team/tasks-mentions.js";

const members = [
  { id: "all", name: "Honnmono", dept: "all", userId: "all-user", status: "active" },
  { id: "helen", name: "Helen", dept: "member", userId: "user-helen", status: "active" },
  { id: "jack", name: "Jack", dept: "member", userId: "user-jack", status: "active" },
  { id: "alice", name: "Alice", dept: "member", userId: "user-alice", status: "active" },
  { id: "sam", name: "Sam", dept: "member", userId: "user-sam", status: "departed" },
  { id: "guest", name: "Guest", dept: "member", userId: "", status: "active" }
];
const currentUser = { id: "helen", name: "Helen", userId: "user-helen" };

assert.deepEqual(
  taskFeedbackMentionCandidates(members, currentUser).map((member) => member.name),
  ["Jack", "Alice"],
  "candidates must be active, account-bound, company-scoped real members excluding the current user"
);
assert.deepEqual(findTaskFeedbackMention("請找 @ja", 6), { open: true, query: "ja", atIndex: 3, cursor: 6 });
assert.equal(findTaskFeedbackMention("請找 @ja ck", 9), null, "whitespace between @ and the caret must close suggestions");
assert.deepEqual(findTaskFeedbackMention("@old 已完成，再找 @Ja", 15), { open: true, query: "Ja", atIndex: 12, cursor: 15 },
  "the latest @ before the caret must win");

let draft = updateTaskFeedbackMentionInput(createTaskFeedbackDraft(), "請找 @ja 後文", 6);
let selected = selectTaskFeedbackMention(draft, members[2]);
assert.ok(selected);
assert.equal(selected.draft.message, "請找 @Jack 後文");
assert.equal(selected.cursor, 9);
assert.deepEqual(selected.draft.mentions, [{ userId: "user-jack", name: "Jack" }]);
draft = updateTaskFeedbackMentionInput(selected.draft, `${selected.draft.message}@j`, selected.draft.message.length + 2);
selected = selectTaskFeedbackMention(draft, members[2]);
assert.equal(selected.draft.mentions.length, 1, "the selected auth user id must be deduplicated");
const removed = removeTaskFeedbackMention(selected.draft, "user-jack");
assert.equal(removed.mentions.length, 0);
assert.match(removed.message, /@Jack/, "removing a chip must not rewrite the feedback body");

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const state = {
  detailOpen: true,
  selectedTaskId: "task-mention",
  detailTab: "feedback",
  attachmentPreview: null,
  tasks: [{
    id: "task-mention",
    title: "Mention contract",
    content: "",
    status: "inProgress",
    priority: "medium",
    visibility: "team",
    due: "",
    assignees: [],
    subtasks: [],
    attachments: [],
    attachmentCount: 0,
    feedback: []
  }],
  members,
  currentUser,
  permissions: { canCreate: true, canValidate: false },
  liveReadOnly: true,
  liveTaskWrites: true,
  writeBusy: false,
  feedbackEditingId: null,
  feedbackDraft: {
    message: "@ja",
    attachments: [],
    mentions: [],
    mentionMenu: { open: true, query: "JAC", atIndex: 0, cursor: 4 }
  },
  feedbackError: ""
};
const detailHtml = renderTaskDetail({ state, helpers: { escapeHtml, icon: () => "", lang: "zh" } });
assert.match(detailHtml, /data-task-feedback-mention-menu role="listbox"/);
assert.match(detailHtml, /data-task-feedback-mention-option="user-jack"[^>]*>Jack<\/button>/,
  "query matching must be case-insensitive");
assert.match(detailHtml, /data-task-feedback-mention-option="user-alice"[^>]* hidden>Alice<\/button>/);
assert.doesNotMatch(detailHtml, /data-task-feedback-mention-option="user-helen"/);
assert.doesNotMatch(detailHtml, /data-task-feedback-mention-option="user-sam"/);
assert.doesNotMatch(detailHtml, /data-task-feedback-mention-option="all-user"/);
const chipHtml = renderTaskDetail({
  state: {
    ...state,
    feedbackDraft: {
      ...state.feedbackDraft,
      mentions: [{ userId: "user-jack", name: "Jack" }],
      mentionMenu: { open: false, query: "", atIndex: -1, cursor: 0 }
    }
  },
  helpers: { escapeHtml, icon: () => "", lang: "zh" }
});
assert.match(chipHtml, /data-task-feedback-mention-remove="user-jack"/);
assert.match(chipHtml, />@Jack<\/span>/);

const [snapshotSource, providerSource, cacheSource, tasksSource, writesSource, cssSource] = await Promise.all([
  readFile(new URL("../root-site/data/live-snapshots.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/provider.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-table-cache.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-task-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain.css", import.meta.url), "utf8")
]);
assert.match(snapshotSource, /userId: asText\(employee\.user_id\)/, "members snapshot must carry the auth account id");
assert.match(providerSource, /userId: member\.userId[\s\S]*?status: member\.status[\s\S]*?employmentActive: member\.status === "active"/,
  "task members must carry account id and employment status");
assert.match(providerSource, /typeof member\.userId === "string"/, "old members snapshot shapes must fail validation");
assert.match(cacheSource, /\["members\.json", 1\]/, "members snapshot cache contract must be bumped");
assert.equal(liveSnapshotCacheVersion("members.json"), "0:1:0", "pre-release members cache entries must have a different version");
assert.match(tasksSource, /mentionedUserIds\s*=\s*\[\.\.\.new Set/);
assert.match(tasksSource, /createLiveTaskFeedback\(\{[\s\S]*?parentFeedbackId: null,[\s\S]*?mentionedUserIds/);
assert.match(tasksSource, /mentionedUserIds: result\.feedback\.mentioned_user_ids \?\? mentionedUserIds/);
assert.match(tasksSource, /id: `feedback-local-[\s\S]*?mentionedUserIds,/,
  "mock optimistic feedback must retain selected mention ids");
assert.match(writesSource, /mentioned_user_ids: mentions\.length \? mentions : null/,
  "no mentions must continue to persist as null");
assert.match(cssSource, /\.task-detail__composer\s+\.task-detail__mention-popover\s+button\[hidden\]\s*\{\s*display:\s*none;/,
  "hidden mention candidates must beat the composer button display rule");

for (const lang of ["zh", "en", "fr"]) {
  for (const key of ["tasks.detail.feedbackPlaceholder", "tasks.detail.mentionCandidates", "tasks.detail.mentionEmpty", "tasks.detail.removeMention"]) {
    assert.equal(typeof taskDictionaries[lang][key], "string", `${lang}.${key} missing`);
  }
  assert.match(taskDictionaries[lang]["tasks.detail.feedbackPlaceholder"], /@/);
}

console.log("TP-at-1 contracts: PASS (candidate scope, trigger/select/remove, snapshot cache, submit/null, mock, i18n)");
