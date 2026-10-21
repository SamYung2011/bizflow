import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const fixture = JSON.parse(await readFile('scripts/fixtures/support-charge-report.json', 'utf8'));
const compiled = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import { I18nProvider } from './src/i18n.jsx';
  import MessageBubble from './src/views/honnmono/support/MessageBubble.jsx';
  import SupportText from './src/views/honnmono/support/SupportText.jsx';
  export { reportFact, splitSupportText, readableSupportText } from './src/views/honnmono/support/chargeReport.js';
  export { SUPPORT_CHARGE_COPY } from './src/lib/supportChargeCopy.js';
  export const bubble = message => renderToStaticMarkup(React.createElement(I18nProvider, {}, React.createElement(MessageBubble, { message, employees: [] })));
  export const text = text => renderToStaticMarkup(React.createElement(I18nProvider, {}, React.createElement(SupportText, { text })));
` }, bundle: true, jsx: 'automatic', platform: 'node', format: 'cjs', write: false, loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' } });
const mod = { exports: {} }, browser = { location: { search: '?embed=1&lang=zh' } };
new Function('module', 'exports', 'require', 'window', compiled.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url), browser);
const api = mod.exports;
const t = (text, params = {}) => text.replace(/\{(\w+)\}/g, (_, key) => params[key]);
const msg = report => ({ id: 1, senderRole: 'ai', msgType: 'charge_report', content: 'Readable fallback', chargeReport: report, createdAt: 1790229300000 });
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
check('server fixture renders readable facts and staff advice', () => {
  const html = api.bubble(msg(fixture.full));
  for (const text of ['本次充電報告', '11 分 40 秒', '估算約 2.8 度', '30% → 42%', '客服處理建議', '車輛是否達到充電上限']) assert(html.includes(text));
  assert(!html.includes('flash:')); assert(!html.includes('Readable fallback'));
});
check('missing report still gives staff next steps without fabricated measurements', () => {
  const html = api.bubble(msg(fixture.unavailable));
  assert(html.includes('暫時讀不到')); assert(html.includes('客服處理建議')); assert(!html.includes('<dl>'));
});
check('older or unsupported payloads retain text fallback', () => {
  for (const report of [undefined, { version: 2 }]) assert(api.bubble(msg(report)).includes('Readable fallback'));
  assert(!api.bubble({ ...msg(fixture.full), senderRole: 'user' }).includes('support-charge-report'));
});
check('zero, estimates, malformed values and unknown units are handled', () => {
  assert.equal(api.reportFact({ value: 0, unit: 'kwh', estimated: true }, t, 'zh'), '估算約 0 度');
  for (const value of [null, false, -1, '2', NaN, Infinity]) assert.equal(api.reportFact({ value, unit: 'kwh' }, t, 'zh'), null);
  assert.equal(api.reportFact({ value: [0, 0], unit: 'percent_range' }, t, 'zh'), '0% → 0%');
  assert.equal(api.reportFact({ value: [101, 0], unit: 'percent_range' }, t, 'zh'), null);
  assert.equal(api.reportFact({ value: 1e30, unit: 'datetime' }, t, 'zh'), null);
  assert.equal(api.reportFact({ value: 0, unit: 'raw' }, t, 'zh'), null);
});
check('old diagnostics and opaque references are kept in closed technical details', () => {
  const raw = 'Help with flash:0wMAPZTV_3E5QpGUlmV7wBiR\n\n診斷紀錄：App v2, Context ref: flash:0wMAPZTV_3E5QpGUlmV7wBiR';
  const split = api.splitSupportText(raw, t);
  assert.equal(split.text, 'Help with 已關聯的充電紀錄'); assert.equal(split.details, raw);
  const html = api.text(raw), detail = html.indexOf('<details');
  assert(detail > 0); assert(!html.slice(0, detail).includes('flash:'));
  assert(html.includes('<details class="support-technical-details">')); assert(!html.includes('<details open'));
  assert.equal(api.readableSupportText('flash:abc', t), '已關聯的充電紀錄');
});
check('all card text has English and French translations in the real provider', () => {
  for (const lang of ['en', 'fr']) {
    browser.location.search = `?embed=1&lang=${lang}`;
    for (const report of Object.values(fixture)) assert(!/[\u3400-\u9fff]/.test(api.bubble(msg(report)).replaceAll('海旁附近', '')));
    for (const key of Object.keys(api.SUPPORT_CHARGE_COPY.en)) assert(api.SUPPORT_CHARGE_COPY.fr[key]);
  }
});
check('a new handoff summary remains visible after old diagnostic paragraphs', () => {
  const old = '舊問題\n\n診斷紀錄：App 1.0\nVariant CN\nUser 1';
  const next = '新問題：本次充電42%停止\n希望充到80%';
  const split = api.splitSupportText(old + '\n\n' + next, t);
  assert(split.text.includes('舊問題')); assert(split.text.includes(next));
  assert(!split.text.includes('App 1.0')); assert(split.details.includes('App 1.0'));
});
check('content stays escaped text', () => {
  const html = api.bubble(msg({ ...fixture.full, summary: '<script>alert(1)</script>' }));
  assert(html.includes('&lt;script&gt;')); assert(!html.includes('<script>'));
});
check('business action is explicit, dated, escaped and translated', () => {
  const message = { id: 7, msgType: 'customer_action', senderRole: 'user', content: 'readable action fallback', createdAt: 1790230000000,
    supportAction: { version: 1, kind: 'northbound', action: 'submitted', reference: 'HM-NB-123<script>', occurredAt: 1790230000000,
      staffAdvice: ['請到相應業務頁面核對已提交資料，告知客戶下一步及是否需要補件。'] } };
  for (const lang of ['zh', 'en', 'fr']) {
    browser.location.search = `?embed=1&lang=${lang}`;
    const html = api.bubble(message);
    assert(html.includes('support-customer-action')); assert(html.includes('2026')); assert(html.includes('&lt;script&gt;'));
    assert(!html.includes('readable action fallback'));
    if (lang !== 'zh') assert(!/[\u3400-\u9fff]/.test(html));
  }
  for (const change of [{version: 2}, {kind: 'unexpected'}, {action: 'fake'}, {occurredAt: 1e30}]) {
    assert(api.bubble({...message,supportAction:{...message.supportAction,...change}}).includes('readable action fallback'));
  }
  assert(api.bubble({...message,senderRole:'staff'}).includes('readable action fallback'));
});
check('report sharing uses customer action label and shared historical assessment', () => {
  browser.location.search = '?embed=1&lang=zh';
  const html = api.bubble(msg(fixture.full));
  for (const text of ['客戶操作', '分享充電報告', '低約 50%', '海旁附近']) assert(html.includes(text));
  assert(!html.includes('support-ai-name'));
});
console.log(`CHARGE_REPORT_CARD=${count}/${count}`);
