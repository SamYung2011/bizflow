import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const shellCss = read("root-site/shell/shell.css");
const homeJs = read("root-site/bizflow/home.js");

assert.match(shellCss, /\.shell-page-inner\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;/,
  "desktop page content must fill the available shell width");
assert.match(shellCss, /\.shell-grid\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  "the loading grid must fill wide desktop shells with flexible tracks");
assert.doesNotMatch(shellCss, /max-width:\s*1494px/,
  "the former desktop page-width ceiling must be removed");
assert.match(shellCss, /\.shell-app--mobile \.shell-page-inner\s*\{[\s\S]*?width:\s*min\(100%,\s*362px\)/,
  "the approved mobile content width must remain unchanged");

assert.match(homeJs, /const bannerStats\s*=\s*data\.stats\.filter\(\(stat\)\s*=>\s*stat\.key\s*!==\s*"members"\)/,
  "the Home banner must omit the team-member statistic");
assert.match(homeJs, /\$\{bannerStats\.map\(\(s\)\s*=>\s*statCard/,
  "the Home banner must render only the filtered five-card statistic set");
assert.match(homeJs, /data-home-members/,
  "removing the team-member banner card must not remove the lower team-member component");
assert.match(homeJs, /<section class="home-logistics"[\s\S]*?logisticsCard\(\{ filter: "pending"[\s\S]*?logisticsCard\(\{ filter: "in_transit"[\s\S]*?logisticsCard\(\{ filter: "exception"/,
  "the three logistics summary cards must remain unchanged");

console.log("PM batch A contracts: PASS (full-width shell, five-card Home banner)");
