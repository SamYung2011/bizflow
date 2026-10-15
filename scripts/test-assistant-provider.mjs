import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const fixture = { baseUrl:'https://api.deepseek.com/chat/completions', model:'deepseek-flash',apiKeyHint:'····1234',
  custom:{baseUrl:false,model:false,apiKey:false},defaults:{baseUrl:'https://api.deepseek.com/chat/completions',model:'deepseek-flash',apiKeyHint:'····1234'},updatedBy:null,updatedAt:null };
const compile = async (contents, format='esm') => (await build({ stdin:{ contents, loader:'jsx', resolveDir:process.cwd() },
  bundle:true,platform:'node',format,write:false,jsx:'automatic',loader:{'.css':'empty'},
  define:{'import.meta.env':JSON.stringify({VITE_SUPABASE_URL:'https://fixture.invalid',VITE_SUPABASE_ANON_KEY:'fixture-public'})} })).outputFiles[0].text;
const api=await import('data:text/javascript;base64,'+Buffer.from(await compile("export * from './src/api/assistantProviderApi.js';")).toString('base64'));
let count=0;
const check=async(name,fn)=>{await fn();console.log(`ok ${++count} - ${name}`);};
const original=globalThis.fetch, calls=[],auth={accessToken:'fixture-token'};
try {
  globalThis.fetch=async(url,options)=>{calls.push([new URL(url).pathname,options]);return Response.json({code:0,result:fixture});};
  await check('authenticated provider GET/PATCH/reset use one existing bridge prefix',async()=>{
    assert.deepEqual(await api.getProvider(auth),fixture);
    await api.saveProvider({model:'custom',apiKey:'fixture-secret'},auth);await api.resetProvider(auth);
    assert.deepEqual(calls.map(([path,o])=>[path,o.method]),[
      ['/functions/v1/honnmono-admin/assistant/provider','GET'],['/functions/v1/honnmono-admin/assistant/provider','PATCH'],['/functions/v1/honnmono-admin/assistant/provider','PATCH']]);
    assert(calls.every(([,o])=>o.headers.Authorization==='Bearer fixture-token'));
    assert.deepEqual(JSON.parse(calls[1][1].body),{model:'custom',apiKey:'fixture-secret'});
    assert.deepEqual(JSON.parse(calls[2][1].body),{reset:true});
  });
  await check('400 upstream wording is preserved with no transport prefix',async()=>{
    globalThis.fetch=async()=>Response.json({detail:'連線測試失敗：HTTP 401 fixture upstream 原話'},{status:400});
    await assert.rejects(api.saveProvider({model:'bad'},auth),error=>error.message==='連線測試失敗：HTTP 401 fixture upstream 原話');
  });
  await check('missing token, employee 403 and application errors reject',async()=>{
    await assert.rejects(api.getProvider({}),/Missing access token/);
    globalThis.fetch=async()=>Response.json({detail:'Forbidden'},{status:403});await assert.rejects(api.getProvider(auth),/403: Forbidden/);
    globalThis.fetch=async()=>Response.json({code:400,des:'fixture failure'});await assert.rejects(api.getProvider(auth),/fixture failure/);
  });
} finally {globalThis.fetch=original;}
const renderCode=await compile(`
  import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
  import {I18nProvider} from './src/i18n.jsx';import AppPrompts from './src/views/AppPrompts.jsx';
  export const render=(provider,props={})=>{const cache=new QueryClient({defaultOptions:{queries:{gcTime:Infinity}}});
    cache.setQueryData(['appProvider','admin@example.test'],provider);cache.setQueryData(['appPrompts','admin@example.test'],[]);
    return renderToStaticMarkup(<QueryClientProvider client={cache}><I18nProvider><AppPrompts session={{access_token:'fixture',user:{email:'admin@example.test'}}} isAdmin embedded {...props}/></I18nProvider></QueryClientProvider>);};
`,'cjs');
const module={exports:{}};
new Function('module','exports','require','window',renderCode)(module,module.exports,createRequire(import.meta.url),{location:{search:''}});
await check('administrator card has exactly three inputs and two buttons above existing columns',()=>{
  const html=module.exports.render(fixture);
  for(const key of ['模型設定','接口地址','模型','API Key','儲存','恢復預設','目前生效：deepseek-flash','api.deepseek.com','尚未修改'])assert(html.includes(key),key);
  assert.equal((html.match(/<input /g)||[]).length,3);assert.equal((html.match(/<button /g)||[]).length,2);
  assert(html.includes('type="password"'));assert(html.includes('placeholder="預設：deepseek-flash"'));assert(html.includes('預設 key ····1234'));
  assert(html.indexOf('provider-card')<html.indexOf('nb-sidebar'));
  assert(!html.includes('<select')&&!html.includes('<textarea'));
});
await check('custom values and hint render without exposing a key value',()=>{
  const html=module.exports.render({...fixture,model:'custom-model',custom:{baseUrl:false,model:true,apiKey:true},apiKeyHint:'····5678',updatedBy:'mia@example.test',updatedAt:'2026-10-15T08:00:00Z'});
  assert(html.includes('value="custom-model"'));assert(html.includes('已設定 ····5678'));assert(html.includes('mia@example.test'));
  assert(/type="password"[^>]*value=""/.test(html));
});
await check('ordinary employee and absent sessions render no card or inputs',()=>{
  for(const props of [{isAdmin:false},{session:null},{session:{access_token:'x',user:{}}}]){
    const html=module.exports.render(fixture,props);assert(html.includes('role="alert"'));assert(!html.includes('provider-card')&&!html.includes('<input'));
  }
});
await check('all provider and shared leave copy is translated in English and French',async()=>{
  const {PROMPT_COPY}=await import('../src/views/prompts/i18n.js');
  for(const file of ['src/views/prompts/ProviderCard.jsx','src/views/prompts/usePromptLeave.js']){
    const source=await readFile(file,'utf8');assert(!/>[^<{]*[\u3400-\u9fff][^<{]*</.test(source));
    for(const [,key] of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)){
      if(['操作失敗，請重試','載入中…','儲存','已儲存'].includes(key))continue;
      for(const language of ['en','fr'])assert(PROMPT_COPY[language][key],language+':'+key);
    }
  }
});
console.log(`ASSISTANT_PROVIDER=${count}/${count}`);
