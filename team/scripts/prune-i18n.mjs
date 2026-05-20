// 掃 team/src 所有 t('xxx') / t("xxx") 收集 used keys，重寫 i18n.jsx 只保留這些 + 必須的 dynamic key。
// 安全機制：找不到 key 時 t() fallback 顯示中文原文，所以刪字典裡的 key 對中文無感，EN/FR 用戶看到那條會 fallback。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(__dirname, '../src')
const I18N = path.join(SRC, 'i18n.jsx')

// === 1. walk src/，gather all .jsx/.js（除 i18n.jsx 本身）
function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(jsx|js)$/.test(e.name) && e.name !== 'i18n.jsx') out.push(p)
  }
  return out
}
const files = walk(SRC)

// === 2. extract all t('...') / t("...") keys
const KEY_RE = /\bt\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g
const used = new Set()
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(KEY_RE)) {
    // unescape \' \" \\ \n
    const key = m[2].replace(/\\(['"\\nrt])/g, (_, c) => c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c)
    used.add(key)
  }
}

// === 3. dynamic keys（手動加 — 因為 t(label) where label 來自靜態數組，靜態提取不到）
// RolesAndDepartments.jsx PERMISSION_KEYS 的 9 個 label
const DYNAMIC = [
  '新建任務',
  '給他人分配任務',
  '改他人任務',
  '刪他人任務',
  '核驗任務',
  '管理員工',
  '審核加入申請',
  '看佣金（僅本人銷售業績）',
  '管理職位',
]
for (const k of DYNAMIC) used.add(k)

console.log(`掃到 used keys：${used.size}`)

// === 4. read i18n.jsx, parse DICT_EN + DICT_FR blocks
const raw = fs.readFileSync(I18N, 'utf8')
const lines = raw.split('\n')

// 找 DICT_EN = { ... }; / DICT_FR = { ... };
function findBlock(name) {
  const start = lines.findIndex(l => l.includes(`const ${name} = {`))
  if (start === -1) throw new Error(`block ${name} not found`)
  // close 是第一個只含 "};" 的行（trim 後）
  let end = -1
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '};') { end = i; break }
  }
  if (end === -1) throw new Error(`block ${name} close not found`)
  return [start, end]
}
const [enS, enE] = findBlock('DICT_EN')
const [frS, frE] = findBlock('DICT_FR')

// === 5. parse entries — 每條 entry 在一行（"key": "value", 可能跨多行但極少）
// 為了穩，逐行解析：
//   - 純註釋行 / 空行 → drop（瘦身時順便清乾淨）
//   - "key": value, → 提取 key（用 JSON.parse 解雙引號）
//   - 否則 → 保留（防誤刪奇形怪狀的）
function pruneBlock(start, end) {
  const head = lines[start]                          // const DICT_X = {
  const body = lines.slice(start + 1, end)
  const tail = lines[end]                            // };
  const keptBody = []
  let keptCount = 0
  let droppedCount = 0
  // 跟蹤上一條 entry 之前的註釋塊（如果 entry 被刪，註釋也跟著刪）
  let pendingComments = []
  for (const ln of body) {
    const trimmed = ln.trim()
    if (trimmed === '') {
      // 空行掛起，與註釋一起決定去留
      pendingComments.push(ln)
      continue
    }
    if (trimmed.startsWith('//')) {
      pendingComments.push(ln)
      continue
    }
    // 嘗試匹配 "key": "value",
    const m = trimmed.match(/^"((?:\\.|[^"\\])*)":/)
    if (m) {
      const key = m[1].replace(/\\(["\\nrt])/g, (_, c) => c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c)
      if (used.has(key)) {
        // keep — flush 註釋 + 本行
        keptBody.push(...pendingComments)
        keptBody.push(ln)
        keptCount++
      } else {
        droppedCount++
      }
      pendingComments = []
    } else {
      // 不認識的行（可能跨行 value 等），保守 keep
      keptBody.push(...pendingComments)
      keptBody.push(ln)
      pendingComments = []
    }
  }
  // 留尾巴的註釋（一般不會有，但放出去）
  keptBody.push(...pendingComments)
  return { head, body: keptBody, tail, keptCount, droppedCount }
}

const en = pruneBlock(enS, enE)
const fr = pruneBlock(frS, frE)
console.log(`DICT_EN: 保留 ${en.keptCount} / 刪 ${en.droppedCount}`)
console.log(`DICT_FR: 保留 ${fr.keptCount} / 刪 ${fr.droppedCount}`)

// === 6. rewrite i18n.jsx
const before = lines.slice(0, enS)
const between = lines.slice(enE + 1, frS)
const after = lines.slice(frE + 1)
const out = [
  ...before,
  en.head,
  ...en.body,
  en.tail,
  ...between,
  fr.head,
  ...fr.body,
  fr.tail,
  ...after,
].join('\n')

fs.writeFileSync(I18N, out)
const newLines = out.split('\n').length
console.log(`i18n.jsx：${lines.length} → ${newLines}（-${lines.length - newLines}）`)
