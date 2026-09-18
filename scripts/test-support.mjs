import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build, transform } from 'esbuild';

let checks = 0;
function check(label, test) { test(); checks++; console.log(`PASS ${label}`); }
async function rejects(label, promise) { await assert.rejects(promise); checks++; console.log(`PASS ${label}`); }
async function moduleFor(entry, mock) {
  const result = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false,
    define: { 'import.meta.env': JSON.stringify({ VITE_SUPPORT_MOCK: mock, VITE_SUPABASE_URL: 'https://bridge.example.test', VITE_SUPABASE_ANON_KEY: 'public-test' }) } });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const api = await moduleFor('src/lib/supportApi.js');
check('unset VITE_SUPPORT_MOCK selects the real bridge', () => assert.equal(api.SUPPORT_MOCK, false));
const mock = await moduleFor('src/lib/supportMock.js');
const config = await moduleFor('src/lib/supportConfig.js');
mock.configureMock({ delay: 0, sendDelay: 0 });
const conversations = await mock.listConversations();
check('five fixtures cover manual, AI, claimed, closed and unread states', () => {
  assert.equal(conversations.length, 5);
  assert(conversations.some(item => item.source === 'ai_handoff' && item.summary && item.unreadCount));
  assert(conversations.some(item => item.source === 'manual' && !item.summary));
  assert(conversations.some(item => item.assigneeEmail));
  assert(conversations.some(item => item.status === 'closed'));
});
const waiting = await mock.listConversations({ status: 'open', filter: 'waiting_staff' });
check('waiting filter follows the backend last-sender contract', () => assert(waiting.every(item => item.status === 'open' && item.lastSenderRole !== 'staff')));
check('unanswered manual and AI handoff conversations wait; closed always wins', () => {
  for (const lastSenderRole of ['user', 'ai', 'system', 'staff']) {
    assert.equal(config.conversationState({ status: 'open', lastSenderRole }), lastSenderRole === 'staff' ? 'active' : 'waiting');
    assert.equal(config.conversationState({ status: 'closed', lastSenderRole }), 'closed');
  }
});
const searched = await mock.listConversations({ q: '66001002' });
check('phone search scopes the results', () => assert.deepEqual(searched.map(item => item.id), [2]));
const latest = await mock.listMessages(3, { limit: 30 });
const older = await mock.listMessages(3, { beforeId: latest[0].id, limit: 30 });
check('older pagination is disjoint, ascending and bounded', () => {
  assert.equal(latest.length, 30); assert.equal(older.length, 30); assert(older.at(-1).id < latest[0].id);
});
const media = await mock.listMessages(2);
check('image grid, voice duration and file metadata exist', () => {
  assert.equal(media.find(item => item.msgType === 'image').attachments.length, 9);
  assert.equal(media.find(item => item.msgType === 'voice').attachments[0].duration, 12);
  assert(media.find(item => item.msgType === 'file').attachments[0].size > 0);
});
const read = await mock.getConversation(2);
check('reading messages moves the read pointer and clears unread', () => {
  assert.equal(read.unreadCount, 0); assert.equal(read.staffReadMsgId, media.at(-1).id);
});
const body = { clientMsgId: 'retry-id', msgType: 'text', content: '/fail Check the station', attachments: [] };
await rejects('first demo send fails', mock.sendMessage(4, body));
const afterFailure = await mock.getConversation(4);
check('failed reply leaves the conversation unassigned', () => assert.equal(afterFailure.assigneeEmail, ''));
const sent = await mock.sendMessage(4, body, { operatorEmail: 'test@example.test' });
const repeated = await mock.sendMessage(4, body);
const newMessages = await mock.listMessages(4, { afterId: sent.id - 1 });
check('retry is idempotent and incremental polling returns the appended message', () => {
  assert.equal(sent.id, repeated.id); assert.equal(newMessages.length, 1); assert.equal(sent.senderName, 'test@example.test');
});
const assigned = await mock.getConversation(4);
check('successful reply assigns the conversation to its sender', () => {
  assert.equal(assigned.assigneeEmail, 'test@example.test');
  assert.equal(config.conversationState(assigned), 'active');
});
assert(!(await mock.listConversations({ filter: 'waiting_staff' })).some(item => item.id === 4));
await mock.sendMessage(4, { ...body, clientMsgId: 'handover-id', content: 'I will take over.' }, { operatorEmail: 'next@example.test' });
const handedOver = await mock.getConversation(4), handoverList = await mock.listConversations();
check('a later staff reply takes over in both detail and list', () => {
  assert.equal(handedOver.assigneeEmail, 'next@example.test');
  assert.equal(handoverList.find(item => item.id === 4).assigneeEmail, 'next@example.test');
});
await mock.sendMessage(4, body, { operatorEmail: 'test@example.test' });
const afterOldRetry = await mock.getConversation(4);
check('retrying an older saved message does not reclaim the conversation', () => assert.equal(afterOldRetry.assigneeEmail, 'next@example.test'));
mock.configureMock({ failNext: true });
await rejects('a failed takeover is rejected', mock.sendMessage(4, { ...body, clientMsgId: 'failed-takeover', content: 'Another reply' }, { operatorEmail: 'test@example.test' }));
mock.receiveMockMessage(4);
const stillAssigned = await mock.getConversation(4);
check('failed takeover and incoming user messages preserve the responsible staff', () => {
  assert.equal(stillAssigned.assigneeEmail, 'next@example.test');
  assert.equal(config.conversationState(stillAssigned), 'waiting');
});
assert((await mock.listConversations({ filter: 'waiting_staff' })).some(item => item.id === 4));
const updated = await mock.updateConversation(4, { assigneeEmail: '', category: config.SUPPORT_CATEGORIES[1], status: 'closed' });
check('category updates cannot claim, release or close a conversation', () => {
  assert.equal(updated.category, config.SUPPORT_CATEGORIES[1]); assert.equal(updated.assigneeEmail, 'next@example.test');
  assert.equal(updated.status, 'open'); assert.equal(updated.userNickname, 'Emma Lam');
});
await mock.updateConversation(4, {});
assert.equal((await mock.getConversation(4)).category, config.SUPPORT_CATEGORIES[1]);
await mock.closeConversation(4); await mock.closeConversation(4);
const closedMessages = await mock.listMessages(4);
check('closing is idempotent and creates one system record', () => assert.equal(closedMessages.filter(item => item.msgType === 'system').length, 1));
await rejects('closed conversations cannot be sent to', mock.sendMessage(4, { ...body, clientMsgId: 'new-id' }));
check('confirmed polling reconciles optimistic messages without duplication', () => {
  const merged = config.mergeMessages([{ ...sent, id: 'temp', state: 'sending' }], [sent]);
  assert.equal(merged.length, 1); assert.equal(merged[0].id, sent.id); assert.equal(merged[0].state, undefined);
});
check('employee email resolves to the AppContext name', () => assert.equal(config.staffName('MIA@example.test', [{ email: 'mia@example.test', name: 'Mia Wong' }]), 'Mia Wong'));
const nativeFetch = globalThis.fetch, calls = [];
let response = { code: 0, result: [] };
globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } }); };
const options = { accessToken: 'local-test-token' };
await api.listConversations({ status: 'open', filter: 'waiting_staff', page: 2, size: 30, q: 'A & B' }, options);
check('B1 uses the bridge and safely encodes filters', () => {
  const call = calls.at(-1), url = new URL(call.url);
  assert.equal(url.pathname, '/functions/v1/honnmono-admin/support/conversations');
  assert.equal(url.searchParams.get('q'), 'A & B'); assert.equal(call.options.headers.Authorization, 'Bearer local-test-token');
});
await api.getConversation(1, options); await api.listMessages(1, { afterId: 12, beforeId: 20, limit: 30 }, options);
check('B2 and B3 stay conversation-scoped', () => {
  assert(calls.at(-2).url.endsWith('/conversations/1'));
  assert(calls.at(-1).url.endsWith('/conversations/1/messages?afterId=12&beforeId=20&limit=30'));
});
await api.sendMessage(1, body, options); await api.closeConversation(1, options);
await api.updateConversation(1, { category: 'other', assigneeEmail: 'test@example.test', status: 'closed' }, options);
check('B4-B6 send JSON bodies with POST through the existing helper', () => {
  assert.equal(calls.at(-3).options.method, 'POST'); assert.deepEqual(JSON.parse(calls.at(-3).options.body), body);
  assert(calls.at(-2).url.endsWith('/close')); assert(calls.at(-1).url.endsWith('/update'));
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { category: 'other' });
  assert.equal(calls.at(-3).options.headers['Content-Type'], 'application/json');
});
response = { code: 100001, des: 'Denied' };
await rejects('backend nonzero code rejects instead of showing success', api.getConversation(1, options));
await rejects('missing session cannot call the real bridge', api.getConversation(1));
globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response('file bytes'); };
const blob = await api.fileUrl({ cfid: 'abc/def', name: 'A B.png' }, options);
check('B7 authenticates bytes and returns a revocable local URL', () => {
  assert(blob.startsWith('blob:')); assert(calls.at(-1).url.endsWith('/files/abc%2Fdef/A%20B.png'));
  assert(!calls.at(-1).url.includes('local-test-token'));
}); URL.revokeObjectURL(blob);
const file = new File(['example'], 'receipt.txt', { type: 'text/plain' });
globalThis.fetch = async (url, options) => {
  calls.push({ url, options });
  return new Response(JSON.stringify(url.includes('/support/upload') ? { code: 0, result: { filelist: [{ cfid: 'upload-1', url: '/file', cfinfo: { url: 'https://upload.example.test/signed', method: 'POST' } }] } } : { code: 0, result: {} }));
};
const attachment = await api.uploadAttachment(2, file, options);
check('upload signature is scoped; file bytes go directly to cloud storage', () => {
  assert.equal(JSON.parse(calls.at(-2).options.body).conversationId, 2);
  assert.equal(calls.at(-1).options.body, file); assert.equal(calls.at(-1).options.headers.Authorization, undefined);
  assert.equal(attachment.cfid, 'upload-1'); assert.equal(attachment.name, 'receipt.txt');
});
globalThis.fetch = async (url, init) => {
  calls.push({ url, options: init });
  return Response.json(url.endsWith('/support/upload')
    ? { code: 0, result: { filelist: [{ cfid: 'upload-2', cfinfo: { url: '/functions/v1/honnmono-admin/support/upload/upload-2' } }] } }
    : { code: 0, result: {} });
};
await api.uploadAttachment(2, file, options);
check('bridge byte upload carries JWT without exposing it to other origins', () => {
  assert.equal(calls.at(-1).url, 'https://bridge.example.test/functions/v1/honnmono-admin/support/upload/upload-2');
  assert.equal(calls.at(-1).options.headers.Authorization, `Bearer ${options.accessToken}`);
  assert.equal(calls.at(-1).options.headers.apikey, 'public-test');
});
await rejects('configured attachment limit is enforced before upload', api.uploadAttachment(2, file, { ...options, limits: { attachmentMaxMb: 0 } }));
globalThis.fetch = nativeFetch;
const localeSource = await readFile('src/i18n.jsx', 'utf8');
function dictionary(name) {
  const start = localeSource.indexOf(`const DICT_${name} = `) + `const DICT_${name} = `.length;
  return vm.runInNewContext(`(${localeSource.slice(start, localeSource.indexOf('\n};', start) + 2)})`);
}
const en = dictionary('EN'), fr = dictionary('FR');
const sources = ['src/views/honnmono/AppSupport.jsx', 'src/lib/supportConfig.js', 'src/lib/supportMock.js',
  ...(await readdir('src/views/honnmono/support')).filter(name => /\.(jsx|js)$/.test(name)).map(name => `src/views/honnmono/support/${name}`)];
