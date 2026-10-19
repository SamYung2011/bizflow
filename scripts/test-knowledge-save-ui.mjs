import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const origin=process.env.PREVIEW_ORIGIN||'http://127.0.0.1:5199', output=process.env.EVIDENCE_DIR||'/tmp/tg5-c-1019';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:850}});page.setDefaultTimeout(10000);
const external=[], errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',r=>{if(new URL(r.request().url()).origin===origin)return r.continue();external.push(r.request().url());return r.abort();});
await page.addInitScript(()=>{
  window.__noticeScroll=[];
  const scroll=Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView=function(options){if(this.classList.contains('knowledge-notice'))window.__noticeScroll.push({text:this.textContent,options});return scroll.call(this,options);};
});
async function saveWithNoticeOutside(editor) {
  await page.evaluate(()=>{
    const fetch=window.fetch;
    window.fetch=async(input,options)=>{if(options?.method==='POST')await new Promise(resolve=>setTimeout(resolve,350));return fetch(input,options);};
  });
  const previous=await page.evaluate(()=>window.__noticeScroll.length);
  await editor.getByRole('button',{name:'儲存',exact:true}).click();
  await page.locator('.nb-main').evaluate(node=>{node.scrollTop=0;});
  await page.locator('.knowledge-notice').getByText('已儲存',{exact:true}).waitFor();
  await page.waitForFunction(()=>{const node=document.querySelector('.knowledge-notice'), container=document.querySelector('.nb-main');if(!node)return false;const a=node.getBoundingClientRect(),b=container.getBoundingClientRect();return a.top>=Math.max(0,b.top)&&a.bottom<=Math.min(innerHeight,b.bottom)+1;});
  const calls=await page.evaluate(()=>window.__noticeScroll);
  assert.equal(calls.length,previous+1);assert.equal(calls.at(-1).text,'已儲存');assert.equal(calls.at(-1).options.block,'nearest');
}
try {
  await page.goto(`${origin}/scripts/p11-knowledge-preview.html`);
  const topic=page.locator('.knowledge-topic-editor');await topic.getByRole('button',{name:'編輯主題',exact:true}).click();
  await saveWithNoticeOutside(topic);
  await page.screenshot({path:`${output}/c6-topic-save-notice.png`});
  console.log('KNOWLEDGE_SAVE_UI 1: topic save reveals feedback inside scroll container');
  await page.getByRole('button',{name:'收起主題編輯'}).click();
  const articleButton=page.locator('.knowledge-article-link').first();await articleButton.click();
  await page.locator('.knowledge-article-editor').waitFor();
  await saveWithNoticeOutside(page.locator('.knowledge-article-editor'));
  await page.screenshot({path:`${output}/c6-article-save-notice.png`});
  const state=await page.evaluate(()=>window.__P11_STATE());
  assert.equal(state.articles.find(row=>row.id===11).title['zh-Hant'],'如何查看充電紀錄');
  console.log('KNOWLEDGE_SAVE_UI 2: article save preserves content and reveals feedback');
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('KNOWLEDGE_SAVE_UI_CHECK=2/2');
} finally {await browser.close();}
