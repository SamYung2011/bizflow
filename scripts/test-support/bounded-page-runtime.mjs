import vm from 'node:vm';
import { readFileSync } from 'node:fs';
// Execute production page/functions with injected IO only. Test hooks expose existing
// lexical state without copying the request, mount, search or edit implementation.
export function instrumentModule(file, bindings, hooks) {
  const source=readFileSync(file,'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/\bexport (?=(?:async )?function|const |let |class )/g,'');
  const context=vm.createContext({console,URL,URLSearchParams,AbortController,DOMException,structuredClone,setTimeout,clearTimeout,Date,Map,Set,Promise,...bindings});
  return vm.runInContext(source+'\n;('+hooks+')',context,{filename:String(file)});
}
export function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
export function pageScope(){const controller=new AbortController(),cleanups=[];return{signal:controller.signal,isCurrent:()=>!controller.signal.aborted,onCleanup:fn=>cleanups.push(fn),listen(){},stop(){controller.abort();cleanups.forEach(fn=>fn());}};}
export const pageBindings={
  window:{location:{href:'http://localhost/bizflow/orders-detail.html?id=invoice'}},
  document:{querySelector:()=>null,querySelectorAll:()=>[],activeElement:null},
  createShippingFeePanel:()=>({isOpen:()=>false,dispose(){},close(){}}),
  createPrintDialog:()=>({dispose(){}}),
  cachedPageUnread:()=>({unread:{}}),loadPageUnread:async()=>{},
  createBizflowMenu:()=>[],renderNewCustomerFields:()=>'',renderSharedSegment:()=>'',
  throwIfPageAborted(signal,scope){if(signal?.aborted||!scope?.isCurrent())throw new DOMException('aborted','AbortError');}
};
