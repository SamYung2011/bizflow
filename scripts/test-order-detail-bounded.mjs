import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { instrumentModule, deferred, pageScope, pageBindings } from './test-support/bounded-page-runtime.mjs';
register('./test-support/data-phase1-auth-loader.mjs',import.meta.url);
globalThis.window=new EventTarget();globalThis.document={prerendering:false};
const auth=await import('../root-site/data/auth.js');
const query=await import('../root-site/data/live-orders-query.js');
const provider=await import('../root-site/data/provider.js');
const cache=await import('../root-site/data/live-query-cache.js');
const file=name=>new URL('../root-site/'+name,import.meta.url);
const RPC='bizflow_order_detail';
const payload={invoice:{id:'invoice',invoice_number:'999',customer_id:'customer',salesperson_id:'sales',date:'2026-09-11',items:[{id:'item',name:'Adapter',qty:2,price:100,warranty_months:12,imei_code:'123'}],total:200,status:'Unpaid'},customer:{id:'customer',name:'Buyer',phone:'123'},salesperson:{id:'sales',name:'Salesperson'},events:[],devices:[{imei:'123'}]};
let passed=0;async function check(label,run){await run();console.log(`ok ${++passed} - ${label}`);}
const reset=()=>{window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT));auth.__reset();cache.clearLiveQueryCache();auth.__setRpcData(RPC,structuredClone(payload));};
let detail;
await check('provider first screen uses one detail RPC with all associated display fields',async()=>{reset();detail=await provider.getOrderDetailData('invoice');assert.deepEqual(auth.__calls(),[{name:RPC,args:{p_invoice_id:'invoice'}}]);assert.equal(detail.detail.items.length,1);assert.equal(detail.detail.salesperson,'Salesperson');});
await check('warm detail no network; stale cache refreshes',async()=>{await query.getLiveOrderDetail('invoice');assert.equal(auth.__calls().length,1);cache.markLiveQueryCacheStale({userId:'test-user',namespace:'order-detail'});await query.getLiveOrderDetail('invoice');assert.equal(auth.__calls().length,2);});
await check('forced fresh edit read rejects errors instead of using stale invoice',async()=>{auth.__setRpcError(RPC,new Error('offline'));await assert.rejects(query.getLiveOrderDetail('invoice',{refresh:true}),/offline/);});
await check('nonexistent invoice returns null without snapshot fallback',async()=>{reset();auth.__setRpcData(RPC,null);assert.equal(await provider.getOrderDetailData('missing'),null);assert.equal(auth.__calls().length,1);});
await check('auth reset while RPC flies rejects its result',async()=>{reset();auth.__holdNextRpc(RPC);const rejected=assert.rejects(query.getLiveOrderDetail('invoice'),e=>e.name==='AbortError');for(let n=0;n<100&&!auth.__calls().length;n++)await new Promise(r=>setTimeout(r,0));window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT));auth.__releaseRpc();await rejected;});
const pageCalls=[],pending=[];let failOptions=false,holdPicker=false;
const page=instrumentModule(file('bizflow/orders-detail.js'),{...pageBindings,
 getOrderDetailData:async(id,options)=>{pageCalls.push(['detail',id,options]);return structuredClone(detail);},
 getCurrentUser:async()=>{pageCalls.push(['auth']);return{hasPermission(){return true;},bizflowMainAccess:true,canShip:true};},
 getOrderProductPickerData:async()=>{pageCalls.push(['picker']);if(holdPicker){const wait=deferred();pending.push(wait);return wait.promise;}return{productGroups:[{id:'product',name:'Adapter',options:[{id:'product',name:'Adapter',price:100}]}]};},
 getLiveOrderWriteOptions:async id=>{pageCalls.push(['options',id]);if(failOptions)throw new Error('options failed');return{invoice:{id,salesperson_id:'sales'},salespeople:[{id:'sales',name:'Salesperson'}],defaultWarehouseId:'warehouse'};}
},'({mountPage,ensureOrderEditData,onOrderDetailClick,renderSalespersonCard,renderLineRows,getState:()=>state,ready:()=>editReady,picker:()=>pickerData})');
let scope=pageScope(),mounted;const helpers={lang:'en',escapeHtml:String,icon:()=>''};
await check('page cold mount never loads picker or write options',async()=>{mounted=await page.mountPage({scope,signal:scope.signal});assert.deepEqual(pageCalls.map(c=>c[0]),['detail','auth']);assert.equal(page.ready(),false);assert.ok(page.renderSalespersonCard(helpers).includes('Salesperson'));assert.ok(!page.renderLineRows(helpers).includes('data-line-quantity'));});
await check('first edit loads picker + options + fresh invoice concurrently and deduplicates',async()=>{holdPicker=true;const one=page.ensureOrderEditData(),two=page.ensureOrderEditData();assert.equal(pageCalls.filter(c=>c[0]==='picker').length,1);assert.deepEqual(pageCalls.slice(-3).map(c=>c[0]),['picker','options','detail']);assert.equal(pageCalls.at(-1)[2].refresh,true);pending.at(-1).resolve({productGroups:[{id:'product',name:'Adapter',options:[]}]});assert.equal(await one,true);assert.equal(await two,true);assert.equal(page.ready(),true);assert.equal(page.getState().busy,'');assert.ok(page.renderLineRows(helpers).includes('data-line-quantity'));});
await check('subsequent edit open reuses candidate data',async()=>{const n=pageCalls.length;assert.equal(await page.ensureOrderEditData(),true);assert.equal(pageCalls.length,n);});
await check('edit failure restores controls and allows retry',async()=>{mounted.dispose();scope=pageScope();mounted=await page.mountPage({scope,signal:scope.signal});holdPicker=false;failOptions=true;assert.equal(await page.ensureOrderEditData(),false);assert.equal(page.ready(),false);assert.equal(page.getState().busy,'');assert.ok(page.getState().notice);failOptions=false;assert.equal(await page.ensureOrderEditData(),true);});
await check('unsaved shipping fields survive entering financial edit',async()=>{mounted.dispose();scope=pageScope();mounted=await page.mountPage({scope,signal:scope.signal});page.getState().trackingNumber='unsaved-waybill';await page.ensureOrderEditData();assert.equal(page.getState().trackingNumber,'unsaved-waybill');});
await check('disposed page cannot accept editor completion',async()=>{mounted.dispose();scope=pageScope();mounted=await page.mountPage({scope,signal:scope.signal});holdPicker=true;const late=page.ensureOrderEditData();scope.stop();mounted.dispose();pending.at(-1).resolve({productGroups:[{id:'stale'}]});assert.equal(await late,false);assert.equal(page.ready(),false);assert.equal(page.picker().productGroups.length,0);});
await check('save keeps its existing fresh select and scoped invoice ID',()=>{const source=readFileSync(file('data/live-orders-writes.js'),'utf8');const update=source.slice(source.indexOf('export async function updateLiveOrder('));assert.ok(update.includes('.from("invoices").select("*").eq("id", invoiceId).single()'));});
console.log(`ORDER_DETAIL_BOUNDED=${passed}/${passed}`);
