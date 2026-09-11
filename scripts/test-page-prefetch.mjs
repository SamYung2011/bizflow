import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
register('./test-support/page-prefetch-auth-loader.mjs', import.meta.url);
const storage = new Map();
globalThis.window = new EventTarget();
window.localStorage = window.sessionStorage = {
  get length() { return storage.size; }, key: i => [...storage.keys()][i] ?? null,
  getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,String(v)), removeItem: k => storage.delete(k)
};
window.matchMedia = () => ({ matches: false });
window.location = new URL('https://fixture.test/bizflow/orders.html');
window.setTimeout = setTimeout; window.clearTimeout = clearTimeout;
globalThis.document = { prerendering: false, querySelector: () => null };
globalThis.CustomEvent ??= class CustomEvent extends Event { constructor(t,o={}) { super(t); this.detail = o.detail; } };
const auth = await import('../root-site/data/auth.js');
const cache = await import('../root-site/data/live-table-cache.js');
const queries = await import('../root-site/data/live-query-cache.js');
const orders = await import('../root-site/data/live-orders-query.js');
const customers = await import('../root-site/data/live-customers-query.js');
const home = await import('../root-site/data/live-home-query.js');
const snapshots = await import('../root-site/data/live-snapshots.js');
const provider = await import('../root-site/data/provider.js');
const utils = await import('../root-site/data/live-snapshot-utils.js');
const state = await import('../root-site/data/read-state.js');
const page = await import('../root-site/data/page-prefetch.js');
const defaults = await import('../root-site/data/page-query-state.js');
const presets = await import('../root-site/components/navigation-presets.js');
const routes = await import('../root-site/spa/route-manifest.js');
const hooks = await import('../root-site/spa/route-prefetch.js');
let passed = 0;
const tick = () => new Promise(r => setTimeout(r,0));
const wait = async fn => { for(let i=0;i<100&&!fn();i++) await tick(); assert.ok(fn(),'request must start before releasing auth/network'); };
const names = () => auth.__calls().map(c=>c.name);
const tables = ['expense_reimbursements','employees','wa_settings','wa_whitelist','wa_clients','wa_heartbeat','wa_messages','wa_replies','wa_unresolved','wa_daily_reports','wa_logs','products','warehouses','inventory_stock','shopify_catalog_bindings','shopify_variant_links','shopify_resource_mappings'];
async function reset() {
  auth.__releaseAuth(); window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT)); auth.__reset();
  auth.__setCurrentUser({id:'employee-test',activeCompanyId:'company-test'});
  queries.clearLiveQueryCache(); await cache.clearLiveTableCache();
  await utils.invalidateLiveTableData(tables);
  storage.set('team-active-company-test-user','company-test'); storage.set('team-employee-test-user','employee-test');
  storage.delete('tp-read-state-v1:acct:employee-test'); state.setReadStateAccount(null);
  auth.__setTableHandler(() => []);
}
async function test(name, fn) { await reset(); await fn(); console.log(`ok ${++passed} - ${name}`); }
// Simulate a fresh document reading a valid entry created after an older
// document's catch-up. Per-document counters alone must not cause a refetch.
const scope = await import('../root-site/data/live-read-scope.js');
storage.set('team-active-company-test-user','company-test');
const persistedContext = await scope.sessionReadContext('orders-page');
const priorScope = JSON.parse(persistedContext.scopeKey);
priorScope[2] = 7; priorScope[3] = '5:4'; priorScope[4][0] = ['5:2:9',9]; priorScope[5] = 'previous-document';
queries.writeLiveQueryCache({userId:'test-user',namespace:'orders-page',query:orders.normalizeOrderQuery(),value:{orders:[],totalCount:42},scopeKey:JSON.stringify(priorScope)});
assert.equal((await orders.getLiveOrdersPage()).totalCount,42); assert.equal(names().length,0);
console.log(`ok ${++passed} - fresh persisted entry survives document-local version reset`);
for (const [route,rpc] of [['orders','bizflow_order_page'],['customers','bizflow_customer_page']]) {
  await test(`${route}: page RPC and unread overlap blocked auth; settled mount/fresh mount issue no duplicate`, async()=>{
    auth.__holdAuth(); const bootstrap=auth.getCurrentUser(); const warm=page.prefetchPageData(route);
    await wait(()=>names().includes(rpc)&&names().includes('bizflow_unread_summary'));
    assert.equal(state.getReadStateAccount(),null); await warm; auth.__releaseAuth(); await bootstrap;
    const query = route==='orders'?defaults.orderPageQuery(defaults.orderPageState()):defaults.customerPageQuery(defaults.customerPageState());
    const read=route==='orders'?orders.getLiveOrdersPage:customers.getLiveCustomersPage;
    await read(query); await read(query); await home.getLiveUnreadState(); await home.getLiveUnreadState();
    assert.deepEqual(names().sort(),[rpc,'bizflow_unread_summary'].sort());
  });
}
await test('inflight orders mount + duplicate intent claim exactly one request',async()=>{
  auth.__holdNextRpc('bizflow_order_page'); const warm=orders.prefetchOrdersPage(); await wait(()=>names().length===1);
  const readers=[orders.getLiveOrdersPage(),orders.prefetchOrdersPage()]; await tick(); assert.equal(names().length,1);
  auth.__releaseRpc(); await Promise.all([warm,...readers]); assert.equal(names().length,1);
});
await test('warranty preset is peeked, not consumed; exact history/date/size is shared with mount',async()=>{
  presets.setNavigationPreset(presets.navigationPresetKeys.customersTab,'warranty');
  presets.setNavigationPreset(presets.navigationPresetKeys.warrantySearch,'serial');
  await page.prefetchPageData('customers');
  assert.equal(presets.consumeNavigationPreset(presets.navigationPresetKeys.customersTab),'warranty');
  assert.equal(auth.__calls().find(c=>c.name==='bizflow_warranty_page').args.p_search,'serial');
  assert.equal(auth.__calls().find(c=>c.name==='bizflow_customer_page').args.p_limit,18);
  window.matchMedia=()=>({matches:true});
  const history={page:3,source:'framer',imei:'has',sort:'lastPurchaseAsc',search:' A ',dateFilter:{from:'2026-09-11',to:'2026-09-01'}};
  await page.prefetchPageData('customers',{historyState:history});
  await customers.getLiveCustomersPage(defaults.customerPageQuery(defaults.customerPageState(history),history.dateFilter));
  const q=auth.__calls().filter(c=>c.name==='bizflow_customer_page'); assert.equal(q.length,2);
  assert.equal(q[1].args.p_limit,9); assert.equal(q[1].args.p_offset,18); assert.equal(q[1].args.p_date_from,'2026-09-01');
  window.matchMedia=()=>({matches:false});
});
await test('orders preset and history query variants never claim another filter',async()=>{
  presets.setNavigationPreset(presets.navigationPresetKeys.ordersShipping,'pending'); presets.setNavigationPreset(presets.navigationPresetKeys.ordersSearch,'needle');
  await page.prefetchPageData('orders');
  await orders.getLiveOrdersPage({shipping:'pending',search:'needle'}); assert.equal(names().filter(n=>n==='bizflow_order_page').length,1);
  await orders.getLiveOrdersPage({shipping:'delivered',search:'needle'}); assert.equal(names().filter(n=>n==='bizflow_order_page').length,2);
});
for (const namespace of ['orders','customers','warranty']) {
  const read=namespace==='orders'?orders.getLiveOrdersPage:namespace==='customers'?customers.getLiveCustomersPage:customers.getLiveWarrantyPage;
  await test(`${namespace}: company, user, auth and snapshot changes invalidate fresh results`,async()=>{
    await read(); storage.set('team-active-company-test-user','B'); await read();
    auth.__setSessionUser('second'); await read(); await cache.invalidateLiveAuthCache(); await read();
    await cache.invalidateLiveSnapshotCache(namespace==='orders'?'orders.json':namespace==='customers'?'customers.json':'warranty.json'); await read();
    assert.equal(names().length,5);
  });
}
await test('write while request flies discards it and retries; logout never returns that payload',async()=>{
  let resolve; const held=new Promise(r=>resolve=r); let n=0;
  auth.__setRpcHandler('bizflow_order_page',async()=>{ const version=++n; if(version===1) await held; return {rows:[],total_count:version}; });
  const warm=orders.prefetchOrdersPage(); await wait(()=>n===1); await cache.invalidateLiveSnapshotCache('orders.json'); resolve();
  assert.equal((await warm).totalCount,2); assert.equal(n,2);
  auth.__holdNextRpc('bizflow_order_page'); const read=orders.getLiveOrdersPage({search:'logout'}); await wait(()=>names().length===3);
  auth.__setSessionUser(null); window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT)); auth.__releaseRpc();
  assert.equal(await read,orders.LIVE_ORDER_QUERY_MISS);
});
await test('failed speculative RPC permits normal mount retry; TTL-stale offline fallback remains usable',async()=>{
  auth.__setRpcError('bizflow_order_page',new Error('offline')); await assert.rejects(orders.prefetchOrdersPage());
  auth.__setRpcError('bizflow_order_page',null); await orders.getLiveOrdersPage();
  queries.markLiveQueryCacheStale({userId:'test-user',namespace:'orders-page'});
  auth.__setRpcError('bizflow_order_page',new Error('offline'));
  assert.equal((await orders.getLiveOrdersPage({}, {refresh:true})).offline,true);
});
await test('warranty invalidation also rejects an inflight customer page, matching its existing stale signal',async()=>{
  auth.__holdNextRpc('bizflow_customer_page');const pending=customers.prefetchCustomersPage();await wait(()=>names().length===1);
  await cache.invalidateLiveSnapshotCache('warranty.json');auth.__releaseRpc();await pending;assert.equal(names().length,2);
});
await test('a failing refresh after auth invalidation cannot return its old cached payload',async()=>{
  await orders.getLiveOrdersPage();auth.__holdNextRpc('bizflow_order_page');
  const pending=orders.getLiveOrdersPage({}, {refresh:true});await wait(()=>names().length===2);
  await cache.invalidateLiveAuthCache();auth.__setRpcError('bizflow_order_page',new Error('offline'));auth.__releaseRpc();
  await assert.rejects(pending);assert.equal(names().length,3);
});
await test('unread inflight and fully-read watermark reuse; partial watermark and company require new request',async()=>{
  auth.__setRpcData('bizflow_unread_summary',{unread:{orders:3},watermarks:{orders:'2026-09-11T00:00:00Z'}});
  auth.__holdNextRpc('bizflow_unread_summary'); const warm=home.prefetchLiveUnreadState(); await wait(()=>names().length===1);
  const mount=home.getLiveUnreadState(); auth.__releaseRpc(); await Promise.all([warm,mount]); assert.equal(names().length,1);
  state.setReadStateAccount('employee-test'); state.markRead('orders','2026-09-11T00:00:00Z');
  assert.equal((await home.getLiveUnreadState()).unread.orders,0); assert.equal(names().length,1);
  state.markRead('orders','2026-09-10T00:00:00Z'); await home.getLiveUnreadState(); assert.equal(names().length,2);
  auth.__setCurrentUser({activeCompanyId:'B'}); await home.getLiveUnreadState(); assert.equal(names().length,3);
});
for (const [name,count] of [['expense',2],['whatsapp',9]]) {
  await test(`${name}: all ${count} tables overlap auth/settings; mount claims single builder`,async()=>{
    auth.__holdAuth(); let release; const hold=new Promise(r=>release=r); auth.__setTableHandler(async()=>{await hold;return [];});
    const warm=page.prefetchPageData(name); await wait(()=>auth.__tableCalls().length===count);
    const read = name === "expense" ? provider.getExpenseData : provider.getWhatsappData;
    const mount=read(); await tick(); assert.equal(auth.__tableCalls().length,count);
    release(); await warm; auth.__releaseAuth(); await mount;
    await read(); assert.equal(auth.__tableCalls().length,count);
    storage.set("team-active-company-test-user", "B"); await read(); assert.equal(auth.__tableCalls().length,2*count);
  });
}
await test('snapshot first catch-up and later write during build force versioned fresh rebuild',async()=>{
  let release;const hold=new Promise(r=>release=r);let calls=0;
  auth.__setTableHandler(async()=>{ if(++calls<=2) await hold;return []; });
  const warm=snapshots.prefetchLiveSnapshot('expense.json'); await wait(()=>calls===2);
  await utils.invalidateLiveTableData(['expense_reimbursements','employees']); release(); await warm; assert.equal(calls,4);
  await utils.invalidateLiveTableData(['expense_reimbursements']); await snapshots.getLiveSnapshot('expense.json'); assert.equal(calls,6);
});
await test('snapshot TTL/catch-up stale cache remains an offline fallback and retries on recovery',async()=>{
  await provider.getExpenseData(); await utils.invalidateLiveTableData(['expense_reimbursements','employees']);
  auth.__setTableError(new Error('offline')); assert.deepEqual((await provider.getExpenseData()).reimbursements,[]);
  auth.__setTableError(null); await provider.getExpenseData(); assert.equal(auth.__tableCalls().length,4);
});
await test('menu pointer/focus once, same-origin business only; entry + navigate run prefetch before mounting',async()=>{
  const target=new EventTarget();const stop=hooks.installMenuPrefetch({documentRef:target,windowRef:window,delay:1});
  const send=(type,href)=>{const event=new Event(type);Object.defineProperty(event,'target',{value:{closest:()=>({href,hasAttribute:()=>false,target:''})}});target.dispatchEvent(event);};
  send('pointerenter','https://fixture.test/bizflow/orders.html');send('focusin','https://fixture.test/bizflow/orders.html');
  send('focusin','https://outside.test/bizflow/customers.html');send('focusin','https://fixture.test/bizflow/ocpp-monitor.html');
  await wait(()=>names().includes('bizflow_order_page'));await tick();stop();
  assert.equal(names().filter(n=>n==='bizflow_order_page').length,1);
  assert.ok(routes.routeForPath('/bizflow/ocpp-monitor.html').prefetch);assert.ok(!routes.routeForPath('/bizflow/app-feedback.html').prefetch);
  const entry=await readFile(new URL('../root-site/spa/entry.js',import.meta.url),'utf8');
  const router=await readFile(new URL('../root-site/spa/app-router.js',import.meta.url),'utf8');
  assert.ok(entry.indexOf('void prefetchRoute')<entry.indexOf('await shell.shellReady'));
  assert.doesNotMatch(entry, /historyState: window.history.state/, 'cold startup must match the existing default-state mount');
  assert.ok(router.indexOf('void prefetchRoute')<router.indexOf('await commitLoadingFrame({',router.indexOf('async function navigate(')));
  const source=await readFile(new URL('../root-site/data/page-prefetch.js',import.meta.url),'utf8');assert.doesNotMatch(source,/mountPage\s*\(/);
});
console.log(`PAGE_PREFETCH=${passed}/${passed}`);
