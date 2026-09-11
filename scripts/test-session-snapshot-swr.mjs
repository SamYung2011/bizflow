import assert from 'node:assert/strict';
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
if (!process.argv.includes('--fixture')) {
  let passed=0;
  for(const snapshot of ['expense.json','whatsapp.json','inventory.json']) for(const mode of ['refresh','auth','company','write', ...(snapshot==='expense.json'?['storage']:[])]) {
    const result=spawnSync(process.execPath,[import.meta.filename,'--fixture',snapshot,mode],{encoding:'utf8'});
    assert.equal(result.status,0,`${snapshot}/${mode}: ${result.stdout}\n${result.stderr}`);
    console.log(`ok ${++passed} - ${snapshot}: TTL stale paints first; ${mode} respects scope/version ownership`);
  }
  console.log(`SESSION_SNAPSHOT_SWR=${passed}/${passed}`);
} else {
  register('./test-support/page-prefetch-auth-loader.mjs',import.meta.url);
  const [snapshot,mode]=process.argv.slice(-2);const storage=new Map();
  globalThis.window=new EventTarget();window.localStorage=window.sessionStorage={get length(){return storage.size;},key:i=>[...storage.keys()][i]??null,
    getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
  globalThis.CustomEvent ??= class extends Event {constructor(t,o={}){super(t);this.detail=o.detail;}};
  globalThis.fetch=async()=>{throw new Error('No real network allowed');};
  const auth=await import('../root-site/data/auth.js');
  const cache=await import('../root-site/data/live-table-cache.js');
  const utils=await import('../root-site/data/live-snapshot-utils.js');
  const snapshots=await import('../root-site/data/live-snapshots.js');
  const providerMemo=await import('../root-site/data/provider-snapshot-cache.js');
  const scope=await import('../root-site/data/live-read-scope.js');
  const tick=()=>new Promise(r=>setTimeout(r,0));
  const until=async f=>{for(let i=0;i<100&&!f();i++)await tick();assert.ok(f());};
  storage.set('team-active-company-test-user','company-test');
  const context=await scope.sessionReadContext(snapshot);
  const realNow=Date.now;let now=realNow();Date.now=()=>now;
  if(mode==='storage') {
    const description='x'.repeat(cache.LIVE_TABLE_CACHE_MAX_BYTES+100);
    auth.__setTableHandler(table=>table==='expense_reimbursements'?[{id:'oversized',description}]:[]);
    assert.equal((await snapshots.getLiveSnapshot(snapshot)).reimbursements[0].description.length,description.length);
    process.exit(0);
  }
  await cache.writeLiveSnapshotCache({userId:'test-user',snapshot,value:{marker:'stale'},version:cache.liveSnapshotCacheVersion(snapshot),scopeKey:context.scopeKey});
  now+=cache.LIVE_SNAPSHOT_CACHE_TTL_MS+1;
  let release;const hold=new Promise(r=>release=r);let blocked=true;
  auth.__setTableHandler(async()=>{if(blocked)await hold;return [];});
  const updates=[];window.addEventListener('tp:live-snapshot-updated',e=>{if(e.detail.snapshot===snapshot)updates.push(e.detail.value);});
  const cached=await snapshots.prefetchLiveSnapshot(snapshot);assert.equal(cached.marker,'stale');
  await until(()=>auth.__tableCalls().length>0);const batch=auth.__tableCalls().length;
  assert.equal((await snapshots.getLiveSnapshot(snapshot)).marker,'stale');assert.equal(auth.__tableCalls().length,batch);assert.equal(updates.length,0);
  if(mode==='auth')window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT));
  if(mode==='company')storage.set('team-active-company-test-user','different-company');
  if(mode==='write')await utils.invalidateLiveTableData([snapshot==='expense.json'?'expense_reimbursements':snapshot==='whatsapp.json'?'wa_messages':'products']);
  blocked=false;release();
  if(mode==='refresh') {
    await until(()=>updates.length===1);assert.equal((await snapshots.getLiveSnapshot(snapshot)).marker,undefined);
    assert.equal((await providerMemo.loadProviderSnapshot(snapshot,()=>{throw new Error('memo missing');})).marker,undefined);
    const persisted=await cache.readLiveSnapshotCache({userId:'test-user',snapshot});assert.equal(persisted.scopeKey,context.scopeKey);assert.equal(persisted.stale,false);
    assert.equal(auth.__tableCalls().length,batch);
  } else {
    await tick();await tick();assert.equal(updates.length,0,'old background refresh must not publish or retry');assert.equal(auth.__tableCalls().length,batch);
    assert.equal((await cache.readLiveSnapshotCache({userId:'test-user',snapshot}))?.value.marker,'stale','old result must not overwrite persisted cache');
    assert.equal((await snapshots.getLiveSnapshot(snapshot)).marker,undefined);assert.ok(auth.__tableCalls().length>batch,'mount under new scope must rebuild');
  }
  Date.now=realNow;
}
