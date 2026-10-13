import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../root-site/shell/shell.js',import.meta.url),'utf8');
const skeleton=readFileSync(new URL('../root-site/shell/shell-skeleton.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../root-site/shell/shell.css',import.meta.url),'utf8');
let count=0;const check=(label,fn)=>{fn();console.log(`ok ${++count} - ${label}`);};
const storage=new Map([['bizflow-sidebar-collapsed','true']]);
const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
const root={childElementCount:0,setAttribute(){},removeAttribute(){},innerHTML:''};
const document={getElementById:()=>root};
const window={localStorage,location:{pathname:'/bizflow/orders.html'},matchMedia:()=>({matches:false,addEventListener(){}})};
check('synchronous boot skeleton starts collapsed from storage, before auth',()=>{
 vm.runInNewContext(skeleton,{document,window});assert.match(root.innerHTML,/is-sidebar-collapsed/);
});
check('mobile boot keeps drawer layout while remembering desktop choice',()=>{
 window.matchMedia=()=>({matches:true,addEventListener(){}});vm.runInNewContext(skeleton,{document,window});assert.match(root.innerHTML,/shell-app--mobile/);
 assert.match(css,/\.shell-app--desktop\.is-sidebar-collapsed \.shell-main\s*{\s*margin-left: 0/);
});
const functionSource=name=>source.slice(source.indexOf(`function ${name}(`),source.indexOf('\nfunction ',source.indexOf(`function ${name}(`)+1));
check('real toggle renderer uses both existing variants and accessible state',()=>{
 const context={state:{sidebarCollapsed:true},t:key=>key,escapeHtml:s=>s};
 const render=vm.runInNewContext(functionSource('renderSidebarToggle')+'\nrenderSidebarToggle',context);
 assert.match(render(),/shell-icon-button/);assert.match(render(),/btn-toggle-sidebar--open/);assert.match(render(),/aria-expanded="false"/);
 context.state.sidebarCollapsed=false;assert.match(render(),/btn-toggle-sidebar--close/);assert.match(render(),/aria-expanded="true"/);
});
check('toggle stores choice without full shell/page rebuild and hidden sidebar is inert',()=>{
 const start=source.indexOf('if (action === "toggle-sidebar"');const block=source.slice(start,source.indexOf('if (action === "open-drawer"',start));
 let synced=0;const state={sidebarCollapsed:false};const context={state,action:'toggle-sidebar',mode:'desktop',window,syncShellState:()=>synced++};
 vm.runInNewContext(block,context);assert.equal(state.sidebarCollapsed,true);assert.equal(storage.get('bizflow-sidebar-collapsed'),'true');assert.equal(synced,1);
 context.mode='mobile';vm.runInNewContext(block,context);assert.equal(state.sidebarCollapsed,true);assert.equal(synced,1);
 assert.match(source,/sidebar\.inert = hidden/);assert.doesNotMatch(block,/render\(/);
});
check('362px content limit is scoped to mobile and desktop content stays full width',()=>{
 assert.match(css,/\.shell-app--mobile \.shell-page-inner\s*{\s*width: min\(100%, 362px\)/);
 assert.equal((css.match(/\.shell-page-inner\s*{/g)||[]).length,2);
 assert.match(css,/\.shell-page-inner\s*{\s*width: 100%;\s*max-width: 100%/);
 assert.doesNotMatch(css,/\.shell-app--mobile \.shell-app--desktop/);
});
console.log(`SIDEBAR_COLLAPSE=${count}/${count}`);
