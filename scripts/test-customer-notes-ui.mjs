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
 await page.goto(origin+'/scripts/customer-notes-preview.html');await search('registered');await profile();await save('VIP 核對客戶 <script>');
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
 assert.deepEqual(errors,[]);console.log('CUSTOMER_NOTES_UI=4/4');
}finally{await browser.close();}
