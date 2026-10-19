import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { renderAppFramePanel } from '../root-site/bizflow/app-frame-panels.js';
import { requestPromptLeave, PROMPT_LEAVE_EVENT } from '../root-site/bizflow/app-prompt-leave.js';
const records = JSON.parse(await readFile('scripts/fixtures/assistant-prompts.json','utf8'));
let count = 0;
const check = async (name, run) => { await run(); console.log(`ok ${++count} - ${name}`); };
const compile = async (contents, format = 'esm', resolveDir = process.cwd()) => (await build({ stdin: { contents, loader: 'jsx', resolveDir }, bundle: true,
  platform: 'node', format, write: false, jsx: 'automatic', loader: { '.css': 'empty' },
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://fixture.invalid', VITE_SUPABASE_ANON_KEY: 'public-fixture' }) } })).outputFiles[0].text;
const api = await import('data:text/javascript;base64,'+Buffer.from(await compile("export * from './src/api/assistantPromptApi.js';")).toString('base64'));
const previous = globalThis.fetch, auth = { accessToken: 'local-fixture' }, calls = [];
try {
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return Response.json({ code:0,result:records }); };
  await check('list/save/reset use authenticated GET/PATCH with the exact contract', async () => {
    await api.listPrompts(auth); await api.savePrompt('system','local prompt',auth); await api.resetPrompt('system',auth);
    assert.deepEqual(calls.map(x=>[new URL(x.url).pathname,x.options.method]), [
      ['/functions/v1/honnmono-admin/assistant/prompts','GET'],['/functions/v1/honnmono-admin/assistant/prompts/system','PATCH'],['/functions/v1/honnmono-admin/assistant/prompts/system','PATCH']]);
    assert.deepEqual(JSON.parse(calls[1].options.body),{content:'local prompt'});
    assert.deepEqual(JSON.parse(calls[2].options.body),{reset:true});
    assert(calls.every(x=>x.options.headers.Authorization==='Bearer local-fixture'));
  });
  await check('missing token and server nonzero codes reject', async () => {
    await assert.rejects(api.listPrompts({}),/Missing access token/);
    globalThis.fetch=async()=>Response.json({code:400,des:'fixture error'});
    await assert.rejects(api.savePrompt('system','x',auth),/fixture error/);
  });
  await check('400 placeholder explanation is preserved verbatim', async () => {
    globalThis.fetch=async()=>Response.json({detail:'缺少記號：{lang}'},{status:400});
    await assert.rejects(api.savePrompt('app_language','x',auth),error=>error.message==='缺少記號：{lang}');
  });
} finally { globalThis.fetch = previous; }
const source = await readFile('src/views/AppPrompts.jsx','utf8');
await check('editor copy has three-language keys and no literal Chinese JSX', async () => {
  const { PROMPT_COPY }=await import('../src/views/prompts/i18n.js');
  const keys=[...source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(x=>x[1]);
  const dictionaries=await import('data:text/javascript;base64,'+Buffer.from(await compile((await readFile('src/i18n.jsx','utf8'))+'\nexport { DICT_EN, DICT_FR };', 'esm', process.cwd()+'/src')).toString('base64'));
  for(const key of [...keys,...records.flatMap(x=>[x.label,x.description])]) {
    assert(dictionaries.DICT_EN[key],`Missing EN ${key}`);assert(dictionaries.DICT_FR[key],`Missing FR ${key}`);
  }
  assert.equal(records.length,22);assert(PROMPT_COPY.en['APP 提示詞']);
  assert(!/>[^<{]*[\u3400-\u9fff][^<{]*</.test(source));
  let hasBaseline = true;
  try { execFileSync('git', ['cat-file', '-e', '188d11d^{commit}'], { stdio: 'ignore' }); }
  catch { hasBaseline = false; }
  if (!hasBaseline) {
    console.log('baseline 188d11d not in this clone, dictionary diff skipped');
    return;
  }
  const base=await import('data:text/javascript;base64,'+Buffer.from(await compile(execFileSync('git',['show','188d11d:src/i18n.jsx'],{encoding:'utf8'})+'\nexport { DICT_EN, DICT_FR };', 'esm', process.cwd()+'/src')).toString('base64'));
  for(const locale of ['DICT_EN','DICT_FR']) for(const [key,value] of Object.entries(base[locale])) {
    // #871 removed this unused entry; every remaining baseline translation stays unchanged.
    if (key === '停用') assert.equal(Object.hasOwn(dictionaries[locale], key), false, `${locale}:${key} retired`);
    else assert.equal(dictionaries[locale][key],value,`${locale}:${key}`);
  }
});
const renderSource = await compile(`
  import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
  import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
  import { I18nProvider } from './src/i18n.jsx'; import AppPrompts from './src/views/AppPrompts.jsx';
  export const render=(records,props={})=>{
    const cache=new QueryClient({defaultOptions:{queries:{gcTime:Infinity}}});cache.setQueryData(['appPrompts','admin@example.test'],records);
    const session={access_token:'fixture',user:{id:'fixture',email:'admin@example.test'}};
    return renderToStaticMarkup(<QueryClientProvider client={cache}><I18nProvider><AppPrompts session={session} isAdmin embedded {...props}/></I18nProvider></QueryClientProvider>);
  };
`, 'cjs');
const module = { exports:{} };
new Function('module','exports','require','window',renderSource)(module,module.exports,createRequire(import.meta.url),{location:{search:''}});
await check('administrator sees four groups, selected system textarea and save/reset', () => {
  const html=module.exports.render(records);
  for(const key of ['回答提示','記憶提示','轉人工提示','工具說明','系統設定','提示詞內容','儲存','恢復預設','尚未修改']) assert(html.includes(key),key);
  assert(html.includes('textarea'));assert(html.includes('spellcheck="false"'));assert(html.includes('aria-pressed="true"'));
  assert(html.includes('Honnmono App 助手'));assert(!html.includes('preview') && !html.includes('type="file"'));
});
await check('ordinary employee or absent session sees no editor or list', () => {
  for(const props of [{isAdmin:false},{session:null},{session:{access_token:'x',user:{}}}]) {
    const html=module.exports.render(records,props);assert(html.includes('role="alert"'));assert(!html.includes('textarea') && !html.includes('nb-list'));
  }
});
await check('custom marker and last modifier render from saved records', () => {
  const values=records.map((x,i)=>i?x:{...x,isCustom:true,updatedBy:'admin@example.test',updatedAt:'2026-10-14T08:00:00Z'});
  const html=module.exports.render(values);assert(html.includes('已自訂'));assert(html.includes('admin@example.test'));assert(html.includes('16:00:00'));
});
await check('cached iframe route uses the new embed whitelist and supports cancelling leave', () => {
  assert(renderAppFramePanel('prompts','zh',x=>x,x=>x).includes('view=appPrompts&embed=1'));
  const target=new EventTarget();target.Event=Event;
  target.addEventListener(PROMPT_LEAVE_EVENT,event=>event.preventDefault(),{once:true});
  assert.equal(requestPromptLeave(target),false);assert.equal(requestPromptLeave(target),true);
});
console.log(`ASSISTANT_PROMPTS=${count}/${count}`);
