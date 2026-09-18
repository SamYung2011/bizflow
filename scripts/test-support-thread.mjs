import assert from 'node:assert/strict';
import { build } from 'esbuild';
// Exercise the real query functions with deterministic hook state, HTTP and cache.
// This catches initial afterId=0 accidentally fetching the oldest page on the real API.
const fixture = { queries: [], state: [], cache: new Map(), requests: [] };
globalThis.__supportThreadFixture = fixture;
const bundle = await build({entryPoints:['src/views/honnmono/support/useSupportData.js'],bundle:true,format:'esm',platform:'node',write:false,
 define:{'import.meta.env':JSON.stringify({VITE_SUPABASE_URL:'https://bridge.example.test',VITE_SUPABASE_ANON_KEY:'fixture'})},
 plugins:[{name:'hooks',setup(b){
  b.onResolve({filter:/^(react|@tanstack\/react-query)$/},a=>({path:a.path,namespace:'hooks'}));
  b.onLoad({filter:/.*/,namespace:'hooks'},a=>({contents:a.path==='react'?`
   const f=globalThis.__supportThreadFixture;
   export const useEffect=()=>{};
   export const useRef=value=>({current:value});
   export const useState=value=>{const i=f.state.push(value)-1;return [value,next=>f.state[i]=typeof next==='function'?next(f.state[i]):next]};
  `:`
   const f=globalThis.__supportThreadFixture;
   export const useQuery=options=>{f.queries.push(options);return {data:options.queryKey.includes('detail')?{id:1,staffReadMsgId:0}:[]}};
   export const useInfiniteQuery=()=>{};
   export const useQueryClient=()=>({getQueryData:key=>f.cache.get(JSON.stringify(key)),setQueryData:(key,value)=>{const k=JSON.stringify(key);f.cache.set(k,typeof value==='function'?value(f.cache.get(k)):value)},invalidateQueries:()=>{}});
  `,loader:'js'}));
 }}]});
const {useSupportThread}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const rows=Array.from({length:123},(_,i)=>({id:i+1,conversationId:1,clientMsgId:'m'+(i+1),content:'message '+(i+1)}));
const original=globalThis.fetch;
globalThis.fetch=async input=>{
 const url=new URL(input);fixture.requests.push(url.searchParams);
 const limit=Number(url.searchParams.get('limit'));
 const after=url.searchParams.get('afterId'),before=url.searchParams.get('beforeId');
 const selected=after!==null?rows.filter(x=>x.id>Number(after)).slice(0,limit):rows.filter(x=>before===null||x.id<Number(before)).slice(-limit);
 return Response.json({code:0,result:selected});
};
try{
 useSupportThread(1,{accessToken:'fixture',operatorEmail:'mia@example.test'});
 const query=fixture.queries.find(x=>x.queryKey.includes('messages'));
 const initial=await query.queryFn({signal:new AbortController().signal});
 assert.equal(initial.at(-1).id,123);assert(initial[0].id>1);assert.equal(fixture.requests[0].has('afterId'),false);
 fixture.cache.set(JSON.stringify(query.queryKey),initial);
 rows.push(...Array.from({length:67},(_,i)=>({id:124+i,conversationId:1,clientMsgId:'m'+(124+i)})));
 const updated=await query.queryFn({signal:new AbortController().signal});
 assert.equal(updated.at(-1).id,190);assert.equal(updated.length,initial.length+67);assert.equal(new Set(updated.map(x=>x.id)).size,updated.length);
 assert.equal(fixture.requests[1].get('afterId'),'123');
 console.log('SUPPORT_THREAD=2/2 (latest initial page; complete paged incremental catch-up without duplicates)');
}finally{globalThis.fetch=original;delete globalThis.__supportThreadFixture;}
