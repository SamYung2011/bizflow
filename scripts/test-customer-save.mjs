import assert from 'node:assert/strict';
import { instrumentModule, deferred, pageScope, pageBindings } from './test-support/bounded-page-runtime.mjs';
import { showNotice, clearNotice } from '../root-site/components/notice.js';
const file=name=>new URL('../root-site/'+name,import.meta.url);
let count=0;async function check(label,run){await run();console.log(`ok ${++count} - ${label}`);}
const id='10000000-0000-0000-0000-000000000001';
const payload=name=>({customer:{id,name,imeiCodes:['987654321098765'],detail:{orders:[],email:'',carMake:'',carModelValue:'',carModel:'',shippingAddress:''}},members:[],devices:[{imei:'987654321098765'}],warranties:[]});
const calls=[], cached=[];
const query=instrumentModule(file('data/live-customer-detail.js'),{
  getSession:async()=>({user:{id:'one'}}), getSupabaseClient:async()=>({rpc(){const next=deferred();calls.push(next);return next.promise;}}),
  readLiveQueryCache:()=>cached.at(-1), writeLiveQueryCache:({value})=>cached.push({value,stale:false}),
  invalidateLiveQueryCacheAfterWrite:()=>{},customerRow:row=>row
},'({getLiveCustomerDetail})');
const wait=async(n)=>{for(let i=0;i<50&&calls.length<n;i++)await Promise.resolve();assert.equal(calls.length,n);};
await check('forced post-write refresh supersedes an older in-flight read and keeps the new cache',async()=>{
  const old=query.getLiveCustomerDetail(id);const rejected=assert.rejects(old,e=>e.name==='AbortError');await wait(1);
  const fresh=query.getLiveCustomerDetail(id,{refresh:true});await wait(2);
  calls[1].resolve({data:payload('Changed'),error:null});assert.equal((await fresh).customer.name,'Changed');
  calls[0].resolve({data:payload('Before'),error:null});await rejected;
  assert.equal(cached.at(-1).value.customer.name,'Changed');
});
const raw=payload('Before');const details={...raw,detail:raw.customer.detail};const scope=pageScope(), refresh=deferred(), notices=[], painted=[];
let reading=false,written;
const fields=[{getAttribute:()=> 'name',value:'Changed without input event'}, {getAttribute:()=> 'imei',value:'123456789012345'}];
const helpers={lang:'en',escapeHtml:value=>String(value??''),icon:()=>''};
const page=instrumentModule(file('bizflow/customer-detail.js'),{
  ...pageBindings,console:{...console,warn(){},error(){}},
  document:{querySelector:selector=>selector==='[data-customer-detail-page]'?{set outerHTML(value){painted.push(value);}}:null,querySelectorAll:()=>fields},
  getCurrentUser:async()=>({bizflowMainAccess:true,hasPermission:()=>true}),
  getCustomerDetailData:async()=>{if(reading)return refresh.promise;return structuredClone(details);},
  updateLiveOrderCustomer:async(_,values)=>{written=values;reading=true;return {customer:{id,name:values.name,phone:'',email:'',address:'',car_make:'',car_model:''},deviceConflicts:[],deviceError:null};},
  showNotice:(...args)=>notices.push(args),renderEmailSuggestion:()=>'',renderManagementPager:()=>''
},'({mountPage,openEditModal,saveCustomerEdit,customerImeis,data:()=>detailData,state:()=>state})');
const mount=await page.mountPage({scope,signal:scope.signal,url:new URL('http://localhost/bizflow/customer-detail.html?id='+id)});
mount.page.render(helpers);page.openEditModal();
const pending=page.saveCustomerEdit();
for(let i=0;i<30&&!notices.length;i++)await Promise.resolve();
await check('save reads the visible form even without an input event',()=>assert.equal(written.name,'Changed without input event'));
await check('committed customer and success notice render before slow detail refresh',()=>{
  assert.equal(page.state().editModalOpen,false);assert.equal(page.data().customer.name,written.name);
  assert.deepEqual(notices[0],['Saved','success']);assert.ok(painted.at(-1).includes(written.name));
});
refresh.resolve(structuredClone(details));await pending;
await check('stale refresh cannot overwrite committed fields and all IMEIs remain visible',()=>{
  assert.equal(page.data().customer.name,written.name);
  assert.deepEqual([...page.customerImeis()],['987654321098765','123456789012345']);
  assert.ok(painted.at(-1).includes('data-customer-imeis'));assert.ok(painted.at(-1).includes('123456789012345'));
});
scope.stop();mount.dispose();
let node=null,expires=null,delay=0;
globalThis.window={clearTimeout(){},setTimeout(fn,ms){expires=fn;delay=ms;return 1;}};
globalThis.document={body:{append(value){node=value;}},createElement(){return {dataset:{},setAttribute(name,value){this[name]=value;},remove(){node=null;}};}};
await check('shared floating notice is one instance, expires at 2.5 seconds and distinguishes success/error',()=>{
  showNotice('Saved');assert.equal(node.role,'status');assert.equal(delay,2500);assert.ok(node.className.includes('--success'));expires();assert.equal(node,null);
  showNotice('Retry','error');assert.equal(node.role,'alert');assert.ok(node.className.includes('--error'));clearNotice();assert.equal(node,null);
});
console.log(`CUSTOMER_SAVE=${count}/${count}`);
