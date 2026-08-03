import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  LANGUAGE_STORAGE_KEY,
  persistLanguagePreference,
  resolveLanguagePreference
} from "../root-site/data/language-preference.js";
import { memberDictionaries } from "../root-site/team/members-i18n.js";
import {
  UPDATE_LOG_PAGE_SIZE,
  formatUpdateTimestamp,
  renderMemberUpdateLogs,
  sortUpdateCommentsOldestFirst
} from "../root-site/team/members-update-logs.js";

const values = new Map([[LANGUAGE_STORAGE_KEY, "en"]]);
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value)
};
assert.equal(resolveLanguagePreference({ search: "", storage }), "en");
assert.equal(resolveLanguagePreference({ search: "?lang=fr", storage }), "fr");
assert.equal(resolveLanguagePreference({ search: "?lang=xx", storage }), "en");
assert.equal(persistLanguagePreference("fr", storage), true);
assert.equal(values.get(LANGUAGE_STORAGE_KEY), "fr");
assert.equal(persistLanguagePreference("xx", storage), false);
assert.equal(resolveLanguagePreference({ storage: { getItem: () => { throw new Error("blocked"); } } }), "zh");
assert.equal(persistLanguagePreference("en", { setItem: () => { throw new Error("blocked"); } }), false);

assert.equal(UPDATE_LOG_PAGE_SIZE, 20);
assert.equal(formatUpdateTimestamp("2026-08-03T02:04:00.000Z"), "2026/08/03 10:04");
assert.deepEqual(
  sortUpdateCommentsOldestFirst([
    { id: "new", createdAt: "2026/08/03 10:02" },
    { id: "old", time: "2026/08/03 10:01" }
  ]).map(({ id }) => id),
  ["old", "new"]
);

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
const updates = Array.from({ length: 21 }, (_, index) => ({
  id: `update-${index + 1}`,
  author: "Tester",
  summary: `Update ${index + 1}`,
  detail: "Detail",
  createdAt: `2026/08/03 ${String(20 - Math.min(index, 20)).padStart(2, "0")}:00`,
  updatedAt: index === 0 ? "2026/08/03 20:05" : null,
  edited: index === 0,
  comments: index === 0 ? [
    { id: "other-new", authorUserId: "other", author: "Other", body: "new", createdAt: "2026/08/03 20:03", edited: false },
    { id: "mine-old", authorUserId: "me", author: "Me", body: "old", createdAt: "2026/08/03 20:01", updatedAt: "2026/08/03 20:02", edited: true }
  ] : []
}));
const html = renderMemberUpdateLogs({
  state: {
    updateLogs: updates,
    updateLogsVisibleCount: 20,
    editingUpdateId: null,
    editingUpdateCommentId: null,
    editingUpdateCommentDraft: "",
    updateLogUser: { id: "me", name: "Me" },
    access: { canWriteUpdates: false, canAdministerUpdateComments: false }
  },
  helpers: { escapeHtml, icon: () => "", lang: "zh" }
});
assert.equal((html.match(/data-update-log=/g) || []).length, 20);
assert.match(html, /data-update-count="21"/);
assert.match(html, /data-update-load-more[^>]*>載入更多 · 剩餘 1<\/button>/);
assert.doesNotMatch(html, /data-update-log="update-21"/);
assert.ok(html.indexOf('data-update-comment="mine-old"') < html.indexOf('data-update-comment="other-new"'));
assert.match(html, /💬 2/);
assert.match(html, /已編輯 2026\/08\/03 20:05/);
assert.match(html, /data-update-comment-edit="mine-old"/);
assert.doesNotMatch(html, /data-update-comment-edit="other-new"/);
assert.match(html, /已編輯 2026\/08\/03 20:02/);

const editingHtml = renderMemberUpdateLogs({
  state: {
    updateLogs: updates.slice(0, 1),
    updateLogsVisibleCount: 20,
    editingUpdateId: null,
    editingUpdateCommentId: "mine-old",
    editingUpdateCommentDraft: "edited draft",
    updateLogUser: { id: "me", name: "Me" },
    access: { canWriteUpdates: false, canAdministerUpdateComments: false }
  },
  helpers: { escapeHtml, icon: () => "", lang: "en" }
});
assert.match(editingHtml, /data-update-comment-edit-form/);
assert.match(editingHtml, /<textarea name="body" required>edited draft<\/textarea>/);
assert.match(editingHtml, /data-update-comment-edit-cancel>Cancel<\/button>/);
assert.match(editingHtml, />Save<\/button>/);

for (const lang of ["zh", "en", "fr"]) {
  for (const key of ["members.updates.editComment", "members.updates.loadMore", "members.updates.remaining"]) {
    assert.equal(typeof memberDictionaries[lang][key], "string", `${lang}.${key} missing`);
  }
}

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [registry, bizflowMenu, routeMenu, skeleton, shellCss, shell, login, writes, snapshots, members, updateUi, cache] = await Promise.all([
  read("root-site/components/navigation-registry.js"),
  read("root-site/components/bizflow-menu.js"),
  read("root-site/spa/route-menu.js"),
  read("root-site/shell/shell-skeleton.js"),
  read("root-site/shell/shell.css"),
  read("root-site/shell/shell.js"),
  read("root-site/login/login.js"),
  read("root-site/data/live-update-log-writes.js"),
  read("root-site/data/live-snapshots.js"),
  read("root-site/team/members.js"),
  read("root-site/team/members-update-logs.js"),
  read("root-site/data/live-table-cache.js")
]);
assert.match(registry, /export function createSectionMenu/);
assert.match(bizflowMenu, /return createSectionMenu\("bizflow"/);
assert.match(routeMenu, /return createSectionMenu\(currentRoute\.section/);
assert.doesNotMatch(bizflowMenu, /\.map\(\(\{[\s\S]*?canonicalHref/);
assert.doesNotMatch(routeMenu.slice(routeMenu.indexOf("export function createRouteMenu"), routeMenu.indexOf("export function createRouteFrame")), /\.map\(/);
assert.match(skeleton, /block\("shell-boot__fab"\)/);
assert.match(shellCss, /\.shell-boot__fab[\s\S]*?border: 1px dashed/);
assert.match(shell, /resolveLanguagePreference\(\{ search: window\.location\.search \}\)/);
assert.match(shell, /state\.lang = code;\s*persistLanguagePreference\(code\)/);
assert.match(login, /resolveLanguagePreference\(\{ search: window\.location\.search \}\)/);
assert.match(login, /state\.lang = langButton\.dataset\.lang;\s*persistLanguagePreference\(state\.lang\)/);
assert.match(writes, /export async function updateTeamUpdateComment\(id, body\)[\s\S]*?\.update\(\{[\s\S]*?updated_at:[\s\S]*?\.eq\("id", id\)/);
assert.match(snapshots, /sort\(\(left, right\) => timestamp\(left\.created_at\) - timestamp\(right\.created_at\)\)/);
assert.match(snapshots, /updatedAt: commentEdited \? formatDateTime\(comment\.updated_at\) : null/);
assert.match(updateUi, /entry\.comments\.push\(/);
assert.doesNotMatch(updateUi, /entry\.comments\.unshift\(/);
assert.match(members, /formHasValue\("\[data-update-comment-edit-form\]"\)/);
assert.match(cache, /\["team-extras\.json", 1\]/);
assert.match(cache, /\["team-update-logs\.json", 1\]/);

console.log("NR-shell-1 contracts: PASS (menu adapters, shell skeleton, language preference, update-log edit/paging/order/time)");
