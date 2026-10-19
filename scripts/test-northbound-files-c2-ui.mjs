import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const origin=process.env.PREVIEW_ORIGIN||'http://127.0.0.1:5199', output=process.env.EVIDENCE_DIR||'/tmp/support-profile-c2-1019';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
const errors=[],external=[];let checks=0;
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin===origin || ['data:','blob:'].includes(url.protocol)
    || url.protocol==='chrome:' && url.hostname==='resources'
    || url.protocol==='chrome-extension:' && url.hostname==='mhjfbmdgcfjbbpaeojofohoefgiehjai')return route.continue();
  external.push(url.href);return route.abort();
});
await page.addInitScript(()=>{
  if (window.top !== window) return;
  localStorage.setItem('bizflow-lang',new URLSearchParams(location.search).get('lang')||'zh');
  window.__createdUrls=[];window.__revokedUrls=[];
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
  URL.createObjectURL=blob=>{const url=create(blob);window.__createdUrls.push(url);return url;};
  URL.revokeObjectURL=url=>{window.__revokedUrls.push(url);revoke(url);};
});
const calls=()=>page.evaluate(()=>window.__assistCalls.filter(c=>c.path.startsWith('/northbound/files/')).map(c=>c.path.split('/')[3]));
const reset=()=>page.evaluate(()=>{window.__assistCalls.length=0;window.__createdUrls=[];window.__revokedUrls=[];});
const check=name=>console.log(`FILES_C2_UI ${++checks}: ${name}`);
async function openWorkspace(assist=false,lang='zh') {
  await page.goto(`${origin}/scripts/tg5-c-preview.html?view=assist&files=1&lang=${lang}`);
  if(!assist){await page.locator('.nb-case').first().click();}
  else {
    await page.locator('.nb-assist-launch').click();
    await page.locator('.assist-search input').fill('Alex');await page.locator('.assist-search button').click();
    await page.locator('.assist-users button').filter({hasText:'Alex Chan'}).click();
    await page.getByRole('button',{name:'建立草稿'}).click();
    await page.getByLabel('指定司機 1',{exact:true}).fill('Alex Chan');
    await page.getByRole('button',{name:'儲存並上傳文件'}).click();
  }
  await page.locator('.nb-doc-open').first().waitFor();
}
try {
  for(const assist of [false,true]) {
    await openWorkspace(assist);
    const location=assist?'assisted draft':'CaseDetail';
    assert.equal(await page.locator('.nb-doc-open').count(),3);
    assert.deepEqual(await calls(),[]);
    const meta=await page.locator('.nb-doc-open').filter({hasText:'proof.pdf'}).innerText();
    assert(meta.includes('application/pdf')&&meta.includes('20 KB')&&meta.includes('2026'));
    assert.equal(await page.locator('.nb-doc-open img').count(),0);
    check(`${location}: metadata only, zero file requests before clicking`);
    await page.locator('.nb-doc-open').filter({hasText:'vehicle.jpg'}).click();
    const modal=page.getByRole('dialog',{name:'查看文件'});
    await modal.locator('img').waitFor();
    await page.waitForFunction(()=>document.querySelector('.nb-preview img')?.naturalWidth>0);
    assert.deepEqual(await calls(),['vehicle-thumb']);
    const size=await modal.locator('img').evaluate(n=>({width:n.naturalWidth,display:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}));
    assert.equal(size.width,480);assert(size.display<=540 && size.height<=360);
    await page.screenshot({path:`${output}/c2-file-${assist?'assist':'case'}-thumbnail.png`});
    await modal.getByRole('button',{name:'開啟原檔',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.nb-preview img')?.naturalWidth===2400);
    assert.deepEqual(await calls(),['vehicle-thumb','vehicle-original']);
    assert(await modal.getByRole('button',{name:'開啟原檔',exact:true}).isDisabled());
    await modal.getByRole('button',{name:'關閉',exact:true}).click();
    const urls=await page.evaluate(()=>({made:window.__createdUrls,revoked:window.__revokedUrls}));
    assert.equal(urls.made.length,2);assert.deepEqual(urls.revoked,urls.made);
    check(`${location}: thumbnail then original only after explicit click; both URLs revoked on close`);
    await reset();
    await page.locator('.nb-doc-open').filter({hasText:'proof.pdf'}).click();await modal.waitFor();
    await modal.locator('.nb-pdf-first-page[aria-busy=false] canvas:not([hidden])').waitFor();
    assert.deepEqual(await calls(),['proof-original']);assert.equal(await modal.locator('img').count(),0);
    assert((await modal.innerText()).includes('20 KB'));
    await page.screenshot({path:`${output}/c2-file-${assist?'assist':'case'}-pdf-preview.png`});
    await modal.getByRole('button',{name:'開啟原檔',exact:true}).click();await modal.locator('iframe:not(.nb-pdf-first-page)').waitFor();
    assert.deepEqual(await calls(),['proof-original']);
    await modal.getByRole('button',{name:'關閉',exact:true}).click();
    check(`${location}: PDF preview fetches once on click; full viewer reuses the same bytes`);
    await reset();
    await page.locator('.nb-doc-open').filter({hasText:'legacy.jpg'}).click();await modal.waitFor();
    assert.deepEqual(await calls(),[]);
    await modal.getByRole('button',{name:'開啟原檔',exact:true}).click();await modal.locator('img').waitFor();
    assert.deepEqual(await calls(),['no-thumb-original']);await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});
    check(`${location}: missing thumbnail never silently downloads the original`);
  }
  await openWorkspace();await reset();
  await page.evaluate(()=>{
    const fetch=window.fetch;
    window.fetch=async(url,init)=>{
      if(String(url).includes('/files/vehicle-thumb/'))await new Promise(resolve=>window.__releaseThumb=resolve);
      return fetch(url,init);
    };
  });
  await page.locator('.nb-doc-open').filter({hasText:'vehicle.jpg'}).click();
  await page.getByRole('dialog',{name:'查看文件'}).getByRole('button',{name:'關閉',exact:true}).click();
  await page.evaluate(async()=>{window.__releaseThumb();await new Promise(resolve=>setTimeout(resolve,100));});
  assert.deepEqual(await page.evaluate(()=>window.__createdUrls),[]);
  assert.equal(await page.locator('.nb-preview').count(),0);
  assert.deepEqual(await calls(),['vehicle-thumb']);
  check('closing during thumbnail request never creates or retains an object URL');
  for(const [lang,open] of [['en','Open original'],['fr','Ouvrir l’original']]) {
    await openWorkspace(false,lang);
    await page.locator('.nb-doc-open').filter({hasText:'vehicle.jpg'}).click();
    await page.locator('.nb-preview img').waitFor();
    const modal=page.locator('.nb-preview');assert(!/[\u3400-\u9fff]/.test(await modal.innerText()));
    await modal.getByRole('button',{name:open,exact:true}).waitFor();
    assert.deepEqual(await calls(),['vehicle-thumb']);
    check(`${lang}: preview metadata and actions translated, no original prefetch`);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(`NORTHBOUND_FILES_C2_UI_CHECK=${checks}/${checks}`);
} finally {await browser.close();}
