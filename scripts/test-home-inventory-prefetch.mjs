import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
register('./test-support/page-prefetch-auth-loader.mjs', import.meta.url);
const storage = new Map();
globalThis.window = new EventTarget();
window.localStorage = window.sessionStorage = { get length(){return storage.size;}, key:i=>[...storage.keys()][i]??null,
  getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k) };
window.location = new URL('https://fixture.test/bizflow/home.html');
window.matchMedia = () => ({matches:false});
globalThis.document = {prerendering:false,querySelector:()=>null};
globalThis.CustomEvent ??= class CustomEvent extends Event {constructor(t,o={}){super(t);this.detail=o.detail;}};
const auth=await import('../root-site/data/auth.js');
const cache=await import('../root-site/data/live-table-cache.js');
const queryCache=await import('../root-site/data/live-query-cache.js');
const home=await import('../root-site/data/live-home-query.js');
const pages=await import('../root-site/data/page-prefetch.js');
const snapshots=await import('../root-site/data/live-snapshots.js');
const utils=await import('../root-site/data/live-snapshot-utils.js');
const provider=await import('../root-site/data/provider.js');
const realtime=await import('../root-site/data/live-realtime.js');
const tables=['products','warehouses','inventory_stock','shopify_catalog_bindings','shopify_variant_links','shopify_resource_mappings'];
const names=()=>auth.__calls().map(c=>c.name);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async fn=>{for(let i=0;i<100&&!fn();i++)await delay(0);assert.ok(fn());};
const dashboard=(orders=5)=>({counts:{orders},revenue:{total_revenue:31},shipping:{},inventory:{},tasks:[],stock:[]});
let passed=0;
async function reset(){
 auth.__releaseAuth();auth.__reset();window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT));
 await cache.clearLiveTableCache();queryCache.clearLiveQueryCache();await utils.invalidateLiveTableData(tables);
 storage.set('team-active-company-test-user','company-test');storage.set('team-employee-test-user','employee-test');
 auth.__setCurrentUser({id:'employee-test',activeCompanyId:'company-test',name:'Verified',canViewRevenue:true});
 auth.__setRpcData('bizflow_home_dashboard',dashboard());auth.__setTableHandler(()=>[]);
}
async function test(name,fn){await reset();await fn();console.log(`ok ${++passed} - ${name}`);}
// Fresh document: before any runtime invalidation, an existing persisted
// inventory snapshot must be claimable without re-running its six-table builder.
storage.set('team-active-company-test-user','company-test');
await cache.writeLiveSnapshotCache({userId:'test-user',snapshot:'inventory.json',value:{pageSize:18,buckets:[],products:[],warehouses:[],marker:'persisted'},version:cache.liveSnapshotCacheVersion('inventory.json')});
assert.equal((await snapshots.prefetchLiveSnapshot('inventory.json')).marker,'persisted');
assert.equal(auth.__tableCalls().length,0);
console.log(`ok ${++passed} - fresh document claims persisted inventory without six table requests`);
await test('home raw package + unread start before auth resolves; mapping waits for verified user',async()=>{
 auth.__holdAuth();const warm=pages.prefetchPageData('home');let mounted=false;
 const page=home.getLiveHomeDashboard().then(v=>{mounted=true;return v;});
 await wait(()=>names().includes('bizflow_home_dashboard')&&names().includes('bizflow_unread_summary'));
 await warm;assert.equal(mounted,false);auth.__releaseAuth();const result=await page;
 assert.equal(result.data.currentUser.name,'Verified');assert.equal(result.data.stats[0].value,5);
 await home.getLiveHomeDashboard();await home.getLiveUnreadState();assert.equal(names().length,2);
});
await test('home inflight request + repeated prefetch/mount share one RPC',async()=>{
 auth.__holdNextRpc('bizflow_home_dashboard');const warm=home.prefetchLiveHomeDashboard();await wait(()=>names().length===1);
 const others=[home.prefetchLiveHomeDashboard(),home.getLiveHomeDashboard()];await delay(0);assert.equal(names().length,1);
 auth.__releaseRpc();await Promise.all([warm,...others]);assert.equal(names().length,1);
});
await test('unknown company waits for auth, never guesses a null or first company',async()=>{
 storage.delete('team-active-company-test-user');auth.__holdAuth();const warm=home.prefetchLiveHomeDashboard();await delay(5);assert.equal(names().length,0);
 auth.__setCurrentUser({activeCompanyId:'actual'});storage.set('team-active-company-test-user','actual');auth.__releaseAuth();await warm;
 await home.getLiveHomeDashboard();assert.equal(names().length,1);assert.equal(auth.__calls()[0].args.p_company_id,'actual');
});
await test('remembered wrong company cannot reach mapper; verified company starts independently',async()=>{
 storage.set('team-active-company-test-user','old');let release;const held=new Promise(r=>release=r);
 auth.__setRpcHandler('bizflow_home_dashboard',async args=>{if(args.p_company_id==='old')await held;return dashboard(args.p_company_id==='old'?999:7);});
 const warm=home.prefetchLiveHomeDashboard();await wait(()=>names().length===1);
 storage.set('team-active-company-test-user','company-test');const actual=await home.getLiveHomeDashboard();assert.equal(actual.data.stats[0].value,7);
 release();await warm;assert.equal(names().length,2);
});
await test('home auth/permission changes, user change and catch-up invalidate the raw package',async()=>{
 await home.prefetchLiveHomeDashboard();await cache.invalidateLiveAuthCache();auth.__setCanViewRevenue(false);
 const result=await home.getLiveHomeDashboard();assert.equal(result.currentUser.canViewRevenue,false);assert.equal(names().length,2);
 auth.__setSessionUser('other');await home.getLiveHomeDashboard();assert.equal(names().length,3);
 await cache.invalidateLiveSnapshotCache('home.json');await home.getLiveHomeDashboard();assert.equal(names().length,4);
});
await test('home write during prefetch retries; logout cannot deliver its former user payload',async()=>{
 auth.__holdNextRpc('bizflow_home_dashboard');const warm=home.prefetchLiveHomeDashboard();await wait(()=>names().length===1);
 await cache.invalidateLiveSnapshotCache('home.json');auth.__releaseRpc();await warm;assert.equal(names().length,2);
 auth.__holdNextRpc('bizflow_home_dashboard');const read=home.getLiveHomeDashboard({refresh:true});await wait(()=>names().length===3);
 auth.__setSessionUser(null);window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT));auth.__releaseRpc();assert.equal(await read,home.LIVE_HOME_QUERY_MISS);
});
await test('home failure retries on mount, stale offline data remains available, fresh never revalidates',async()=>{
 auth.__setRpcError('bizflow_home_dashboard',new Error('offline'));await assert.rejects(home.prefetchLiveHomeDashboard());
 auth.__setRpcError('bizflow_home_dashboard',null);await home.getLiveHomeDashboard();await home.getLiveHomeDashboard();assert.equal(names().length,2);
 queryCache.markLiveQueryCacheStale({userId:'test-user',namespace:'home-dashboard'});auth.__setRpcError('bizflow_home_dashboard',new Error('offline'));
 assert.equal((await home.getLiveHomeDashboard({refresh:true})).offline,true);
});
await test('inventory six tables overlap auth; provider mount uses the single builder',async()=>{
 auth.__holdAuth();let release;const held=new Promise(r=>release=r);auth.__setTableHandler(async()=>{await held;return [];});
 const warm=pages.prefetchPageData('inventory');await wait(()=>auth.__tableCalls().length===6);
 const page=provider.getInventoryPageData();await delay(0);assert.equal(auth.__tableCalls().length,6);
 release();await warm;auth.__releaseAuth();await page;await provider.getInventoryPageData();assert.equal(auth.__tableCalls().length,6);
 assert.deepEqual(auth.__tableCalls().map(c=>c.table).sort(),tables.slice().sort());
 storage.set('team-active-company-test-user','B');await provider.getInventoryPageData();assert.equal(auth.__tableCalls().length,12);
});
await test('actual first SUBSCRIBED catch-up invalidates inventory in flight; next build owns all six reads',async()=>{
 let release;const held=new Promise(r=>release=r);let n=0;auth.__setTableHandler(async()=>{if(++n<=6)await held;return [];});
 const warm=snapshots.prefetchLiveSnapshot('inventory.json');await wait(()=>n===6);
 let status;const channel={on(){return this;},subscribe(fn){status=fn;}};let catchups=0;
 const manager=realtime.createLiveRealtimeManager({loadClient:async()=>({channel:()=>channel,removeChannel:async()=>{}}),
  loadSession:auth.getSession,loadCurrentUser:async()=>({userId:'test-user',bizflowMainAccess:true}),
  invalidateTables:utils.invalidateLiveTableData,refreshTables:async()=>{},markTablesStale:async(t)=>{catchups++;await utils.invalidateLiveTableData(t);}});
 await manager.ensure();status('SUBSCRIBED');await wait(()=>catchups===1);await delay(0);release();await warm;
 assert.equal(n,12);status('SUBSCRIBED');await delay(0);assert.equal(catchups,1);
 await utils.invalidateLiveTables('inventory_stock');await provider.getInventoryPageData();assert.equal(n,18);
 await manager.dispose();
});
await test('inventory account/auth changes and logout do not reuse old builder',async()=>{
 await snapshots.prefetchLiveSnapshot('inventory.json');assert.equal(auth.__tableCalls().length,6);
 await cache.invalidateLiveAuthCache();await provider.getInventoryPageData();assert.equal(auth.__tableCalls().length,12);
 auth.__setSessionUser('other');await provider.getInventoryPageData();assert.equal(auth.__tableCalls().length,18);
 auth.__setSessionUser(null);window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT));assert.equal(await snapshots.getLiveSnapshot('inventory.json'),snapshots.LIVE_SNAPSHOT_MISS);
});
await test('home/inventory route hooks exist and revenue mapper stays intact',async()=>{
 const {routeForPath}=await import('../root-site/spa/route-manifest.js');
 assert.equal(typeof routeForPath('/bizflow/home.html').prefetch,'function');assert.equal(typeof routeForPath('/bizflow/inventory.html').prefetch,'function');
 const source=await readFile(new URL('../root-site/data/live-home-query.js',import.meta.url),'utf8');
 assert.match(source,/mapDashboard\(payload, live.currentUser\)/);assert.doesNotMatch(source.slice(source.indexOf('async function fetchHomeDashboard'),source.indexOf('async function readHomePackage')),/mapDashboard/);
});
await test('local two-wave timing fixture: page/unread overlap two auth waves; hot mount adds zero calls',async()=>{
 const timings={};auth.__holdAuth();const start=performance.now();
 auth.__setRpcHandler('bizflow_home_dashboard',async()=>{timings.page=performance.now()-start;await delay(30);return dashboard();});
 auth.__setRpcHandler('bizflow_unread_summary',async()=>{timings.unread=performance.now()-start;await delay(30);return {unread:{},watermarks:{}};});
 const warm=pages.prefetchPageData('home');const mounted=home.getLiveHomeDashboard();await delay(30);timings.authWave2=performance.now()-start;await delay(30);auth.__releaseAuth();
 await Promise.all([warm,mounted]);timings.cold=performance.now()-start;const before=names().length;
 const hot=performance.now();await home.getLiveHomeDashboard();await home.getLiveUnreadState();timings.hot=performance.now()-hot;
 assert.ok(timings.page<timings.authWave2&&timings.unread<timings.authWave2);assert.equal(names().length,before);
 console.log('LOCAL_WAVES='+JSON.stringify({waveMs:30,expectedAuthWaves:2,...timings}));
});
console.log(`HOME_INVENTORY_PREFETCH=${passed}/${passed}`);
