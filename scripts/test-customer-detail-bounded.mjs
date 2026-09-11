import vm from 'node:vm';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
register('./test-support/data-phase1-auth-loader.mjs', import.meta.url);
globalThis.window = new EventTarget();
globalThis.document = { prerendering: false };
globalThis.CustomEvent ??= class extends Event { constructor(type, opts={}) { super(type); this.detail=opts.detail; } };
const auth = await import('../root-site/data/auth.js');
const query = await import('../root-site/data/live-customer-detail.js');
const provider = await import('../root-site/data/provider.js');
const cache = await import('../root-site/data/live-query-cache.js');
const deps = await import('../root-site/data/live-snapshot-dependencies.js');
const RPC='bizflow_customer_detail', id='10000000-0000-0000-0000-000000000001';
const payload={customer:{id,name:'Customer',phone:'123',groupCids:[id],detail:{orders:Array.from({length:86},(_,i)=>({no:String(i),date:'2026/09/11',price:1,quantity:1}))}},members:[{member_id:id}],devices:[{id:'device'}],warranties:[{invoiceId:'invoice'}]};
const reset=()=>{window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT));auth.__reset();cache.clearLiveQueryCache();auth.__setRpcData(RPC,structuredClone(payload));};
let passed=0;
async function check(label,run){await run();console.log(`ok ${++passed} - ${label}`);}
const waitForRpc=async()=>{for(let i=0;i<100&&!auth.__calls().length;i++)await new Promise(r=>setTimeout(r,0));assert.equal(auth.__calls().length,1);};
await check('provider cold detail makes exactly one RPC and retains history/devices/warranty',async()=>{reset();const value=await provider.getCustomerDetailData(id);assert.deepEqual(auth.__calls(),[{name:RPC,args:{p_customer_id:id}}]);assert.equal(value.detail.orders.length,86);assert.deepEqual(value.devices,payload.devices);assert.deepEqual(value.warranties,payload.warranties);});
await check('warm detail reuses account cache; refresh forces network',async()=>{const a=await provider.getCustomerDetailData(id);assert.equal(auth.__calls().length,1);const b=await provider.getCustomerDetailData(id,{refresh:true});assert.deepEqual(a,b);assert.equal(auth.__calls().length,2);});
await check('two in-flight consumers share one RPC',async()=>{reset();auth.__holdNextRpc(RPC);const a=query.getLiveCustomerDetail(id),b=query.getLiveCustomerDetail(id);await waitForRpc();auth.__releaseRpc();assert.deepEqual(await a,await b);assert.equal(auth.__calls().length,1);});
await check('expired cache is refreshed',async()=>{reset();cache.writeLiveQueryCache({userId:'test-user',namespace:'customer-detail',query:{id},value:{bad:true},now:0});assert.equal((await query.getLiveCustomerDetail(id)).customer.id,id);assert.equal(auth.__calls().length,1);});
for(const table of ['customers','invoices','customer_devices','products','warranty_renewals'])await check(`${table} write invalidation forces detail refetch`,async()=>{reset();await query.getLiveCustomerDetail(id);window.dispatchEvent(new CustomEvent(deps.LIVE_SNAPSHOT_INVALIDATED_EVENT,{detail:{snapshots:[...deps.snapshotsForTables([table])]}}));await query.getLiveCustomerDetail(id);assert.equal(auth.__calls().length,2);});
await check('RPC failure never falls through to old snapshot tables',async()=>{reset();auth.__setRpcError(RPC,{code:'57014',message:'timeout'});auth.__setTableError(new Error('forbidden old snapshot'));await assert.rejects(provider.getCustomerDetailData(id),e=>e.code==='57014');assert.equal(auth.__calls().length,1);});
await check('missing or denied customer stays null',async()=>{reset();auth.__setRpcData(RPC,null);assert.equal(await provider.getCustomerDetailData(id),null);assert.equal(auth.__calls().length,1);});
await check('account change cannot read another account cache',async()=>{reset();await query.getLiveCustomerDetail(id);auth.__setSessionUser('second-user');auth.__setRpcData(RPC,{...payload,customer:{...payload.customer,name:'Second'}});assert.equal((await query.getLiveCustomerDetail(id)).customer.name,'Second');assert.equal(auth.__calls().length,2);});
await check('auth reset rejects in-flight old identity',async()=>{reset();auth.__holdNextRpc(RPC);const pending=query.getLiveCustomerDetail(id);const rejection=assert.rejects(pending,e=>e.name==='AbortError');await waitForRpc();window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT));auth.__releaseRpc();await rejection;assert.equal(cache.readLiveQueryCache({userId:'test-user',namespace:'customer-detail',query:{id}}),null);});
await check('write during in-flight read discards its stale result',async()=>{reset();auth.__holdNextRpc(RPC);const rejection=assert.rejects(query.getLiveCustomerDetail(id),e=>e.name==='AbortError');await waitForRpc();window.dispatchEvent(new CustomEvent(deps.LIVE_SNAPSHOT_INVALIDATED_EVENT,{detail:{snapshots:['customers.json']}}));auth.__releaseRpc();await rejection;});
await check('invalid ID makes no RPC and malformed payload fails closed',async()=>{reset();assert.equal(await query.getLiveCustomerDetail('bad-id'),null);assert.equal(auth.__calls().length,0);auth.__setRpcData(RPC,{customer:{id}});await assert.rejects(query.getLiveCustomerDetail(id),/Invalid customer detail/);});
await check('post-save detail refresh and merge/device write entry points remain',()=>{const page=readFileSync(new URL('../root-site/bizflow/customer-detail.js',import.meta.url),'utf8');assert.match(page,/getCustomerDetailData\(detailData.customer.id, \{ refresh: true \}\)/);for(const name of ['updateLiveOrderCustomer','mergeLiveCustomerGroup'])assert.ok(page.includes(name));});
await check('failed post-write refresh after navigation cannot mutate the next page',async()=>{
  const source=readFileSync(new URL('../root-site/bizflow/customer-detail.js',import.meta.url),'utf8').match(/async function saveCustomerEdit\([^]*?\n}/)[0];
  let current=true,rejectRead,reading=false;
  const state={editDraft:{name:'Before'},editModelFallback:false,editModalOpen:true};
  const context={state,activeMountId:1,activeScope:{},detailData:{customer:{id}},console:{warn(){},error(){}},
    isCurrentCustomerDetailMount:()=>current,setCustomerDetailNotice(){},rerender(){},applyUpdatedCustomer(){},
    updateLiveOrderCustomer:async()=>({deviceConflicts:[]}),
    getCustomerDetailData:()=>{reading=true;return new Promise((_,reject)=>{rejectRead=reject;});}
  };
  const save=vm.runInNewContext(source+';saveCustomerEdit',context);
  const pending=save();for(let i=0;i<10&&!reading;i++)await Promise.resolve();assert.equal(reading,true);
  current=false;state.editDraft={name:'Next page'};state.editModalOpen=true;
  rejectRead(new Error('offline'));await pending;
  assert.equal(state.editModalOpen,true);assert.equal(state.editDraft.name,'Next page');
});
console.log(`CUSTOMER_DETAIL_BOUNDED=${passed}/${passed}`);
