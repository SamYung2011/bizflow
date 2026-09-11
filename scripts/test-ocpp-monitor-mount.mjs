import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createPageScope} from '../root-site/spa/page-lifecycle.js';
const h={summaryCalls:0,overviewCalls:0,rendered:[],getOverview:null};globalThis.__monitorFixture=h;
const stubs=new Map([
 ['../data/provider.js',`export const getCurrentUser=async()=>({isBfAdmin:true});
 export const getOcppMonitorData=async()=>{globalThis.__monitorFixture.summaryCalls++;return {piles:[],logs:[],commandLogs:[],alarms:[],logsDeferred:true}};
 export const getOcppMonitorLogsData=async()=>({logs:[]});`],
 ['../data/page-unread.js',`export const cachedPageUnread=()=>({unread:{}});export const loadPageUnread=async()=>({});`],
 ['../data/live-ocpp-commands.js',`export const ocppCommandClient={readOverview:()=>{globalThis.__monitorFixture.overviewCalls++;return globalThis.__monitorFixture.getOverview();}};`],
 ['../data/live-ocpp.js',`export const OCPP_CACHE_SNAPSHOTS={monitor:'monitor',logs:'logs'};export const getLiveOcppPileLogsPage=async()=>({});export const getLiveOcppRecentLogsPage=async()=>({});`],
 ['../components/date-range-filter.js',`export const latestDateInput=()=>'';export const createDateRangeFilter=()=>({restoreState(){},captureState(){return {}},close(){},matches(){return true}});`],
 ['./ocpp-command-view.js',`export const getOcppCommandRows=()=>[];export const syncOcppCommandForm=()=>{};export const renderOcppCommandStatus=({state})=>{globalThis.__monitorFixture.rendered.push(structuredClone(state));return JSON.stringify(state)};`],
 ['./ocpp-shared.js',`export const filterInput=()=>'';export const filterSelect=()=>'';export const renderTable=()=>'';export const statusChip=()=>'';
 export function makeOcppContext(){let h;return {t:k=>k,setHelpers(v){h=v},helpers:()=>h}};
 export const createOcppPage=({render})=>({render});export const renderOcppLayout=({body})=>body;
 export const requireOcppRouteAccess=u=>{if(!u.isBfAdmin)throw Error('denied')};`],
]);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../root-site/bizflow/ocpp-monitor.js',import.meta.url))],bundle:true,format:'esm',platform:'node',write:false,
 plugins:[{name:'local-monitor-fixture',setup(b){b.onResolve({filter:/.*/},a=>stubs.has(a.path)?{path:a.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs.get(a.path),loader:'js'}));}}]});
globalThis.window=new EventTarget();globalThis.document=new EventTarget();let element={outerHTML:''};document.querySelector=()=>element;
const monitor=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}};
const helpers={lang:'en',escapeHtml:String};
const tick=()=>new Promise(r=>setTimeout(r,0));
const until=async f=>{for(let i=0;i<100&&!f();i++)await tick();assert.ok(f());};
async function mount(){const scope=createPageScope();const controller=await Promise.race([
 monitor.mountPage({scope,signal:scope.signal,url:new URL('https://fixture.invalid/bizflow/ocpp-monitor.html'),historyState:{autoRefresh:false}}),
 new Promise((_,reject)=>setTimeout(()=>reject(Error('command overview blocked summary mount')),100))]);
 controller.page.render(helpers);controller.activate();return {scope,controller,dispose(){controller.dispose();scope.dispose();}};}
let passed=0;
let held=deferred();h.getOverview=()=>held.promise;
const first=await mount();assert.equal(h.summaryCalls,1);assert.equal(h.overviewCalls,1);assert.equal(h.rendered.at(-1).commandAuthenticated,false);
console.log(`ok ${++passed} - summary mounts and activates while proxy status/schedule are unresolved`);
held.resolve({authenticated:true,status:[{id:'ready'}],schedules:[],statusError:'',scheduleError:''});
await until(()=>h.rendered.at(-1).commandAuthenticated);assert.equal(h.rendered.at(-1).commandStatus[0].id,'ready');first.dispose();
console.log(`ok ${++passed} - command overview activates buttons only after status arrives`);
held=deferred();h.getOverview=()=>held.promise;const old=await mount();const oldHeld=held;old.dispose();
held=deferred();h.getOverview=()=>held.promise;const newer=await mount();const before=h.rendered.length;
oldHeld.resolve({authenticated:true,status:[{id:'obsolete'}],schedules:[]});await tick();assert.equal(h.rendered.length,before);
held.resolve({authenticated:true,status:[{id:'new-route'}],schedules:[]});await until(()=>h.rendered.at(-1).commandAuthenticated);assert.equal(h.rendered.at(-1).commandStatus[0].id,'new-route');newer.dispose();
console.log(`ok ${++passed} - disposed or superseded command load cannot mutate the next route`);
held=deferred();h.getOverview=()=>held.promise;const failed=await mount();held.reject(Error('fixture proxy unavailable'));
await until(()=>h.rendered.at(-1).commandStatusError);assert.equal(h.rendered.at(-1).commandAuthenticated,false);assert.match(h.rendered.at(-1).commandScheduleError,/unavailable/);failed.dispose();
console.log(`ok ${++passed} - proxy failure stays inside command area after summary is visible`);
console.log(`OCPP_MONITOR_MOUNT=${passed}/${passed}`);
