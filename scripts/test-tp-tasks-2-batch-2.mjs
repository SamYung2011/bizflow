import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderTaskActionPopover } from "../root-site/team/tasks-actions.js";
import { renderTaskDetail } from "../root-site/team/tasks-detail.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };

const helen = {
  id: "employee-helen",
  name: "Helen",
  isSuperAdmin: false,
  isAdminOfActive: false
};
const sourceTask = {
  id: "task-source",
  title: "需要重複發布的任務",
  content: "保留任務內容",
  priority: "high",
  status: "inProgress",
  done: false,
  due: "2026-07-31",
  owner: "Jack",
  creator: "Jack",
  creatorId: "employee-jack",
  departmentId: "department-sales",
  visibility: "department",
  visibilityDepartment: "銷售",
  requiresReview: false,
  approvedAt: "",
  approvedBy: "",
  assignees: [{ employeeId: "employee-jack", name: "Jack", completedAt: null, abandonedAt: null }],
  subtasks: [],
  attachments: [
    { url: "https://files.example.com/photo.bin", name: "現場照片.jpg", type: "image/jpeg" },
    { url: "https://files.example.com/charger.webp?version=2", name: "充電器", type: "application/octet-stream" },
    { url: "https://files.example.com/manual.pdf", name: "說明書.pdf", type: "application/pdf" },
    { url: "javascript:alert(1)", name: "不安全附件.jpg", type: "image/jpeg" }
  ],
  attachmentCount: 4,
  feedback: [{
    id: "feedback-1",
    author: "Sam",
    timestamp: "2026/07/20 15:00",
    message: "見附件",
    own: false,
    attachments: [{ url: "https://files.example.com/feedback.png", name: "反饋圖片.png", type: "image/png" }],
    attachmentCount: 1
  }]
};
const state = {
  detailOpen: true,
  selectedTaskId: sourceTask.id,
  detailTab: "content",
  attachmentPreview: null,
  tasks: [sourceTask],
  members: [helen],
  currentUser: helen,
  permissions: { canCreate: true, canValidate: false },
  liveReadOnly: true,
  liveTaskWrites: true,
  writeBusy: false,
  feedbackDraft: { message: "", attachments: [] },
  feedbackError: ""
};

const menuHtml = renderTaskActionPopover({
  task: sourceTask,
  open: true,
  state: {
    ...state,
    permissions: { canCreate: true, canEditOthers: false, canDeleteOthers: false },
    currentUser: helen
  },
  helpers
});
assert.match(menuHtml, /data-task-action-copy="task-source"/, "card menu must expose task copy to users with create permission");
assert.match(menuHtml, />複製任務<\/button>/);
const restrictedMenuHtml = renderTaskActionPopover({
  task: sourceTask,
  open: true,
  state: {
    ...state,
    permissions: { canCreate: false, canEditOthers: false, canDeleteOthers: false },
    currentUser: helen
  },
  helpers
});
assert.doesNotMatch(restrictedMenuHtml, /data-task-action-copy/, "copy must remain hidden without create permission");

const detailHtml = renderTaskDetail({ state, helpers });
assert.match(detailHtml, /data-task-copy="task-source"/, "task detail must expose the same copy flow");
assert.doesNotMatch(renderTaskDetail({
  state: { ...state, permissions: { canCreate: false, canValidate: false } },
  helpers
}), /data-task-copy=/, "task detail must enforce the same create-permission gate");
assert.equal((detailHtml.match(/class="task-detail__attachment-preview"/g) ?? []).length, 3,
  "task MIME image, image-extension URL, and feedback image must render as thumbnails");
assert.match(detailHtml, /<img src="https:\/\/files\.example\.com\/photo\.bin" alt="現場照片\.jpg" loading="lazy">/);
assert.match(detailHtml, /<img src="https:\/\/files\.example\.com\/charger\.webp\?version=2" alt="充電器" loading="lazy">/);
assert.match(detailHtml, /<img src="https:\/\/files\.example\.com\/feedback\.png" alt="反饋圖片\.png" loading="lazy">/);
assert.match(detailHtml, /<a href="https:\/\/files\.example\.com\/manual\.pdf" target="_blank" rel="noopener noreferrer"/,
  "non-image attachments must remain safe download links");
assert.doesNotMatch(detailHtml, /javascript:alert/, "unsafe attachment schemes must never reach rendered markup");

const viewerHtml = renderTaskDetail({
  state: {
    ...state,
    attachmentPreview: { url: "https://files.example.com/photo.bin", name: "現場照片.jpg" }
  },
  helpers
});
assert.match(viewerHtml, /data-task-attachment-viewer role="dialog" aria-modal="true"/);
assert.match(viewerHtml, /data-task-attachment-viewer-close/);
assert.match(viewerHtml, /<img src="https:\/\/files\.example\.com\/photo\.bin" alt="現場照片\.jpg">/);

const [tasksSource, detailSource, cssSource, snapshotSource] = await Promise.all([
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-detail.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.css", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-snapshots.js", import.meta.url), "utf8")
]);
const copyFlow = tasksSource.slice(tasksSource.indexOf("function openTaskCopy"), tasksSource.indexOf("function openTaskEdit"));
assert.match(copyFlow, /state\.submitMode = "create"/);
assert.match(copyFlow, /state\.submitTaskId = null/);
assert.match(copyFlow, /title: task\.title/);
assert.match(copyFlow, /content: task\.content \|\| ""/);
assert.match(copyFlow, /priority: task\.priority/);
assert.match(copyFlow, /departmentAvailable && currentUserEligible \? originalDepartmentId : ""/,
  "copy must not retain a department the current user cannot access");
assert.match(copyFlow, /owner: state\.currentUser\.name/,
  "copied task must default responsibility to the current user");
assert.match(copyFlow, /memberIds: \[\]/);
assert.match(copyFlow, /attachments: \[\]/,
  "copying must not silently reuse the source task's uploaded files");
assert.match(tasksSource, /data-task-action-copy[\s\S]*?openTaskCopy\(copyAction\.getAttribute\("data-task-action-copy"\)\)/);
assert.match(tasksSource, /data-task-copy[\s\S]*?openTaskCopy\(detailCopy\.getAttribute\("data-task-copy"\)\)/);
assert.match(tasksSource, /event\.key !== "Escape"[\s\S]*?state\.attachmentPreview/,
  "Escape must close the image viewer before leaving task detail");
assert.match(detailSource, /\^https\?:\\\/\\\//i, "attachment rendering must allowlist HTTP(S) URLs");
assert.match(cssSource, /\.task-detail__attachment-preview img[\s\S]*?object-fit: cover/);
assert.match(cssSource, /\.task-attachment-viewer__dialog img[\s\S]*?object-fit: contain/);
assert.match(snapshotSource, /attachments: asArray\(task\.attachments\)/);
assert.match(snapshotSource, /attachments: asArray\(feedback\.attachments\)/);

const copyKeys = [
  "tasks.action.copy",
  "tasks.detail.copy",
  "tasks.detail.previewAttachment",
  "tasks.detail.closeAttachmentPreview"
];
copyKeys.forEach((key) => {
  ["zh", "en", "fr"].forEach((lang) => assert.equal(typeof taskDictionaries[lang][key], "string", `${lang}.${key} missing`));
});

console.log("TP-tasks-2 batch 2 contracts: PASS (card/detail copy flow, self default, task/feedback image thumbnails, safe viewer, i18n)");
