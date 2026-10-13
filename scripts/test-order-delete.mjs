import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { instrumentModule, pageScope, pageBindings } from './test-support/bounded-page-runtime.mjs';
const file = name => new URL('../root-site/'+name, import.meta.url);
let count=0; async function check(label,run){await run();console.log(`ok ${++count} - ${label}`);}
const calls=[], invalidated=[];let access=true, error=null;
const writes=instrumentModule(file('data/live-orders-writes.js'), {
  getSupabaseClient:async()=>({rpc:async(name,args)=>{calls.push([name,args]);return {data:null,error};}}),
  getSession:async()=>({user:{id:'own-test-user'}}), getCurrentUser:async()=>({bizflowMainAccess:access}),
  invalidateLiveTables:async(...tables)=>invalidated.push(tables), invalidateOrderQueriesAfterWrite:async()=>invalidated.push(['query'])
},'({deleteLiveOrder})');
await check('one deletion RPC and all affected caches invalidated after success',async()=>{
  await writes.deleteLiveOrder('own-test-invoice');
  assert.equal(calls[0][0],'bizflow_delete_order');assert.equal(calls[0][1].p_invoice_id,'own-test-invoice');
  for(const table of ['invoices','inventory_stock','inventory_movements','shipment_events','customers'])assert.ok(invalidated[0].includes(table));
  assert.deepEqual(invalidated[1],['query']);
});
await check('denied write context never reaches RPC',async()=>{access=false;await assert.rejects(writes.deleteLiveOrder('x'));assert.equal(calls.length,1);access=true;});
await check('RPC error propagates and does not fake cache success',async()=>{error=new Error('failed');await assert.rejects(writes.deleteLiveOrder('x'),/failed/);assert.equal(invalidated.length,2);});
let accept=false,deleted=0,navigated=0,confirmed='';
const scope=pageScope();
const page=instrumentModule(file('bizflow/orders-detail.js'),{
  ...pageBindings, getOrderDetailData:async()=>({order:{id:'own-test-invoice'},detail:{orderNo:'DC129',fees:{},items:[]}}),
  getCurrentUser:async()=>({bizflowMainAccess:true,hasPermission:()=>true}),
  confirmInPage:async(message,options)=>{confirmed=message;assert.equal(options.danger,true);return accept;},
  deleteLiveOrder:async()=>{deleted++;}
},'({mountPage,onOrderDetailClick})');
const mount=await page.mountPage({scope,signal:scope.signal,navigation:{navigate:async(url)=>{assert.ok(url.pathname.endsWith('/orders.html'));navigated++;}}});
const click=()=>page.onOrderDetailClick({target:{closest:selector=>selector==='[data-order-delete]'?{}:null}});
await check('cancel confirmation containing order number leaves order unchanged',async()=>{await click();assert.ok(confirmed.includes('DC129'));assert.equal(deleted,0);});
await check('confirmed deletion returns to list through SPA navigation',async()=>{accept=true;await click();assert.equal(deleted,1);assert.equal(navigated,1);});
scope.stop();mount.dispose();
await check('button and translated confirmation present in source',()=>{const source=readFileSync(file('bizflow/orders-detail.js'),'utf8');assert.ok(source.includes('data-order-delete'));for(const value of ['刪除訂單','Delete order','Supprimer la commande'])assert.ok(source.includes(value));});
await check('delete invalidates cached detail before immediate back navigation',async()=>{
 const caches=new Map([['order-detail',{value:{order:{id:'own-deleted-order'}},stale:false}]]);
 let rpcCalls=0;
 const queries=instrumentModule(file('data/live-orders-query.js'),{
  sessionReadContext:async()=>({userId:'own-test-user'}),
  getSession:async()=>({user:{id:'own-test-user'}}),
  getSupabaseClient:async()=>({rpc:async()=>{rpcCalls++;return{data:null,error:null};}}),
  readLiveQueryCache:({namespace})=>caches.get(namespace),
  invalidateLiveQueryCacheAfterWrite:({namespace})=>caches.delete(namespace)
 },'({getLiveOrderDetail,invalidateOrderQueriesAfterWrite})');
 assert.equal((await queries.getLiveOrderDetail('own-deleted-order')).order.id,'own-deleted-order');
 await queries.invalidateOrderQueriesAfterWrite();
 assert.equal(await queries.getLiveOrderDetail('own-deleted-order'),null);assert.equal(rpcCalls,1);
});
console.log(`ORDER_DELETE=${count}/${count}`);
