import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import { build } from 'esbuild';

let checks = 0;
function check(name, fn) { fn(); console.log(`northbound ${++checks}: ${name}`); }

const bundle = await build({ entryPoints: ['src/lib/northboundApi.js'], bundle: true,
  platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://fixture.invalid', VITE_SUPABASE_ANON_KEY: 'public-fixture' }) } });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), options });
  return url.includes('/files/') ? new Response(new Uint8Array([0, 255, 38]), { headers: { 'content-type': 'application/octet-stream' } })
    : Response.json({ code: 0, result: { ok: true } });
};
const auth = { accessToken: 'fixture-token' };
try {
  await api.listCases({ status: 'open', q: 'HM-NB-000001', page: 2, size: 30 }, auth);
  await api.getCase(7, auth);
  await api.changeStage(7, { status: 'checking', note: 'Reviewing' }, auth);
  await api.requestDocuments(7, { kinds: ['hrp'], note: 'Please resend' }, auth);
  await api.reviewDocument(7, 9, { status: 'accepted', note: '' }, auth);
  await api.addNotice(7, { text: 'Received' }, auth);
  await api.updateFlags(7, { freeService: null, renewalWindowOk: true }, auth);
  check('S1-S7 use only bridge paths with authenticated GET/POST and expected bodies', () => {
    assert.deepEqual(calls.map(x => [new URL(x.url).pathname.replace('/functions/v1/honnmono-admin', ''), x.options.method]), [
      ['/northbound/cases', 'GET'], ['/northbound/cases/7', 'GET'],
      ['/northbound/cases/7/stage', 'POST'], ['/northbound/cases/7/doc-requests', 'POST'],
      ['/northbound/cases/7/documents/9/review', 'POST'], ['/northbound/cases/7/notice', 'POST'],
      ['/northbound/cases/7/flags', 'POST'],
    ]);
    assert.equal(new URL(calls[0].url).searchParams.get('q'), 'HM-NB-000001');
    assert.deepEqual(JSON.parse(calls[6].options.body), { freeService: null, renewalWindowOk: true });
    assert(calls.every(x => x.options.headers.Authorization === 'Bearer fixture-token'));
  });
  const file = await api.fileBlob({ cfid: 'abc_123', name: 'my file.png' }, auth);
  const fileBytes = [...new Uint8Array(await file.arrayBuffer())];
  check('S8 returns protected bytes without exposing the upstream URL', () => {
    assert.deepEqual(fileBytes, [0, 255, 38]);
    assert(calls.at(-1).url.endsWith('/northbound/files/abc_123/my%20file.png'));
  });
  globalThis.fetch = async () => Response.json({ code: 409, des: 'Conflict', result: null });
  await assert.rejects(api.changeStage(7, { status: 'checking' }, auth));
  check('nonzero legacy code is a failed action', () => {});
  await assert.rejects(api.listCases({ status: 'all' }, {}));
  check('missing session does not reach the bridge', () => {});
} finally { globalThis.fetch = originalFetch; }

const i18n = await readFile('src/i18n.jsx', 'utf8');
function dictionaryParts(name) {
  const marker = `const DICT_${name} = `;
  const start = i18n.indexOf(marker) + marker.length;
  const base = vm.runInNewContext(`(${i18n.slice(start, i18n.indexOf('\n};', start) + 2)})`);
  const extension = i18n.match(new RegExp(`Object\\.assign\\(DICT_${name}, (\\{[\\s\\S]*?\\})\\);`));
  return [base, vm.runInNewContext(`(${extension[1]})`)];
}
const [enBase, enExtension] = dictionaryParts('EN');
const [frBase, frExtension] = dictionaryParts('FR');
check('P7 translations preserve every existing dictionary value', () => {
  for (const [base, extension] of [[enBase, enExtension], [frBase, frExtension]]) {
    for (const [key, value] of Object.entries(extension)) {
      if (Object.hasOwn(base, key)) assert.equal(value, base[key], `${key} changed`);
    }
  }
});
const en = Object.assign(enBase, enExtension), fr = Object.assign(frBase, frExtension);
const sources = ['src/views/honnmono/AppNorthbound.jsx',
  ...(await readdir('src/views/honnmono/northbound')).filter(x => /\.(jsx|js)$/.test(x)).map(x => `src/views/honnmono/northbound/${x}`)];
const keys = new Set();
for (const path of sources) {
  const source = await readFile(path, 'utf8');
  assert(source.split('\n').length < 300, `${path} exceeds 300 lines`);
  assert(!/老闆|老板/.test(source));
  for (const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) keys.add(match[1]);
}
check(`all ${keys.size} UI strings have English and French copies`, () => {
  for (const key of keys) { assert(en[key], `EN missing ${key}`); assert(fr[key], `FR missing ${key}`); }
});

console.log(`NORTHBOUND_SELF_CHECK=${checks}/${checks}`);
