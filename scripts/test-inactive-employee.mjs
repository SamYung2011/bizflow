import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as auth from '../root-site/data/auth.js';
import * as cache from '../root-site/data/live-table-cache.js';
const client=await auth.getSupabaseClient();
globalThis.fetch=async()=>{throw new Error('Unexpected network');};
globalThis.window=new EventTarget();const storage=new Map();
const sessionStorage=new Map();
const store=values=>({get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)});
window.localStorage=store(storage);window.sessionStorage=store(sessionStorage);
globalThis.CustomEvent??=class extends Event{constructor(t,o={}){super(t);this.detail=o.detail;}};
let session,active=true,signedOut=0,count=0,reads=[];
client.auth.getSession=async()=>({data:{session},error:null});
client.auth.signOut=async()=>{signedOut++;session=null;await client.auth._notifyAllSubscribers('SIGNED_OUT',null,false);return {error:null};};
client.from=table=>{let q;const read=async()=>{reads.push(table);return {error:null,data:table==='employees'?{id:'emp',user_id:'user',active,is_admin:true}:[],count:0};};q={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,range:()=>q,maybeSingle:read,then:(yes,no)=>read().then(yes,no)};return q;};
const reset=async()=>{auth.resetCurrentUserMemory();await cache.clearLiveTableCache();storage.clear();sessionStorage.clear();active=true;signedOut=0;reads=[];session={user:{id:'user',email:'samyung2011@gmail.com'},access_token:'fixture-token'};};
const check=async(label,fn)=>{await reset();await fn();console.log(`ok ${++count} - ${label}`);};
await check('pure auth gate blocks inactive admin before email fallback',()=>{
 assert.equal(auth.deriveAuthContext({session,employee:{active:false},bindings:[],companies:[],roles:[]}),null);
});
await check('cold inactive lookup signs out and does not cache or query pending',async()=>{
 active=false;await auth.getCurrentUser().catch(e=>assert.equal(e.name,'AbortError'));
 assert.equal(signedOut,1);assert.equal(reads.includes('company_join_pending'),false);
 assert.equal(await cache.readLiveAuthCache('user'),null);assert.equal(auth.consumeDisabledAccountNotice(),true);assert.equal(auth.consumeDisabledAccountNotice(),false);
});
await check('fresh cached inactive row signs out without employee query',async()=>{
 await cache.activateLiveTableCacheUser('user');await cache.writeLiveAuthCache({userId:'user',employee:{id:'emp',active:false},pendingCompanyIds:[],version:cache.liveAuthCacheVersion()});
 assert.equal(await auth.getCurrentUser(),null);assert.equal(signedOut,1);assert.equal(reads.length,0);
});
await check('stale active cache signs out immediately when background lookup finds inactive',async()=>{
 await auth.getCurrentUser();auth.resetCurrentUserMemory();active=false;
 const real=Date.now;Date.now=()=>real()+cache.LIVE_AUTH_CACHE_TTL_MS+1;
 try {await auth.getCurrentUser().catch(e=>assert.equal(e.name,'AbortError'));for(let i=0;i<30&&!signedOut;i++)await new Promise(r=>setTimeout(r,0));assert.equal(signedOut,1);assert.equal(session,null);}finally{Date.now=real;}
});
await check('both React routes block inactive before admin render',()=>{
 const source=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
 assert.match(source('src/App.jsx'),/currentEmployee\?\.active !== false &&/);
 assert.match(source('team/src/App.jsx'),/qEmp\.data\?\.active === false\) return <Center>/);
 for(const f of ['src/i18n.jsx','team/src/i18n.jsx'])assert.match(source(f),/Your account has been disabled/);
});
await check('disabled notice is session-only and pending onboarding keeps its own text',()=>{
 window.localStorage.setItem('bizflow-account-disabled','1');assert.equal(auth.consumeDisabledAccountNotice(),false);
 window.sessionStorage.setItem('bizflow-account-disabled','1');assert.equal(auth.consumeDisabledAccountNotice(),true);assert.equal(auth.consumeDisabledAccountNotice(),false);
 assert.equal(window.localStorage.getItem('bizflow-account-disabled'),'1');
 const source=readFileSync(new URL('../root-site/login/login.js',import.meta.url),'utf8');
 for(const text of ['账户尚未通过人员审核','Your personnel account is awaiting approval',"Votre compte employé est en attente d'approbation"])assert.ok(source.includes(text));
 assert.equal((source.match(/"auth.disabled":/g)||[]).length,3);
});
console.log(`INACTIVE_EMPLOYEE=${count}/${count}`);
