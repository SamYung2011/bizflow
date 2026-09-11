import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
register('./test-support/ocpp-prefetch-auth-loader.mjs', import.meta.url);
const storage = new Map();
globalThis.window = new EventTarget();
window.localStorage = window.sessionStorage = { get length(){ return storage.size; }, key:i=>[...storage.keys()][i]??null,
  getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k) };
window.location = new URL('https://fixture.invalid/bizflow/ocpp-monitor.html');
window.matchMedia = () => ({matches:false});
window.setTimeout = setTimeout; window.clearTimeout = clearTimeout;
globalThis.document = {prerendering:false,querySelector:()=>null};
globalThis.CustomEvent ??= class extends Event {constructor(t,o={}){super(t);this.detail=o.detail;}};
const auth=await import('../root-site/data/auth.js');
const cache=await import('../root-site/data/live-table-cache.js');
const queryCache=await import('../root-site/data/live-query-cache.js');
const live=await import('../root-site/data/live-ocpp.js');
const page=await import('../root-site/data/page-prefetch.js');
const home=await import('../root-site/data/live-home-query.js');
const scope=await import('../root-site/data/live-read-scope.js');
const routes=await import('../root-site/spa/route-manifest.js');
const hooks=await import('../root-site/spa/route-prefetch.js');
const tick=()=>new Promise(r=>setTimeout(r,0));
const until=async f=>{for(let i=0;i<150&&!f();i++)await tick();assert.ok(f(),'operation must start without waiting for auth/network');};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const updates=[];window.addEventListener('tp:live-snapshot-updated',e=>updates.push(e.detail));
let calls=[], handler, passed=0, now=Date.now();const realNow=Date.now;Date.now=()=>now;
const pageRows={data:[],page:{total:0,hasMore:false}};
function body(path,marker='new') {
  if(path.includes('/charge-user')) return pageRows;
  if(path.includes('/summary/charging')) return {data:{orders:pageRows,stations:[],marker}};
  if(path.includes('/summary/finance')) return {data:Object.fromEntries(['recharges','refunds','userMoneyLogs','operatorMoneyLogs','platformMoneyLogs','withdrawals'].map(k=>[k,pageRows]))};
  return {data:{piles:[{pileNo:marker}],commandLogs:[],alarms:[]}};
}
globalThis.fetch=async (url,options)=>{assert.ok(String(url).startsWith('https://fixture.invalid/functions/v1/ocpp-admin/'),'never connect to real services');assert.equal(options.method,'GET');
  const path=String(url).split('/ocpp-admin')[1];calls.push({path,token:options.headers.Authorization});return handler(path);};
async function reset(){auth.__reset();auth.__releaseAuth();auth.__setToken(`fixture-${++now}`);window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT));
  await cache.clearLiveTableCache();queryCache.clearLiveQueryCache();storage.set('team-active-company-test-user','company-test');storage.set('team-employee-test-user','employee-test');
  calls=[];updates.length=0;handler=async p=>new Response(JSON.stringify(body(p)),{status:200});}
