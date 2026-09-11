import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { instrumentModule, deferred, pageScope, pageBindings } from './test-support/bounded-page-runtime.mjs';
import { createDebouncedTask } from '../root-site/components/debounced-task.js';
const file=name=>new URL('../root-site/'+name,import.meta.url);
let passed=0;async function check(label,run){await run();console.log(`ok ${++passed} - ${label}`);}
const plain=value=>JSON.parse(JSON.stringify(value));
const calls=[], pending=[];
let authCalls=0, networkError=null;
const transport=instrumentModule(file('data/live-order-customer-search.js'),{
 getSession:async()=>{authCalls++;return{user:{id:'one'}};},
 getSupabaseClient:async()=>({rpc(name,args){const call={name,args};calls.push(call);return{abortSignal(signal){call.signal=signal;return this;},then(resolve,reject){return Promise.resolve({data:{rows:[],hasMore:false},error:networkError}).then(resolve,reject);}}}})
},'({searchOrderCustomers})');
await check('empty search makes no auth or customer request',async()=>{assert.deepEqual(plain(await transport.searchOrderCustomers('  ')),{rows:[],hasMore:false});assert.equal(authCalls,0);assert.equal(calls.length,0);});
await check('one character search carries offset and abort signal in one RPC',async()=>{const controller=new AbortController();await transport.searchOrderCustomers(' x ',{offset:20,signal:controller.signal});assert.deepEqual(plain(calls[0].args),{p_search:'x',p_offset:20});assert.equal(calls[0].name,'bizflow_order_customer_candidates');assert.equal(calls[0].signal,controller.signal);});
await check('search error propagates without whole-table fallback',async()=>{networkError=new Error('timeout');await assert.rejects(transport.searchOrderCustomers('x'),/timeout/);networkError=null;});
const pageCalls=[];let timers=new Map(),timerId=0;
const page=instrumentModule(file('bizflow/orders-create.js'),{...pageBindings,
 getCurrentUser:async()=>{pageCalls.push('auth');return{hasPermission(){return true;},bizflowMainAccess:true};},
 getOrderProductPickerData:async()=>{pageCalls.push('inventory');return{productGroups:[]};},
 getLiveOrderWriteOptions:async(...args)=>{pageCalls.push(['options',...args]);return{salespeople:[],defaultWarehouseId:null};},
 createDebouncedTask:fn=>createDebouncedTask(fn,{delay:200,scheduleTimeout(callback,delay){assert.equal(delay,200);const id=++timerId;timers.set(id,callback);return id;},cancelTimeout:id=>timers.delete(id)}),
 searchOrderCustomers:async(term,options)=>{const wait=deferred();pending.push({term,options,...wait});return wait.promise;}
},'({mountPage,loadCustomerCandidates,resetCustomerSearch,onOrderCreateClick,onOrderCreateInput,selectedCustomer,renderCustomerSelect,getState:()=>state,getData:()=>data})');
const scope=pageScope();let mount;
const tick=async()=>{await new Promise(r=>setTimeout(r,0));};
const input=value=>page.onOrderCreateInput({target:{closest:selector=>selector==='[data-customer-search]'?{value}:null}});
const click=selector=>page.onOrderCreateClick({target:{matches:()=>false,closest:s=>s===selector?{}:null}});
const helpers={lang:'en',escapeHtml:String,icon:()=>''};
await check('initial mount reads inventory + thin options, zero customer/invoice snapshot',async()=>{mount=await page.mountPage({scope,signal:scope.signal});mount.activate();assert.deepEqual(plain(pageCalls),['auth','inventory',['options']]);assert.equal(page.getData().customers.length,0);assert.equal(pending.length,0);});
await check('opening picker without typing makes no search',async()=>{await click('[data-customer-trigger]');assert.equal(pending.length,0);assert.ok(page.renderCustomerSelect(helpers).includes('Type at least one character'));});
await check('debounce collapses rapid input and blank cancels',async()=>{input('a');input('ab');assert.equal(timers.size,1);input(' ');assert.equal(timers.size,0);assert.equal(pending.length,0);});
await check('newer search aborts previous and discards late result',async()=>{input('old');const old=page.loadCustomerCandidates();input('new');const latest=page.loadCustomerCandidates();assert.equal(pending[0].options.signal.aborted,true);pending[1].resolve({rows:[{id:'new',name:'New',isGroupPrimary:true}],hasMore:true});await latest;pending[0].resolve({rows:[{id:'old'}],hasMore:false});await old;assert.equal(page.getState().customerResults[0].id,'new');assert.ok(page.renderCustomerSelect(helpers).includes('Group primary'));});
await check('load more appends server page and uses returned row count offset',async()=>{const next=page.loadCustomerCandidates(true);assert.equal(pending.at(-1).options.offset,1);pending.at(-1).resolve({rows:[{id:'two'}],hasMore:false});await next;assert.deepEqual(plain(page.getState().customerResults.map(r=>r.id)),['new','two']);});
await check('selected customer survives next candidate search',async()=>{page.getState().selectedCustomerId='new';input('other');const next=page.loadCustomerCandidates();pending.at(-1).resolve({rows:[{id:'other'}],hasMore:false});await next;assert.equal(page.selectedCustomer().id,'new');assert.equal(page.getData().customers.length,2);});
await check('failure leaves picker usable and clears busy state',async()=>{const next=page.loadCustomerCandidates();pending.at(-1).reject(new Error('offline'));await next;assert.equal(page.getState().customerLoading,false);assert.equal(page.getState().customerSearchError,true);assert.ok(page.renderCustomerSelect(helpers).includes('Search failed'));});
await check('closing menu aborts request and clears debounce',async()=>{input('closing');const next=page.loadCustomerCandidates();await click('[data-customer-trigger]');assert.equal(pending.at(-1).options.signal.aborted,true);assert.equal(timers.size,0);pending.at(-1).resolve({rows:[{id:'ignored'}]});await next;assert.equal(page.getState().customerResults.length,0);});
await check('route disposal discards pending completion without leaking state',async()=>{await click('[data-customer-trigger]');input('dispose');const next=page.loadCustomerCandidates();scope.stop();mount.dispose();pending.at(-1).resolve({rows:[{id:'ignored'}]});await next;await tick();assert.equal(page.getData(),null);assert.equal(timers.size,0);});
const optionCalls=[];
const client={from(table){const operations=[];optionCalls.push({table,operations});const request=new Proxy({then(resolve,reject){return Promise.resolve({data:table==='employees'?[{id:'s',name:'',email:'fallback@example.test'}]:table==='warehouses'?[{id:'w'}]:{id:'invoice'},error:null}).then(resolve,reject);}},{get(obj,key){if(key==='then')return obj.then.bind(obj);return(...args)=>{operations.push([key,...args]);return request;};}});return request;}};
const writes=instrumentModule(file('data/live-orders-writes.js'),{getSupabaseClient:async()=>client,getSession:async()=>({user:{id:'one'}}),getCurrentUser:async()=>({bizflowMainAccess:true})},'({getLiveOrderWriteOptions})');
await check('write options use narrow employee fields, bounded warehouse, no invoice for create',async()=>{const result=await writes.getLiveOrderWriteOptions();assert.equal(result.salespeople[0].name,'fallback@example.test');assert.deepEqual(optionCalls.map(c=>c.table),['employees','warehouses']);assert.ok(optionCalls[0].operations.some(o=>o[0]==='select'&&o[1]==='id,name,email'));assert.ok(optionCalls[0].operations.some(o=>o[0]==='eq'&&o[1]==='role'));assert.ok(optionCalls[1].operations.some(o=>o[0]==='limit'&&o[1]===1));});
await check('edit options still fetch the exact fresh invoice in parallel',async()=>{optionCalls.length=0;const result=await writes.getLiveOrderWriteOptions('invoice');assert.equal(result.invoice.id,'invoice');assert.deepEqual(optionCalls.map(c=>c.table),['employees','warehouses','invoices']);assert.ok(optionCalls[2].operations.some(o=>o[0]==='eq'&&o[1]==='id'&&o[2]==='invoice'));});
await check('existing max-number retry and inventory six-table boundary retained',()=>{const source=readFileSync(file('data/live-orders-writes.js'),'utf8');assert.ok(source.includes('.order("invoice_number", { ascending: false })'));assert.ok(source.includes('23505'));const picker=readFileSync(file('data/order-product-picker.js'),'utf8');assert.ok(picker.includes('getInventoryPageData'));assert.ok(!picker.includes('getCustomersPageData'));});
console.log(`ORDER_CREATE_BOUNDED=${passed}/${passed}`);
