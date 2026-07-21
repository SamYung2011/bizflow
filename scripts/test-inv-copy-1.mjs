import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { copyTextWithFallback } from "../src/lib/clipboard.js"

let appended = []
let execCalls = 0
let execResult = true
let selectedValue = ""
const savedRange = { id: "original-selection" }
const restoredRanges = []
const selection = {
  rangeCount: 1,
  getRangeAt: () => savedRange,
  removeAllRanges() { restoredRanges.length = 0 },
  addRange(range) { restoredRanges.push(range) },
}

function makeElement() {
  return {
    value: "",
    attributes: {},
    style: {},
    setAttribute(name, value) { this.attributes[name] = value },
    select() { selectedValue = this.value },
    setSelectionRange() {},
    remove() { appended = appended.filter(element => element !== this) },
  }
}

globalThis.window = { getSelection: () => selection }
globalThis.document = {
  body: { append(element) { appended.push(element) } },
  createElement: () => makeElement(),
  execCommand(command) {
    assert.equal(command, "copy")
    execCalls += 1
    return execResult
  },
}

// Clipboard API 缺失：隐藏 textarea 兜底，并恢复原选区。
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} })
assert.equal(await copyTextWithFallback(" SF123 "), true)
assert.equal(execCalls, 1)
assert.equal(selectedValue, "SF123")
assert.deepEqual(restoredRanges, [savedRange])
assert.equal(appended.length, 0)

// Clipboard API 被拒：同样进入兜底。
execCalls = 0
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { clipboard: { writeText: async () => { throw new Error("NotAllowedError") } } },
})
assert.equal(await copyTextWithFallback("SF456"), true)
assert.equal(execCalls, 1)

// 两条路径都失败时明确返回 false。
execCalls = 0
execResult = false
assert.equal(await copyTextWithFallback("SF789"), false)
assert.equal(execCalls, 1)
assert.equal(appended.length, 0)

// src 内不允许留下绕过兜底的裸 writeText 调用。
const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url))
const srcFiles = []
function collectSourceFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) collectSourceFiles(fullPath)
    else if (/\.(?:js|jsx)$/.test(entry.name)) srcFiles.push(fullPath)
  }
}
collectSourceFiles(sourceRoot)
const bareCalls = []
for (const filePath of srcFiles) {
  const source = fs.readFileSync(filePath, "utf8")
  if (path.basename(filePath) !== "clipboard.js" && /navigator\.clipboard(?:\?\.)?\.writeText\s*\(/.test(source)) {
    bareCalls.push(filePath)
  }
}
assert.deepEqual(bareCalls, [])

const invoicesSource = fs.readFileSync(new URL("../src/views/Invoices.jsx", import.meta.url), "utf8")
assert.match(invoicesSource, /copyTextWithFallback\(trackingNumber\)/)
assert.match(invoicesSource, /toastSuccess\(t\("複製成功"\)\)/)
assert.match(invoicesSource, /toastError\(t\("複製失敗"\)\)/)

console.log("INV-copy-1 contracts: PASS")
