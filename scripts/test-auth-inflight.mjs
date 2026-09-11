import assert from 'node:assert/strict';
// Real auth module and real SDK subscriptions; all session/table IO is local.
import * as auth from '../root-site/data/auth.js';
import * as cache from '../root-site/data/live-table-cache.js';
const client=await auth.getSupabaseClient();assert.ok(client);
globalThis.fetch=async()=>{throw new Error('Unexpected network access');};
globalThis.window=new EventTarget();const storage=new Map();
window.localStorage=window.sessionStorage={get length(){return storage.size;},key:i=>[...storage.keys()][i]??null,
 getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
globalThis.CustomEvent ??= class extends Event {constructor(t,o={}){super(t);this.detail=o.detail;}};
const tick=()=>new Promise(r=>setTimeout(r,0));
const until=async f=>{for(let i=0;i<100&&!f();i++)await tick();assert.ok(f());};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let session, calls=[],hold=null,fail=false,passed=0;
client.auth.getSession=async()=>({data:{session},error:null});
client.from=table=>{const s=session;let query;
 const read=async()=>{calls.push({table,user:s.user.id,token:s.access_token});
  if(table==='employees'&&hold)await hold.promise;
  if(table==='employees'&&fail)return {data:null,error:new Error('fixture offline')};
  const data=table==='employees'?{id:`emp-${s.user.id}`,user_id:s.user.id,company_id:'company-a',is_admin:false}:
    table==='companies'?[{id:'company-a',name:'A'}]:[];
  return {data,error:null,count:Array.isArray(data)?data.length:1};};
 query={select:()=>query,eq:()=>query,is:()=>query,range:()=>query,order:()=>query,maybeSingle:read,then:(yes,no)=>read().then(yes,no)};return query;};
const emit=(event,value=session)=>client.auth._notifyAllSubscribers(event,value,false);
async function reset(){auth.resetCurrentUserMemory();await cache.clearLiveTableCache();storage.clear();
 session={access_token:'token-a',user:{id:'user-a',email:'a@fixture.invalid'}};storage.set('team-last-user',session.user.id);calls=[];hold=null;fail=false;}
const count=table=>calls.filter(c=>c.table===table).length;
async function test(name,fn){await reset();await fn();console.log(`ok ${++passed} - ${name}`);}
await test('cold no-company hint: same-user SIGNED_IN memo reset shares one employees + pending flight',async()=>{
 hold=deferred();const first=auth.getCurrentUser();await until(()=>count('employees')===1);
 assert.equal(storage.has('team-active-company-user-a'),false);
 await emit('SIGNED_IN');const second=auth.getCurrentUser();const third=auth.getCurrentUser({refresh:true});await tick();
 assert.equal(count('employees'),1);hold.resolve();const result=await Promise.all([first,second,third]);
 assert.ok(result.every(v=>v.userId==='user-a'));assert.equal(count('company_join_pending'),1);
 for(const table of ['employee_companies','companies','roles'])assert.equal(count(table),1);
});
await test('same-session stale auth rows share the background flight after the context memo resolves',async()=>{
  await auth.getCurrentUser();auth.resetCurrentUserMemory();
  const realNow=Date.now;Date.now=()=>realNow()+cache.LIVE_AUTH_CACHE_TTL_MS+1;
  try {
    calls=[];hold=deferred();const old=hold;await auth.getCurrentUser();await until(()=>count('employees')===1);
    await emit('SIGNED_IN');await auth.getCurrentUser();assert.equal(count('employees'),1);
    old.resolve();await until(()=>count('company_join_pending')===1);await tick();assert.equal(count('company_join_pending'),1);
  } finally {hold?.resolve();Date.now=realNow;}
});
for(const mode of ['token','signed-in-token','reset','different-user','auth-version']) await test(`${mode} invalidates in-flight auth ownership; old result never derives hints`,async()=>{
 hold=deferred();const first=auth.getCurrentUser();const rejected=assert.rejects(first,e=>e.name==='AbortError');await until(()=>count('employees')===1);
 const old=hold;hold=null;
 if(mode==='token'){session={...session,access_token:'token-b'};await emit('TOKEN_REFRESHED');}
 if(mode==='signed-in-token'){session={...session,access_token:'token-sign-in'};await emit('SIGNED_IN');}
 if(mode==='reset')auth.resetCurrentUserMemory();
 if(mode==='different-user'){session={access_token:'token-c',user:{id:'user-b',email:'b@fixture.invalid'}};await emit('SIGNED_IN');}
 if(mode==='auth-version')await cache.invalidateLiveAuthCache();
 const result=await auth.getCurrentUser();assert.equal(result.userId,session.user.id);old.resolve();await rejected;
 assert.equal(storage.get('team-last-user'),session.user.id);assert.equal(count('employees'),2);
 assert.equal((await cache.readLiveAuthCache(session.user.id)).employee.user_id,session.user.id);
});
await test('timeout frees stuck auth flight; late response cannot replace recovered context',async()=>{
 hold=deferred();const old=hold;await assert.rejects(auth.getCurrentUser({timeoutMs:10}),e=>e.name==='AuthContextTimeoutError');hold=null;
 const recovered=await auth.getCurrentUser();old.resolve();await tick();assert.equal(recovered.userId,'user-a');assert.equal(count('employees'),2);
});
await test('failed request releases flight and normal retry works',async()=>{
 fail=true;await assert.rejects(auth.getCurrentUser(),/offline/);fail=false;assert.equal((await auth.getCurrentUser()).userId,'user-a');assert.equal(count('employees'),2);
});
await test('signed-out event cancels in-flight user; never publishes old company/employee hints',async()=>{
 hold=deferred();const old=hold;const first=auth.getCurrentUser();const rejected=assert.rejects(first,e=>e.name==='AbortError');await until(()=>count('employees')===1);
 session=null;await emit('SIGNED_OUT');assert.equal(await auth.getCurrentUser(),null);old.resolve();await rejected;assert.equal(storage.has('team-active-company-user-a'),false);
});
console.log(`AUTH_INFLIGHT=${passed}/${passed}`);
