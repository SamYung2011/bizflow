import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const bundle = await build({ entryPoints: ['src/lib/knowledgeApi.js'], bundle: true,
  platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://fixture.invalid', VITE_SUPABASE_ANON_KEY: 'public-fixture' }) } });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const previous = globalThis.fetch, calls = [], auth = { accessToken: 'fixture-token' };
globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return Response.json({ code: 0, result: { id: 7, items: [] } }); };
try {
  await api.listTopics(auth);
  await api.createTopic({ slug: 'local' }, auth);
  await api.getTopic(7, auth);
  await api.updateTopic(7, { enabled: true }, auth);
  await api.listArticles({ topicId: 7, enabled: false, q: '車 保', page: 2, size: 30 }, auth);
  await api.createArticle({ topicId: 7, kind: 'article' }, auth);
  await api.getArticle(9, auth);
  await api.updateArticle(9, { title: { 'zh-Hant': '本機' } }, auth);
  assert.deepEqual(calls.map(item => [new URL(item.url).pathname.replace('/functions/v1/honnmono-admin', ''), item.options.method]), [
    ['/knowledge/topics', 'GET'], ['/knowledge/topics', 'POST'], ['/knowledge/topics/7', 'GET'], ['/knowledge/topics/7', 'PATCH'],
    ['/knowledge/articles', 'GET'], ['/knowledge/articles', 'POST'], ['/knowledge/articles/9', 'GET'], ['/knowledge/articles/9', 'PATCH'],
  ]);
  assert.deepEqual(Object.fromEntries(new URL(calls[4].url).searchParams), { topicId: '7', enabled: 'false', q: '車 保', page: '2', size: '30' });
  assert.deepEqual(JSON.parse(calls[3].options.body), { enabled: true });
  assert.deepEqual(JSON.parse(calls[7].options.body), { title: { 'zh-Hant': '本機' } });
  assert(calls.every(item => item.options.headers.Authorization === 'Bearer fixture-token'));
  console.log('KNOWLEDGE_API_SK1_SK8=8/8');
  globalThis.fetch = async () => Response.json({ error: 'Forbidden' }, { status: 403 });
  await assert.rejects(api.listTopics(auth), /HTTP 403/);
  globalThis.fetch = async () => Response.json({ error: 'Unauthorized' }, { status: 401 });
  await assert.rejects(api.listTopics(auth), /HTTP 401/);
  await assert.rejects(api.listTopics({}), /Missing access token/);
  console.log('KNOWLEDGE_API_AUTH=3/3');
  globalThis.fetch = async () => Response.json({ code: 409, des: 'slug_taken', result: {} }, { status: 409 });
  await assert.rejects(api.createTopic({}, auth), /slug_taken/);
  globalThis.fetch = async () => Response.json({ code: 409, des: 'slug_taken', result: {} });
  await assert.rejects(api.updateArticle(9, {}, auth), /slug_taken/);
  globalThis.fetch = async () => Response.json({ detail: [{ loc: ['body', 'title', 'zh-Hant'], msg: 'Field required' }, { loc: ['body', 'steps'], msg: 'Too short' }] }, { status: 422 });
  await assert.rejects(api.createArticle({}, auth), error => error.message.includes('title.zh-Hant：Field required；steps：Too short') && !error.message.includes('[object Object]'));
  console.log('KNOWLEDGE_API_ERRORS=3/3');
} finally { globalThis.fetch = previous; }


// Every existing global translation remains byte-identical, including repeated old keys.
async function dictionaries(source) {
  const output = await build({ stdin: { contents: source + '\nexport { DICT_EN, DICT_FR };',
    loader: 'jsx', resolveDir: process.cwd(), sourcefile: 'i18n-compat.jsx' },
    bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}
const oldTranslations = await dictionaries(execFileSync('git', ['show', '5096f3b:src/i18n.jsx'], { encoding: 'utf8' }));
const currentTranslations = await dictionaries(await readFile('src/i18n.jsx', 'utf8'));
for (const name of ['DICT_EN', 'DICT_FR']) {
  for (const [key, value] of Object.entries(oldTranslations[name])) assert.equal(currentTranslations[name][key], value, `${name}: ${key}`);
  assert(currentTranslations[name]['啟用']); assert(currentTranslations[name]['主題說明']); assert(currentTranslations[name]['文章摘要']);
}
console.log('KNOWLEDGE_I18N_COMPAT=2/2');


const knowledgeSources = ['src/views/honnmono/AppKnowledge.jsx',
  ...(await readdir('src/views/honnmono/knowledge')).filter(name => /\.(jsx|js)$/.test(name))
    .map(name => `src/views/honnmono/knowledge/${name}`)];
const keys = new Set();
for (const file of knowledgeSources) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) keys.add(match[1]);
  assert(!/>[^<{]*[\u3400-\u9fff][^<{]*</.test(source), `${file}: literal Chinese JSX`);
  assert(!/老板|老闆/.test(source));
}
for (const key of keys) {
  assert(currentTranslations.DICT_EN[key], `EN missing: ${key}`);
  assert(currentTranslations.DICT_FR[key], `FR missing: ${key}`);
}
assert.equal(currentTranslations.DICT_EN.slug, 'Slug'); assert.equal(currentTranslations.DICT_FR.slug, 'Slug');
console.log(`KNOWLEDGE_COPY_KEYS=${keys.size}/${keys.size}; EN+FR complete`);
