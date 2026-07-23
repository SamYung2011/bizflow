import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { dictionaries as shellDictionaries } from "../root-site/shell/shell-i18n.js";
import {
  memberDocumentTitle,
  memberPageHeading
} from "../root-site/team/members.js";
import { memberDictionaries } from "../root-site/team/members-i18n.js";

const lowAccess = { canManageEmployees: false };
const highAccess = { canManageEmployees: true };
const expected = {
  zh: { low: "更新日誌", high: "團隊成員" },
  en: { low: "Update log", high: "Team members" },
  fr: { low: "Journal des mises à jour", high: "Membres de l'équipe" }
};

for (const [lang, labels] of Object.entries(expected)) {
  assert.equal(memberPageHeading(lowAccess, lang), labels.low,
    `${lang} low-permission H1 must identify the update log`);
  assert.equal(memberPageHeading(highAccess, lang), labels.high,
    `${lang} employee managers must retain the team-members H1`);
  assert.equal(
    memberDictionaries[lang]["members.tab.updates"],
    shellDictionaries[lang]["nav.updates"],
    `${lang} page heading and shell replacement label must share the same wording`
  );
}

assert.equal(memberDocumentTitle(lowAccess), "Honnmono · Update log");
assert.equal(memberDocumentTitle(highAccess), "Honnmono · Team");

const membersSource = await readFile(
  new URL("../root-site/team/members.js", import.meta.url),
  "utf8"
);
assert.match(
  membersSource,
  /memberPageHeading\(state\.access, lang\)[\s\S]*?<h1 class="team-members-title"[^>]*>\$\{escapeHtml\(pageHeading\)\}<\/h1>/,
  "the rendered H1 must use the shared member access object"
);
assert.match(
  membersSource,
  /memberPageHeading\(access, lang\)[\s\S]*?access\?\.canManageEmployees \? "members\.title" : "members\.tab\.updates"/,
  "the heading must consume canManageEmployees instead of recreating permission checks"
);
assert.match(
  membersSource,
  /title: memberDocumentTitle\(memberAccess\)/,
  "the final document title must follow the same built access object"
);

console.log("TITLE-swap-1 contracts: PASS (low/high H1, shared access field, zh/en/fr wording, document title)");
