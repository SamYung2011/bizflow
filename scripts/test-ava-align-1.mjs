import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  sharedStyles,
  menuCss,
  taskDomainCss,
  taskCss,
  tasksJs,
  tasksDetailJs,
  customersCss,
  homeCss,
  membersCss
] = await Promise.all([
  readFile(new URL("../root-site/components/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../root-site/components/menus.css", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain.css", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.css", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-detail.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/customers.css", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/home.css", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/members.css", import.meta.url), "utf8")
]);

assert.match(sharedStyles, /\.avatar,\s*\n\.avatar--initial\s*\{[\s\S]*?font-size:\s*var\(--font-title-2-size\);[\s\S]*?font-weight:\s*var\(--font-title-2-weight\)/,
  "shared 40px initial avatars must use the Figma 24px SemiBold default");

assert.match(taskDomainCss, /\.task-overview__member-head \.avatar--initial\s*\{[\s\S]*?--component-width:\s*32px;[\s\S]*?--component-height:\s*32px;[\s\S]*?font-size:\s*var\(--font-title-3-size\);[\s\S]*?font-weight:\s*var\(--font-title-3-weight\)/,
  "32px task member pins must explicitly remain 16px Medium");

assert.match(menuCss, /\.user-panel__avatar\s*\{[\s\S]*?width:\s*60px;[\s\S]*?height:\s*60px;[\s\S]*?font-size:\s*var\(--font-title-1-size\);[\s\S]*?font-weight:\s*var\(--font-title-1-weight\)/,
  "60px user-panel initials must use the Figma 32px Bold variant");

assert.match(taskCss, /\.team-member-task__avatar\s*\{[\s\S]*?font-size:\s*var\(--font-title-1-size\);[\s\S]*?font-weight:\s*var\(--font-title-1-weight\)/,
  "task rail initials must retain their verified 32px Bold typography");
assert.match(tasksJs, /class="avatar--initial team-member-task__avatar" style="--component-width:60px;--component-height:60px"/,
  "task rail initials must retain their verified 60px avatar size");

assert.match(taskCss, /\.task-detail \.chat-bubble\s*\{[\s\S]*?--chat-avatar-size:\s*40px;/,
  "task feedback bubbles must retain their 40px desktop avatar container");
const chatAvatarRule = taskCss.match(/\.chat-bubble__avatar\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(chatAvatarRule, /width:\s*var\(--chat-avatar-size\);[\s\S]*?height:\s*var\(--chat-avatar-size\);/,
  "task feedback avatars must consume the shared 40px chat avatar size");
assert.doesNotMatch(chatAvatarRule, /font-(?:size|weight)\s*:/,
  "task feedback initials must inherit the shared 24px SemiBold avatar typography");
assert.match(tasksDetailJs, /class="avatar--initial chat-bubble__avatar"/,
  "task feedback initials must retain the shared avatar class for 24px SemiBold inheritance");

assert.doesNotMatch(customersCss, /\.customer-row\s*>\s*\.avatar--initial\s*\{/,
  "customer rows must inherit the shared avatar default without a redundant page override");

const responsiveSources = [sharedStyles, menuCss, taskDomainCss, taskCss, customersCss, homeCss, membersCss];
for (const css of responsiveSources) {
  const mobileBlocks = css.split(/@media\s*\(max-width:\s*768px\)\s*\{/).slice(1);
  for (const block of mobileBlocks) {
    assert.doesNotMatch(block, /\.(?:avatar--initial|user-panel__avatar|team-member-task__avatar)[^{]*\{[^}]*?(?:width|height|--component-width|--component-height)\s*:/,
      "mobile avatar size overrides require a paired, reviewed typography override");
  }
}

console.log("AVA-align-1 contracts: PASS (40px default/feedback, 32px pin, 60px panel/rail, no mobile shrink gap)");
