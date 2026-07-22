import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [home, homeCss, snapshots, tableCache, tasksCss] = await Promise.all([
  readFile(new URL("../root-site/bizflow/home.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/home.css", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-snapshots.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-table-cache.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.css", import.meta.url), "utf8")
]);

assert.match(homeCss, /\.home-stats \.board-card \.tp-number\s*\{[\s\S]*?font-size:\s*var\(--font-display-size\)/,
  "Home statistic values must use the 40px display size");
assert.match(homeCss, /\.home-card__list \.task-item \.tp-title\s*\{[\s\S]*?font-size:\s*var\(--font-description-size\);[\s\S]*?font-weight:\s*var\(--font-description-weight\)/,
  "My Tasks row titles must use 12px Medium");
assert.match(homeCss, /\.home-feed-row__line \.home-feed-name\s*\{[\s\S]*?font-weight:\s*var\(--font-title-2-weight\)/,
  "Team activity names must use 12px SemiBold");
assert.match(homeCss, /\.home-order-row__customer\s*\{[\s\S]*?font-size:\s*var\(--font-body-size\);[\s\S]*?font-weight:\s*var\(--font-body-weight\)/,
  "Home order customer names must use 10px Regular");
assert.match(snapshots, /members:\s*membersSnapshot\.members\.map[\s\S]*?departments:\s*member\.departments\.slice\(\)/,
  "home.json must retain live member department names");
assert.match(tableCache, /SNAPSHOT_CONTRACT_GENERATIONS[\s\S]*?\["home\.json", 2\]/,
  "the new home member shape must invalidate older cached home snapshots");

assert.match(home, /const department = memberDepartment\(m\);[\s\S]*?home-member__identity[\s\S]*?department \? `<span class="home-chip home-chip--dept/,
  "member cards must render a department chip beside the name only when a department exists");
assert.match(homeCss, /\.home-chip--dept\s*\{[\s\S]*?font-size:\s*8px;[\s\S]*?font-weight:\s*var\(--font-description-weight\)/,
  "department chips must use the Figma 8px Medium typography");
assert.match(homeCss, /home-chip--dept-design[\s\S]*?var\(--dept-design\)[\s\S]*?home-chip--dept-tech[\s\S]*?var\(--dept-tech\)/,
  "department chips must reuse the existing department tint tokens");
assert.match(tasksCss, /\.team-member-task__meta\s*\{\s*font-weight:\s*var\(--font-description-weight\)/,
  "task rail pending copy must use the Figma 12px Medium bucket");

console.log("FONT-unify-1 contracts: PASS (Home typography, live department chip, task rail pending copy)");