const keys = new Set();
for (const file of sources) {
  const source = await readFile(file, 'utf8');
  assert(source.split('\n').length < 300, `${file} must stay under 300 lines`);
  for (const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) keys.add(match[1]);
  assert(!/>[^<{]*[\u3400-\u9fff][^<{]*</.test(source), `${file}: untranslated JSX text`);
  assert(!/老板|老闆/.test(source));
}
check(`all ${keys.size} support copy keys exist in English and French; no literal Chinese JSX`, () => {
  keys.forEach(key => { assert(en[key], `EN missing: ${key}`); assert(fr[key], `FR missing: ${key}`); });
});
const mockApi = await moduleFor('src/lib/supportApi.js', '1');
const mockRows = await mockApi.listConversations({ q: 'Alex' });
check('VITE_SUPPORT_MOCK=1 swaps the transport without changing the return shape', () => {
  assert.equal(mockRows.length, 1); assert.equal(mockRows[0].userNickname, 'Alex Chan');
});
const rendered = await build({ stdin: { contents: `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import AppSupport from './src/views/honnmono/AppSupport.jsx';
  export const deny = props => renderToStaticMarkup(React.createElement(AppSupport, props));
`, resolveDir: process.cwd() }, bundle: true, format: 'cjs', platform: 'node', write: false,
  loader: { '.css': 'empty' }, define: { 'import.meta.env': '{"VITE_SUPPORT_MOCK":"0"}' } });
const compiled = { exports: {} };
new Function('module', 'exports', 'require', rendered.outputFiles[0].text)(compiled, compiled.exports, createRequire(import.meta.url));
check('missing session and missing operator email render only the access guard', () => {
  for (const props of [{},
    { isAdmin: true, session: { user: { email: 'a@test' } } }, { isAdmin: true, session: { access_token: 'x', user: {} } }]) {
    const html = compiled.exports.deny(props);
    assert(html.includes('role="alert"')); assert(!html.includes('support-workspace'));
  }
});

// Render the real App.jsx embed branch through the employee query/hydration sequence.
const appSource = await readFile('src/App.jsx', 'utf8');
const embedStart = appSource.indexOf('  if (tab === "appSupport" && new URLSearchParams');
assert(embedStart !== -1);
const embedBranch = appSource.slice(embedStart, appSource.indexOf('\n\n  return (', embedStart));
const embedCode = await transform(`
  return ({ qEmployees, currentEmployee, isBizflowMainAllowed = false }) => {
    const tab = 'appSupport', window = { location: { search: '?embed=1' } };
    const userId = 'staff-id', employees = qEmployees.data || [], session = {}, t = text => text;
    ${embedBranch}
  };
`, { loader: 'jsx' });
const require = createRequire(import.meta.url), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const embed = new Function('React', 'Suspense', 'AppSupportView', embedCode.code)(
  React, React.Suspense, () => React.createElement('div', null, 'support-ready'));
const renderEmbed = props => renderToStaticMarkup(embed(props));
const employee = { user_id: 'staff-id', bizflow_main_access: true };
check('embed shows the same loading fallback during employee fetch and effect hydration', () => {
  for (const qEmployees of [{ isPending: true }, { isSuccess: true, data: [employee] }]) {
    assert.equal(renderEmbed({ qEmployees }), '<div>載入客服會話…</div>');
  }
});
check('embed mounts support after the employee and main access are resolved', () => {
  assert(renderEmbed({ qEmployees: { isSuccess: true, data: [employee] }, currentEmployee: employee, isBizflowMainAllowed: true }).includes('support-ready'));
});
check('embed denies access only after the employee lookup confirms no main access', () => {
  assert.equal(renderEmbed({ qEmployees: { isSuccess: true, data: [] } }), '<div role="alert">未登入或沒有主站權限</div>');
});
check('employee query failure is a load error instead of an access denial', () => {
  assert.equal(renderEmbed({ qEmployees: { isError: true } }), '<div role="alert">資料載入失敗</div>');
});
console.log(`SUPPORT_SELF_CHECK=${checks}/${checks}`);
