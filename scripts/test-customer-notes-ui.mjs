import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const origin=process.env.PREVIEW_ORIGIN||'http://127.0.0.1:5199';
const output=process.env.EVIDENCE_DIR||'/tmp/customer-notes-ui';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
const drawer=page.getByRole('dialog',{name:'客戶檔案'});
async function search(q){const form=page.locator('.app-user-search form');await form.locator('input').fill(q);await form.getByRole('button',{name:'搜尋',exact:true}).click();}
async function profile(){await page.locator('.app-user-results button').filter({hasText:'registered@example.test'}).click();await drawer.getByRole('textbox',{name:'客戶備註'}).waitFor();}
async function save(text){await drawer.getByRole('textbox',{name:'客戶備註'}).fill(text);await drawer.getByRole('button',{name:'儲存備註',exact:true}).click();await drawer.getByRole('status').waitFor();}
try{
 await page.goto(origin+'/task-platform/scripts/customer-notes-preview.html');
 const title=page.locator('.customer-name-button');
 const selectedName=page.locator('.support-conversation.is-selected .support-conversation-title strong');
 const row=name=>page.locator('.support-conversation').filter({hasText:name});
 const closeProfile=()=>drawer.getByRole('button',{name:'關閉',exact:true}).click();
 const hasName=async name=>{
  await page.waitForFunction(name=>document.querySelector('.customer-name-button')?.textContent===name,name);
  assert.equal(await selectedName.textContent(),name);
 };
 await row('Alex Chan').click();await title.click();await drawer.getByRole('textbox',{name:'客戶備註'}).waitFor();
 // Delay subsequent reads: the confirmed save must update both labels immediately.
 await page.evaluate(()=>window.fixtureConfigureMock({delay:1500}));
 const remark='陳生 · 北上車主';await save(remark);
 assert.equal(await title.textContent(),remark);assert.equal(await selectedName.textContent(),remark);
 await page.evaluate(()=>window.fixtureConfigureMock({delay:10}));await closeProfile();
 assert.equal(await page.locator('.support-contact .support-original-name').textContent(),'APP 暱稱：Alex Chan');
 assert.equal(await page.locator('.support-conversation.is-selected .support-original-name').textContent(),'APP 暱稱：Alex Chan');
 assert.equal(await page.locator('.support-thread').getByText(remark,{exact:true}).count(),0);
 await page.screenshot({path:output+'/support-remark-name.png'});
 console.log('PASS a confirmed remark immediately names the chat and inbox, retaining the real nickname without sending a message');
 await row('Sophie Wong').click();await hasName('Sophie Wong');
 assert.equal(await page.locator('.support-contact .support-original-name').count(),0);
 await row(remark).click();await hasName(remark);
 await page.getByRole('tab',{name:'已結束',exact:true}).click();await row(remark).click();await hasName(remark);
 await page.getByRole('tab',{name:'待回覆',exact:true}).click();await row(remark).click();await hasName(remark);
 await page.getByRole('button',{name:'northbound',exact:true}).click();await search('Alex');
 await page.locator('.app-user-results button').filter({hasText:'alex@example.test'}).click();
 await drawer.getByRole('textbox',{name:'客戶備註'}).waitFor();await save('陳生 · 已核對資料');await closeProfile();
 await page.getByRole('button',{name:'support',exact:true}).click();await row('陳生 · 已核對資料').click();await hasName('陳生 · 已核對資料');
 console.log('PASS remarks stay with the customer across conversations, customer switches, and edits from northbound');
 await title.click();await drawer.getByRole('textbox',{name:'客戶備註'}).waitFor();
 const longRemark=('<script>長備註與換行\n').repeat(100);await save(longRemark);await closeProfile();
 assert.equal(await title.getAttribute('title'),longRemark.trim());assert.equal(await title.locator('script').count(),0);
 const fits=()=>page.evaluate(()=>{
  const title=document.querySelector('.customer-name-button'),header=document.querySelector('.support-header');
  return title.scrollWidth>title.clientWidth && title.getBoundingClientRect().right<=header.getBoundingClientRect().right
    && document.documentElement.scrollWidth<=window.innerWidth;
 });
 assert(await fits());await page.setViewportSize({width:390,height:844});assert(await fits());
 await page.screenshot({path:output+'/support-long-remark-mobile.png'});
 await page.setViewportSize({width:1440,height:1000});await title.click();await drawer.getByRole('textbox',{name:'客戶備註'}).waitFor();
 await page.evaluate(()=>window.fixtureConfigureMock({delay:1500}));await save('');
 assert.equal(await title.textContent(),'Alex Chan');assert.equal(await selectedName.textContent(),'Alex Chan');
 await page.evaluate(()=>window.fixtureConfigureMock({delay:10}));await closeProfile();
 assert.equal(await page.locator('.support-contact .support-original-name').count(),0);
 console.log('PASS long remarks stay escaped and bounded on desktop/mobile; clearing restores original names immediately');
 await search('registered');await profile();await save('VIP 核對客戶 <script>');
 assert.equal(await drawer.locator('script').count(),0);await drawer.getByRole('button',{name:'關閉',exact:true}).click();
 await search('VIP 核對');await profile();assert.equal(await drawer.getByRole('textbox',{name:'客戶備註'}).inputValue(),'VIP 核對客戶 <script>');await drawer.getByRole('button',{name:'關閉',exact:true}).click();
 assert.equal(await page.locator('.support-conversation').count(),0);console.log('PASS registered user can be found and annotated without inventing a conversation');
 for(const view of ['northbound','insurance']){
  await page.getByRole('button',{name:view,exact:true}).click();await search('王');
  assert(await page.evaluate(()=>window.fixtureQueries.some(url=>new URL(url,'https://fixture.invalid').searchParams.get('q')==='王')));
  await search('VIP 核對');await profile();assert.equal(await drawer.getByRole('textbox',{name:'客戶備註'}).inputValue(),'VIP 核對客戶 <script>');
  await page.screenshot({path:output+'/'+view+'-shared-notes.png'});await drawer.getByRole('button',{name:'關閉',exact:true}).click();
  console.log('PASS '+view+' reuses user/note search and retains single-character business search');
 }
 await profile();await drawer.getByRole('textbox',{name:'客戶備註'}).fill('本頁未儲存');await page.evaluate(()=>window.fixtureConcurrentNote(1));
 await drawer.getByRole('button',{name:'儲存備註',exact:true}).click();await drawer.getByRole('alert').waitFor();
 assert.equal(await drawer.getByRole('textbox',{name:'客戶備註'}).inputValue(),'本頁未儲存');
 await drawer.getByRole('button',{name:'重新載入備註',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.customer-note-form textarea')?.value==='另一位同事更新');
 await save('');await drawer.getByRole('button',{name:'關閉',exact:true}).click();await search('VIP 核對');await page.getByText('找不到使用者',{exact:true}).waitFor();
 console.log('PASS conflict preserves draft, explicit reload retrieves latest note, clearing removes search match');
 assert.deepEqual(errors,[]);console.log('CUSTOMER_NOTES_UI=7/7');
}catch(error){
 console.error({url:page.url(),pageErrors:errors,body:(await page.locator('body').innerText()).slice(0,3000)});
 await page.screenshot({path:output+'/failure.png'});throw error;
}finally{await browser.close();}
