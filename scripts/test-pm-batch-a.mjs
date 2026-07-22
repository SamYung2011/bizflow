import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const shellCss = read("root-site/shell/shell.css");

assert.match(shellCss, /\.shell-page-inner\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;/,
  "desktop page content must fill the available shell width");
assert.match(shellCss, /\.shell-grid\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  "the loading grid must fill wide desktop shells with flexible tracks");
assert.doesNotMatch(shellCss, /max-width:\s*1494px/,
  "the former desktop page-width ceiling must be removed");
assert.match(shellCss, /\.shell-app--mobile \.shell-page-inner\s*\{[\s\S]*?width:\s*min\(100%,\s*362px\)/,
  "the approved mobile content width must remain unchanged");

console.log("PM batch A contracts: PASS (full-width shell)");
