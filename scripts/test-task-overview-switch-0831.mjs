import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderTaskModeSwitch, resolveTaskModeSwitch } from "../root-site/team/tasks-overview.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };

const boardSwitch = renderTaskModeSwitch({ mode: "board", canViewOverview: true, helpers });
assert.match(boardSwitch, /data-task-mode-switcher/,
  "overview-authorized users must see the board/overview switch");
assert.match(boardSwitch, /tab-chip tab-chip--active" data-task-mode-switch="board"[^>]*aria-selected="true"/,
  "board must be selected while the board is active");
assert.match(boardSwitch, /class="tab-chip" data-task-mode-switch="overview"[^>]*aria-selected="false"/,
  "overview must remain available without being falsely selected");

const overviewSwitch = renderTaskModeSwitch({ mode: "overview", canViewOverview: true, helpers });
assert.match(overviewSwitch, /tab-chip tab-chip--active" data-task-mode-switch="overview"[^>]*aria-selected="true"/,
  "overview must be selected after switching back from a member board");
assert.equal(renderTaskModeSwitch({ mode: "board", canViewOverview: false, helpers }), "",
  "users without the existing overview permission gate must not see the switch");

const overviewMode = resolveTaskModeSwitch("board", "overview", true);
assert.equal(overviewMode, "overview", "authorized board to overview switching must work");
assert.equal(resolveTaskModeSwitch(overviewMode, "board", true), "board",
  "authorized overview to board switching must work");
assert.equal(resolveTaskModeSwitch("board", "overview", false), "board",
  "a forged overview switch must not bypass the existing permission gate");

const [tasksSource, controllerSource, cssSource] = await Promise.all([
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain-controller.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain.css", import.meta.url), "utf8")
]);

assert.match(tasksSource, /const canViewOverview = initialView\.mode === "overview";/,
  "the switch must reuse the existing default-view permission gate instead of inventing a new RBAC rule");
assert.match(tasksSource, /mode: restoredMode === "overview" && !canViewOverview \? "board" : restoredMode,[\s\S]*?canViewOverview,/,
  "restored view state must not expose overview to an unauthorized user");
assert.match(tasksSource, /function taskSearchSurface\(helpers\)[\s\S]*?!state\.detailOpen && filterState\.view === "board"[\s\S]*?renderTaskModeSwitch\(\{ mode: state\.mode, canViewOverview: state\.canViewOverview, helpers \}\)[\s\S]*?taskSearchResults\(helpers\)/,
  "the switch belongs to the board/overview surface and must stay out of calendar/detail views");
assert.match(tasksSource, /function rerenderTaskSearchResults[\s\S]*?results\.innerHTML = taskSearchSurface\(currentHelpers\);/,
  "partial search rerenders must keep the mode switch mounted with the result surface");

const switchHandler = tasksSource.slice(
  tasksSource.indexOf('const modeSwitch = event.target.closest("[data-task-mode-switch]");'),
  tasksSource.indexOf('if (event.target.closest("[data-task-ai-back]"))')
);
assert.match(switchHandler, /resolveTaskModeSwitch\(state\.mode, requestedMode, state\.canViewOverview\)/,
  "the click path must enforce the same view gate as rendering");
assert.match(switchHandler, /state\.mode = nextMode;[\s\S]*?filterState\.view = "board";[\s\S]*?rerenderTaskPage\(\);/,
  "the segmented control must switch modes and rerender the existing task surface");
assert.doesNotMatch(switchHandler, /filterState\.member\s*=|overviewExpanded\.clear|boardExpandedPriorities\.clear/,
  "manual switching must retain member filters and existing board/overview expansion state");

const memberHandler = controllerSource.slice(
  controllerSource.indexOf('const memberTrigger = event.target.closest("[data-task-member]");'),
  controllerSource.indexOf("const overviewToggle")
);
assert.match(memberHandler, /state\.mode = "board";/,
  "clicking a member in overview must keep the existing board drill-down behavior");

assert.match(cssSource, /\.task-mode-switch\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*var\(--space-4\);[^}]*background:\s*var\(--gray-5\);/s,
  "the switch must follow the existing compact segmented-control visual language");
assert.match(cssSource, /\.task-mode-switch \.tab-chip\s*\{[^}]*justify-content:\s*center;[^}]*border:\s*0;[^}]*cursor:\s*pointer;/s,
  "the switch must reuse the existing tab-chip control states");

console.log("task overview switch 0831 contracts passed");