async function test(name,fn){await reset();await fn();console.log(`ok ${++passed} - ${name}`);}
const readers={monitor:live.getLiveOcppMonitorData,charging:live.getLiveOcppChargingData,users:live.getLiveOcppUsersData,finance:live.getLiveOcppFinanceData};
// A fresh document can adopt a token-matched persisted snapshot, even though
// the prior document had different runtime counters. The network stays held.
storage.set('team-active-company-test-user','company-test');
const persisted = await scope.sessionReadContext(live.OCPP_CACHE_SNAPSHOTS.monitor);
const oldScope = JSON.parse(persisted.scopeKey);oldScope[2]=8;oldScope[3]='3:7';oldScope[4]=[['3:0:9',6]];oldScope[5]='old-document';oldScope.push('fixture-token-one');
await cache.writeLiveSnapshotCache({userId:'test-user',snapshot:live.OCPP_CACHE_SNAPSHOTS.monitor,value:{piles:[{pileNo:'persisted'}]},version:cache.liveSnapshotCacheVersion(live.OCPP_CACHE_SNAPSHOTS.monitor),scopeKey:JSON.stringify(oldScope)});
const persistedHold=deferred();handler=async p=>{await persistedHold.promise;return new Response(JSON.stringify(body(p)));};
assert.equal((await live.getLiveOcppMonitorData()).piles[0].pileNo,'persisted');assert.equal(calls.length,1);
persistedHold.resolve();await until(()=>updates.length===1);
console.log(`ok ${++passed} - fresh document adopts persisted token/version scope before network completes`);
for(const [name,read] of Object.entries(readers)) await test(`${name}: page and unread overlap held auth, inflight/settled mount owns one read batch`,async()=>{
  auth.__holdAuth();const boot=auth.getCurrentUser();const hold=deferred();handler=async p=>{await hold.promise;return new Response(JSON.stringify(body(p)));};
  const warm=page.prefetchPageData(`ocpp-${name}`);const expected=name==='users'?2:1;
  await until(()=>calls.length===expected && auth.__calls().some(c=>c.name==='bizflow_unread_summary'));
  const mount=read();await tick();assert.equal(calls.length,expected);hold.resolve();await warm;await mount;
  auth.__releaseAuth();await boot;await read();await home.getLiveUnreadState();
  assert.equal(calls.length,expected);assert.equal(auth.__calls().filter(c=>c.name==='bizflow_unread_summary').length,1);
  now+=44_000;await read();assert.equal(calls.length,expected);
});
await test('OCPP company-neutral package survives auth deriving a previously unknown company',async()=>{
  storage.delete('team-active-company-test-user');await live.prefetchOcppPage('ocpp-monitor');
  storage.set('team-active-company-test-user','verified-company');await live.getLiveOcppMonitorData();assert.equal(calls.length,1);
});
await test('IDB-compatible snapshot paints before held background request; repeated reads share that refresh',async()=>{
  await live.getLiveOcppMonitorData();now+=46_000;const hold=deferred();handler=async p=>{await hold.promise;return new Response(JSON.stringify(body(p,'updated')));};
  const first=await live.getLiveOcppMonitorData();assert.equal(first.piles[0].pileNo,'new');await live.getLiveOcppMonitorData();assert.equal(calls.length,2);
  hold.resolve();await until(()=>updates.some(v=>v.value?.piles?.[0]?.pileNo==='updated'));await live.getLiveOcppMonitorData();assert.equal(calls.length,2);
});
for(const change of ['user','token','version','auth','logout']) await test(`${change} while prefetched request is flying rejects old payload/cache/notification`,async()=>{
  const hold=deferred();handler=async p=>{if(calls.length===1)await hold.promise;return new Response(JSON.stringify(body(p,calls.length===1?'old':'current')));};
  const old=live.getLiveOcppMonitorData();const rejected=assert.rejects(old,e=>e.name==='AbortError');await until(()=>calls.length===1);
  if(change==='user')auth.__setSessionUser('different-user');
  if(change==='token')auth.__setToken('different-token');
  if(change==='version')await cache.invalidateLiveSnapshotCache(live.OCPP_CACHE_SNAPSHOTS.monitor);
  if(change==='auth')window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT));
  if(change==='logout'){auth.__setSessionUser(null);window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT));}
  const current=await Promise.race([live.getLiveOcppMonitorData(),new Promise((_,reject)=>setTimeout(()=>reject(Error("new scope reused obsolete held request")),100))]);hold.resolve();await rejected;
  assert.equal(updates.length,0);
  if(change==='logout')assert.equal(current,live.LIVE_OCPP_MISS);else assert.equal(current.piles[0].pileNo,'current');
});
await test('non-admin 403 is silent and session-wide memo prevents route/menu/mount retries; token change may retry',async()=>{
  const warnings=[];const warn=console.warn;console.warn=(...args)=>warnings.push(args);
  try {handler=async()=>new Response('{"error":"Forbidden"}',{status:403});
    await live.prefetchOcppPage('ocpp-monitor');await live.prefetchOcppPage('ocpp-monitor');await live.prefetchOcppPage('ocpp-finance');
    await assert.rejects(live.getLiveOcppMonitorData(),e=>e.status===403);assert.equal(calls.length,1);assert.deepEqual(warnings,[]);assert.deepEqual(updates,[]);
    auth.__setToken('new-permissions-token');await live.prefetchOcppPage('ocpp-monitor');assert.equal(calls.length,2);
  } finally {console.warn=warn;}
});
await test('oversized persistence fallback still returns valid live payload and shares the memory result',async()=>{
  const marker='x'.repeat(cache.LIVE_TABLE_CACHE_MAX_BYTES+100);
  handler=async p=>new Response(JSON.stringify(body(p,marker)));
  assert.equal((await live.getLiveOcppMonitorData()).piles[0].pileNo.length,marker.length);
  await live.getLiveOcppMonitorData();assert.equal(calls.length,1);
});
await test('non-403 failures allow normal mount retry and are never cached as static/MISS data',async()=>{
  handler=async()=>new Response('offline',{status:503});await live.prefetchOcppPage('ocpp-monitor');
  handler=async p=>new Response(JSON.stringify(body(p)));assert.equal((await live.getLiveOcppMonitorData()).piles[0].pileNo,'new');assert.equal(calls.length,2);
});
await test('persisted identity+token+schema claim permits document reload but rejects token/auth/write changes',async()=>{
  const context=await scope.sessionReadContext(live.OCPP_CACHE_SNAPSHOTS.monitor);const key=JSON.parse(context.scopeKey);key.push('token');
  const before=[...key];before[5]='prior-document';before[2]=2;before[3]='3:8';before[4]=[['3:0:5',5]];
  // After this test reset the current document is dirty, so cross-document adoption must be denied.
  assert.equal(scope.canAdoptReadScope({...context,scopeKey:JSON.stringify(key)},JSON.stringify(before)),false);
  assert.equal(scope.canAdoptReadScope({...context,scopeKey:JSON.stringify(key)},JSON.stringify(key)),true);
  before.splice(0,before.length,...key);before[6]='other-token';assert.equal(scope.canAdoptReadScope({...context,scopeKey:JSON.stringify(key)},JSON.stringify(before)),false);
});
await test('all four routes hook entry/navigate/menu; pointerenter+focusin trigger one intent; admin gate unchanged',async()=>{
  for(const name of Object.keys(readers))assert.equal(typeof routes.routeForPath(`/bizflow/ocpp-${name}.html`).prefetch,'function');
  const target=new EventTarget();const stop=hooks.installMenuPrefetch({documentRef:target,windowRef:window,delay:1});
  for(const type of ['pointerenter','focusin']){const e=new Event(type);Object.defineProperty(e,'target',{value:{closest:()=>({href:'https://fixture.invalid/bizflow/ocpp-monitor.html',hasAttribute:()=>false,target:''})}});target.dispatchEvent(e);}
  await until(()=>calls.length===1);await tick();stop();assert.equal(calls.length,1);
  for(const name of Object.keys(readers)){const source=await readFile(new URL(`../root-site/bizflow/ocpp-${name}.js`,import.meta.url),'utf8');assert.match(source,/requireOcppRouteAccess\(currentUser/);}
  for(const file of ['entry.js','app-router.js']){const source=await readFile(new URL(`../root-site/spa/${file}`,import.meta.url),'utf8');assert.match(source,/prefetchRoute\(/);}
});
Date.now=realNow;
console.log(`OCPP_PREFETCH=${passed}/${passed}`);
