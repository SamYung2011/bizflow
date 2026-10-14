import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { listSupportStaff } from '../src/lib/supportStaff.js';
import { staffName } from '../src/lib/supportConfig.js';
import { isStaffAppEmbed } from '../src/lib/appEmbed.js';
import { instrumentModule } from './test-support/bounded-page-runtime.mjs';
const file=f=>new URL('../'+f,import.meta.url);
let count=0;const check=async(label,run)=>{await run();console.log(`ok ${++count} - ${label}`);};
const contextSource=readFileSync(file('src/context/AppContext.jsx'),'utf8');
function bootstrap(search,visible=true){
 const queries=[];let stateIndex=0;const session={user:{id:'own-test-user'}};
 const context={window:{location:{search}},URLSearchParams,isStaffAppEmbed,useAppEmbedVisible:()=>visible,useEffect(){},
  useState:init=>{const value=stateIndex++===0?session:typeof init==='function'?init():init;return[value,()=>{}];},
  useQuery:q=>{queries.push(q);return{};},supabase:{from(){return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:{user_id:session.user.id},error:null};}};}},
  fetchAllTable:()=>{throw new Error('Unexpected whole table read');}};
 const prefix=contextSource.slice(contextSource.indexOf('export function AppProvider'),contextSource.indexOf('  const [products, setProducts]')).replace('export function','function');
 vm.runInNewContext(prefix+'\n}\nAppProvider({});',context);return queries;
}
await check('every embed view disables all shared whole-table queries and loads only its employee',async()=>{
 for(const view of ['appSupport','appNorthbound','appInsurance','appOffers','appKnowledge','appPrompts']){
  const enabled=bootstrap(`?view=${view}&embed=1`).filter(q=>q.enabled);assert.equal(enabled.length,1);assert.equal(enabled[0].queryKey[1],'employees');
  const employees=await enabled[0].queryFn();assert.equal(employees[0].user_id,'own-test-user');
 }
});
await check('non-embed bootstrap keeps all ten existing shared tables; hidden embed stops employee polling',()=>{
 const keys=bootstrap('?view=dashboard').filter(q=>q.enabled).map(q=>q.queryKey[1]);
 assert.deepEqual(keys,['products','warehouses','inventory_stock','customers','invoices','employees','employee_tasks','task_assignees','employee_task_feedbacks','companies']);
 assert.equal(bootstrap('?view=appSupport&embed=1',false).filter(q=>q.enabled).length,0);
});
await check('visibility accepts only same-origin parent boolean messages and document foreground',()=>{
 const listeners={},parent={};const document={visibilityState:'visible',addEventListener:(n,f)=>listeners[n]=f};
 const window={parent,location:{search:'?view=appSupport&embed=1',origin:'http://localhost:8946'},addEventListener:(n,f)=>listeners[n]=f};
 const api=instrumentModule(file('src/lib/appEmbedVisibility.js'),{window,document,isStaffAppEmbed,useSyncExternalStore:(_,get)=>get()},'({useAppEmbedVisible})');
 assert.equal(api.useAppEmbedVisible(),true);
 listeners.message({source:{},origin:window.location.origin,data:{type:'bizflow-app-visibility',visible:false}});assert.equal(api.useAppEmbedVisible(),true);
 listeners.message({source:parent,origin:'https://wrong.invalid',data:{type:'bizflow-app-visibility',visible:false}});assert.equal(api.useAppEmbedVisible(),true);
 listeners.message({source:parent,origin:window.location.origin,data:{type:'bizflow-app-visibility',visible:false}});assert.equal(api.useAppEmbedVisible(),false);
 listeners.message({source:parent,origin:window.location.origin,data:{type:'bizflow-app-visibility',visible:true}});document.visibilityState='hidden';assert.equal(api.useAppEmbedVisible(),false);
 document.visibilityState='visible';assert.equal(api.useAppEmbedVisible(),true);
});
await check('all embedded list/detail query guards include visibility; parent changes retain frame container',()=>{
 for(const f of ['AppNorthbound.jsx','AppInsurance.jsx','AppOffers.jsx','AppKnowledge.jsx','support/useSupportData.js']){
  const source=readFileSync(file('src/views/honnmono/'+f),'utf8');assert.match(source,/useAppEmbedVisible\(\)/);
  const guards=[...source.matchAll(/enabled:\s*([^,}\n]+)/g)].map(m=>m[1]).filter(v=>!v.includes("''") && !v.startsWith("row."));
  assert.ok(guards.length);assert.ok(guards.every(v=>v.includes('visible')),`${f}: ${guards}`);
 }
 const parent=readFileSync(file('root-site/bizflow/app-feedback.js'),'utf8');assert.doesNotMatch(parent,/page\.outerHTML\s*=/);assert.match(parent,/syncAppFramePanels\(page/);
});
await check('only hashed task-platform JS/CSS receive immutable, not unversioned names',()=>{
 const config=JSON.parse(readFileSync(file('vercel.json'),'utf8'));
 const rule=config.headers.find(rule=>rule.source.includes('[A-Za-z0-9_'));
 assert.ok(rule);assert.ok(rule.headers.some(header=>header.key==='Cache-Control'&&header.value.includes('immutable')));
 const match=new RegExp('^'+rule.source+'$');
 for(const path of ['/task-platform/assets/index-AbCd123_.js','/task-platform/assets/style-aBcD0123.css'])assert.ok(match.test(path));
 for(const path of ['/task-platform/assets/index.js','/task-platform/assets/style.css','/task-platform/assets/index-12.js'])assert.equal(match.test(path),false);
});
await check('support keeps other staff names with a paged id/email/name-only directory',async()=>{
 const reads=[],rows=Array.from({length:1001},(_,id)=>({id:String(id),email:`staff${id}@own.invalid`,name:`Own Staff ${id}`}));
 const client={from(table){assert.equal(table,'employees');return{select(columns){assert.equal(columns,'id,email,name');return this;},order(key){assert.equal(key,'id');return this;},async range(from,to){reads.push([from,to]);return{data:rows.slice(from,to+1),error:null};}};}};
 const staff=await listSupportStaff(client);assert.equal(staff.length,1001);assert.deepEqual(reads,[[0,999],[1000,1999]]);
 assert.equal(staffName('staff1000@own.invalid',staff),'Own Staff 1000');
 const support=readFileSync(file('src/views/honnmono/AppSupport.jsx'),'utf8');assert.match(support,/useSupportStaff\(options, embedded\)/);
 assert.equal((support.match(/employees={staff}/g)||[]).length,2);
});
await check('embed skips realtime and task cleanup; non-embed support uses context staff',()=>{
 const source=readFileSync(file('src/App.jsx'),'utf8');
 for(const marker of ['  // Realtime 訂閱 customers 表','  // 每次 app 載入清理超過 180 天']){
  const effect=source.slice(source.indexOf(marker),source.indexOf('  }, [userId]);',source.indexOf(marker)));
  assert.match(effect,/if \(!userId \|\| isStaffAppEmbed\(window.location.search\)\) return;/);
 }
 const querySource=readFileSync(file('src/views/honnmono/support/useSupportData.js'),'utf8');
 const calls=[];const api=instrumentModule(file('src/views/honnmono/support/useSupportData.js'),{useAppEmbedVisible:()=>true,useQuery:q=>{calls.push(q);return{};}},'({useSupportStaff})');
 api.useSupportStaff({operatorEmail:'own'},false);api.useSupportStaff({operatorEmail:'own'},true);
 assert.equal(calls[0].enabled,false);assert.equal(calls[1].enabled,true);
 const support=readFileSync(file('src/views/honnmono/AppSupport.jsx'),'utf8');assert.match(support,/const staff = embedded \? directory.data \|\| employees : employees;/);
 const css=readFileSync(file('root-site/bizflow/app-feedback.css'),'utf8');assert.match(css,/\[data-app-native-panel\]:not\(\[hidden\]\)\s*{\s*display: contents;/);
});
console.log(`APP_EMBED_PERFORMANCE=${count}/${count}`);
