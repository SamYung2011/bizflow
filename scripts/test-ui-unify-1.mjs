import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../", import.meta.url))
const read = relative => fs.readFileSync(path.join(repoRoot, relative), "utf8")
const tokens = read("root-site/tokens/tokens.css")

const promoted = {
  "--blue-bright": "#0099FF",
  "--red-strong": "#E01010",
  "--gray-6": "#F5F5F5",
  "--gray-11": "#E5E5E5",
  "--gray-25": "#979797",
  "--gray-50": "#5C5C5C",
  "--gray-70": "#2E2F30",
}

for (const [name, value] of Object.entries(promoted)) {
  assert.match(tokens, new RegExp(`${name}:\\s*${value}`, "i"), `${name} must own ${value}`)
}
assert.match(tokens, /--blue:\s*#0468EA/i, "the approved base blue must stay unchanged")
assert.match(tokens, /--grad-card-head:\s*linear-gradient\(90deg, #0468EA 0%, var\(--blue-bright\) 100%\)/)

function collectCss(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) collectCss(fullPath, files)
    else if (entry.name.endsWith(".css") && fullPath !== path.join(repoRoot, "root-site/tokens/tokens.css")) files.push(fullPath)
  }
  return files
}

const promotedLiterals = /#(?:5C5C5C|F5F5F5|E5E5E5|979797|E01010|0099FF|2E2F30)\b/i
for (const cssPath of collectCss(path.join(repoRoot, "root-site"))) {
  const declarations = fs.readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  assert.doesNotMatch(declarations, promotedLiterals, `${path.relative(repoRoot, cssPath)} must reference promoted tokens`)
}

const login = read("root-site/login/login.css")
assert.match(login, /--login-placeholder:\s*var\(--gray-25\)/)
assert.match(login, /--login-lang-idle:\s*var\(--gray-6\)/)

const inventory = read("root-site/bizflow/inventory.css")
for (const expected of [
  "--inventory-field-bg: var(--gray-6)",
  "--inventory-muted: var(--gray-50)",
  "--inventory-chip-bg: var(--gray-11)",
  "--inventory-field-border: var(--gray-25)",
  "--inventory-add-border: var(--blue-bright)",
  "--inventory-danger: var(--red-strong)",
  "--inventory-modal-close: var(--gray-70)",
]) assert.ok(inventory.includes(expected), `inventory must use ${expected}`)

const orders = read("root-site/bizflow/orders.css")
for (const expected of [
  "--order-toolbar-text: var(--gray-50)",
  "--orders-gray-e5: var(--gray-11)",
  "--orders-gray-5c: var(--gray-50)",
  "--orders-red-chip: var(--red-strong)",
  "--orders-close: var(--gray-70)",
  "--orders-placeholder: var(--gray-25)",
]) assert.ok(orders.includes(expected), `orders must use ${expected}`)
assert.match(orders, /--orders-status-selected:\s*var\(--blue\)/, "the audited order control blue must use the shared token")

const customers = read("root-site/bizflow/customers.css")
assert.equal((customers.match(/var\(--gray-50\)/g) || []).length, 3, "customer 5C text and cancel points must share gray-50")
assert.match(customers, /background:\s*var\(--gray-11\);\s*\/\* Figma #E5E5E5/)
assert.match(customers, /background:\s*var\(--gray-6\);\s*\/\* Figma #F5F5F5/)
assert.match(customers, /background:\s*var\(--gray-70\);\s*\/\* Figma #2E2F30/)

const menus = read("root-site/components/menus.css")
assert.match(menus, /user-panel__action--exit[\s\S]*?background:\s*var\(--gray-50\)/)
assert.equal((menus.match(/var\(--gray-6\)/g) || []).length, 3, "all F5 menu surfaces must share gray-6")

const members = read("root-site/team/members.css")
assert.match(members, /team-member-card--add[\s\S]*?color:\s*var\(--gray-25\)/)

const tasks = read("root-site/team/tasks.css")
assert.match(tasks, /--team-high-fg:\s*var\(--red-strong\)/)
assert.match(tasks, /--team-add-border:\s*var\(--blue-bright\)/)
assert.match(
  read("root-site/team/tasks-domain.css"),
  /button\[data-task-subtask-edit-cancel\][\s\S]*?color:\s*inherit/,
  "the pre-existing undefined gray-50 consumer must keep its inherited color",
)

const docs = read("docs/00-设计规范.md")
for (const [name, value] of Object.entries(promoted)) {
  assert.ok(docs.includes(`\`${name}\``) && docs.includes(`\`${value}\``), `design spec must document ${name}`)
}

assert.match(login, /--login-brand-soft:\s*#BFDBFE/i, "single-file login blue must stay local")
assert.match(read("root-site/bizflow/orders-domain.css"), /--revenue-chart-5:\s*#8B5CF6/i, "single-file revenue purple must stay local")

console.log("UI-unify-1 contracts: PASS")
