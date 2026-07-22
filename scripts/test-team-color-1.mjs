import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [tokens, base, shell, tasks, spec] = await Promise.all([
  read("root-site/tokens/tokens.css"),
  read("root-site/tokens/base.css"),
  read("root-site/shell/shell.css"),
  read("root-site/team/tasks.css"),
  read("docs/00-设计规范.md")
]);

assert.match(tokens, /--gray-10:\s*#E5E7EB;/, "the Figma page background must remain the exact gray-10 token");
assert.match(base, /html\s*\{[\s\S]*?background:\s*var\(--gray-10\);/);
assert.match(base, /body\s*\{[\s\S]*?background:\s*var\(--gray-10\);/);
assert.match(shell, /\.shell-app\s*\{[\s\S]*?background:\s*var\(--gray-10\);/);
assert.match(shell, /\.shell-main\s*\{[\s\S]*?background:\s*var\(--gray-10\);/,
  "the visible shell canvas must not cover the global gray-10 page background");
assert.match(shell, /\.shell-sidebar\s*\{[\s\S]*?background:\s*var\(--white\);/,
  "the sidebar must remain white");
assert.match(shell, /\.shell-add-row\s*\{[\s\S]*?background:\s*var\(--gray-5\);/,
  "the sidebar add pill must retain its Figma gray-5 fill");

assert.match(tasks, /\.team-stat-card\s*\{[\s\S]*?background:\s*var\(--white\);[\s\S]*?color:\s*var\(--3a\);/,
  "the total-task stat must remain a white card");
assert.match(tasks, /\.team-stat-card--blue\s*\{[\s\S]*?background:\s*var\(--blue\);/);
assert.match(tasks, /\.team-stat-card--yellow\s*\{[\s\S]*?background:\s*var\(--yellow\);/);
assert.match(tasks, /\.team-stat-card--blue,[\s\S]*?\.team-stat-card--yellow\s*\{[\s\S]*?color:\s*var\(--white\);/,
  "completed and in-progress stats must use white text on solid fills");

assert.match(tasks, /\.team-member-task--active\s*\{[\s\S]*?color:\s*var\(--white\);[\s\S]*?background:\s*var\(--blue\);/,
  "the selected member rail card must be solid blue with white text");
assert.match(tasks, /\.team-board\s*\{[\s\S]*?background:\s*var\(--white\);/,
  "the member rail and kanban must remain inside one white board");
assert.match(tasks, /\.team-kanban-column\s*\{[\s\S]*?gap:\s*var\(--space-20\);[\s\S]*?padding:\s*var\(--space-10\);[\s\S]*?border:\s*1px solid var\(--gray-15\);[\s\S]*?border-radius:\s*var\(--radius-10\);/,
  "kanban columns must keep the Figma 1px outline, 10px padding, and 10px radius");
assert.match(tasks, /\.team-task-card__title\s*\{[\s\S]*?color:\s*var\(--black\);/);
assert.match(tasks, /\.team-task-card \.team-count-badge\s*\{[\s\S]*?color:\s*var\(--gray-6\);/);
assert.match(tasks, /\.team-count-badge\s*\{[\s\S]*?color:\s*var\(--gray-6\);/,
  "task badges must retain the exact Figma #F5F5F5 foreground token");

assert.match(spec, /全站页底统一使用 `--gray-10`/);
assert.match(spec, /侧栏保持白色[\s\S]*继续使用 `--gray-5`/);

console.log("TEAM-color-1 contracts: PASS (page canvas, stats, rail, board, columns, task cards)");
