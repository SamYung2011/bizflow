import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { build } from 'esbuild';

let checks = 0;
function check(name, fn) { fn(); console.log(`insurance ${++checks}: ${name}`); }

const bundle = await build({ entryPoints: ['src/lib/insuranceApi.js'], bundle: true,
  platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://fixture.invalid', VITE_SUPABASE_ANON_KEY: 'public-fixture' }) } });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), options });
  return url.includes('/files/') ? new Response(new Uint8Array([0, 255, 38]),
    { headers: { 'content-type': 'application/octet-stream' } }) : Response.json({ code: 0, result: { ok: true } });
};
const auth = { accessToken: 'fixture-token' };
try {
  await api.listItems({ type: 'policy', status: 'uploaded', q: 'HM-1', page: 2, size: 30 }, auth);
  await api.getPolicy(7, auth);
  await api.extractPolicy(7, { status: 'ready', insurer: 'Local' }, auth);
  await api.getClaim(8, auth);
  await api.changeClaimStage(8, { status: 'received' }, auth);
  await api.requestClaimDocuments(8, { kinds: ['police_doc'], note: 'Resend' }, auth);
  await api.reviewClaimDocument(8, 9, { status: 'accepted' }, auth);
  await api.addClaimNotice(8, { text: 'Received' }, auth);
  await api.getEnquiry(10, auth);
  await api.changeEnquiryStage(10, { status: 'quoted', quote: { insurer: 'Local', premium: '1000', cover: 'Third party', validUntil: '2026-12-31' } }, auth);
  check('S1-S10 stay on the authenticated bridge with expected methods', () => {
    assert.deepEqual(calls.map(x => [new URL(x.url).pathname.replace('/functions/v1/honnmono-admin', ''), x.options.method]), [
      ['/insurance/items', 'GET'], ['/insurance/policies/7', 'GET'], ['/insurance/policies/7/extract', 'POST'],
      ['/insurance/claims/8', 'GET'], ['/insurance/claims/8/stage', 'POST'],
      ['/insurance/claims/8/doc-requests', 'POST'], ['/insurance/claims/8/documents/9/review', 'POST'],
      ['/insurance/claims/8/notice', 'POST'], ['/insurance/enquiries/10', 'GET'],
      ['/insurance/enquiries/10/stage', 'POST'],
    ]);
    assert.equal(new URL(calls[0].url).searchParams.get('q'), 'HM-1');
    assert.deepEqual(JSON.parse(calls[9].options.body).quote, { insurer: 'Local', premium: '1000', cover: 'Third party', validUntil: '2026-12-31' });
    assert(calls.every(x => x.options.headers.Authorization === 'Bearer fixture-token'));
  });
  const blob = await api.fileBlob({ cfid: 'abc_123', name: 'my file.pdf' }, auth);
  const fileBytes = [...new Uint8Array(await blob.arrayBuffer())];
  check('S11 returns private bytes without exposing the Shenzhen URL', () => {
    assert.deepEqual(fileBytes, [0, 255, 38]);
    assert(calls.at(-1).url.endsWith('/insurance/files/abc_123/my%20file.pdf'));
  });
  globalThis.fetch = async () => Response.json({ code: 409, des: 'Conflict', result: null });
  await assert.rejects(api.changeClaimStage(8, { status: 'received' }, auth));
  check('nonzero legacy code fails the action', () => {});
  await assert.rejects(api.listItems({ type: 'policy' }, {}));
  check('missing session cannot reach the bridge', () => {});
} finally { globalThis.fetch = originalFetch; }

function dictionary(source, lang) {
  const marker = `const DICT_${lang} = `;
  const start = source.indexOf(marker) + marker.length;
  const base = vm.runInNewContext(`(${source.slice(start, source.indexOf('\n};', start) + 2)})`);
  const additions = [...source.matchAll(new RegExp(`Object\\.assign\\(DICT_${lang}, (\\{[\\s\\S]*?\\})\\);`, 'g'))]
    .map(match => vm.runInNewContext(`(${match[1]})`));
  return Object.assign(base, ...additions);
}
const current = await readFile('src/i18n.jsx', 'utf8');
const previous = execFileSync('git', ['show', 'HEAD:src/i18n.jsx'], { encoding: 'utf8' });
for (const lang of ['EN', 'FR']) {
  const old = dictionary(previous, lang), now = dictionary(current, lang);
  check(`P8 preserves existing ${lang} translations`, () => {
    for (const [key, value] of Object.entries(old)) assert.equal(now[key], value, `${lang} changed ${key}`);
  });
  const paths = ['src/views/honnmono/AppInsurance.jsx',
    ...(await readdir('src/views/honnmono/insurance')).filter(file => /\.jsx?$/.test(file))
      .map(file => `src/views/honnmono/insurance/${file}`)];
  const keys = new Set();
  for (const path of paths) {
    const source = await readFile(path, 'utf8');
    assert(source.split('\n').length < 300, `${path} exceeds 300 lines`);
    assert(!/老闆|老板/.test(source));
    for (const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) keys.add(match[1]);
  }
  check(`all ${keys.size} UI strings have ${lang} copy`, () => {
    for (const key of keys) assert(now[key], `${lang} missing ${key}`);
  });
}
console.log(`INSURANCE_SELF_CHECK=${checks}/${checks}`);
