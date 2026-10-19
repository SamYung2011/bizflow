import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const origin = process.env.PREVIEW_ORIGIN || 'http://127.0.0.1:5199';
const output = process.env.EVIDENCE_DIR || '/tmp/northbound-preview-r2-1019';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [], external = [], evidence = [];
let checks = 0;
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)
    || url.protocol === 'chrome:' && url.hostname === 'resources'
    || url.protocol === 'chrome-extension:' && url.hostname === 'mhjfbmdgcfjbbpaeojofohoefgiehjai') return route.continue();
  external.push(url.href); return route.abort();
});
await page.addInitScript(() => {
  if (window.top !== window) return;
  localStorage.setItem('bizflow-lang', new URLSearchParams(location.search).get('lang') || 'zh');
  window.__previewBlobs = []; window.__previewRevoked = [];
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = blob => { const url = create(blob); window.__previewBlobs.push({ blob, url }); return url; };
  URL.revokeObjectURL = url => { window.__previewRevoked.push(url); revoke(url); };
});
const modal = page.locator('.nb-file-preview');
const calls = () => page.evaluate(() => window.__assistCalls.filter(c => c.path.startsWith('/northbound/files/')).map(c => c.path.split('/')[3]));
const check = name => console.log(`PREVIEW_R2_UI ${++checks}: ${name}`);
async function workspace(assist = false, params = '') {
  await page.goto(`${origin}/scripts/tg5-c-preview.html?view=assist&files=1${params}`);
  if (!assist) await page.locator('.nb-case').first().click();
  else {
    await page.locator('.nb-assist-launch').click();
    await page.locator('.assist-search input').fill('Alex'); await page.locator('.assist-search button').click();
    await page.locator('.assist-users button').filter({ hasText: 'Alex Chan' }).click();
    await page.getByRole('button', { name: '建立草稿' }).click();
    await page.getByLabel('指定司機 1', { exact: true }).fill('Alex Chan');
    await page.getByRole('button', { name: '儲存並上傳文件' }).click();
  }
  await page.locator('.nb-doc-open').first().waitFor();
}
async function openPdf() {
  await page.locator('.nb-doc-open').filter({ hasText: 'proof.pdf' }).click();
  await modal.locator('canvas:not([hidden])').waitFor();
}
async function firstScreen() {
  const dimensions = await modal.evaluate(dialog => {
    const rect = node => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom }; };
    return { dialog:rect(dialog), header:rect(dialog.querySelector('header')), metadata:rect(dialog.querySelector(':scope > small')),
      button:rect(dialog.querySelector('.nb-primary')), viewport:{ width:innerWidth, height:innerHeight } };
  });
  for (const key of ['dialog','header','metadata','button']) {
    const r = dimensions[key]; assert(r.y >= 0 && r.bottom <= dimensions.viewport.height, `${key} must be in the first screen`);
  }
  evidence.push(dimensions);
}
try {
  for (const assist of [false, true]) {
    await workspace(assist);
    assert.deepEqual(await calls(), []);
    assert.equal(await page.locator('canvas, .nb-preview iframe').count(), 0);
    check(`${assist ? 'AssistFiles' : 'CaseDetail'}: no file bytes before click`);
    await openPdf();
    assert.deepEqual(await calls(), ['proof-original']);
    const pixels = await modal.locator('canvas').evaluate(canvas => {
      const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let ink=0, blue=0, pink=0;
      for(let i=0;i<data.length;i+=4) {
        const [r,g,b,a] = data.slice(i,i+4);
        if(a && r<100 && g<140 && b<190) ink++;
        if(a && r>210 && g>225 && b>245) blue++;
        if(a && r>230 && g<100 && b>130) pink++;
      }
      return { ink, blue, pink, width:canvas.width, height:canvas.height };
    });
    assert(pixels.ink>1000 && pixels.blue>100000, 'actual first-page form and text must render');
    assert.equal(pixels.pink,0,'second-page content must not be rendered');
    assert.equal(await modal.locator('canvas').count(),1);
    const metadata = await modal.innerText();
    for(const text of ['proof.pdf','application/pdf','20 KB','2026','開啟原檔']) assert(metadata.includes(text));
    await firstScreen();
    evidence.push({ workspace:assist?'assist':'case', pixels });
    if(!assist) await page.screenshot({ path:`${output}/r2-pdf-first-page.png` });
    check(`${assist ? 'AssistFiles' : 'CaseDetail'}: one request, visible first-page content only, metadata and action visible`);
    const canvasBefore = await modal.locator('canvas').evaluate(node=>node.toDataURL());
    await modal.locator('canvas').hover(); await page.mouse.wheel(0,2000); await page.keyboard.press('PageDown');
    assert.equal(await modal.locator('canvas').evaluate(node=>node.toDataURL()),canvasBefore);
    await modal.getByRole('button',{name:'開啟原檔',exact:true}).click(); await modal.locator('iframe').waitFor();
    assert.deepEqual(await calls(), ['proof-original']);
    const pdf = await page.evaluate(async()=>({ count:window.__previewBlobs.length, text:await window.__previewBlobs[0].blob.text(), url:window.__previewBlobs[0].url }));
    assert.equal(pdf.count,1); assert(pdf.text.includes('/Count 2') && pdf.text.includes('PAGE 2 - FULL DOCUMENT ONLY'));
    assert.equal(await modal.locator('iframe').getAttribute('src'),pdf.url);
    await modal.getByRole('button',{name:'關閉',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.__previewRevoked),[pdf.url]);
    check(`${assist ? 'AssistFiles' : 'CaseDetail'}: scrolling never reveals page 2; Open original reuses full two-page bytes; URL released`);
  }
  await workspace();
  await page.locator('.nb-doc-open').filter({hasText:'vehicle.jpg'}).click();
  await page.waitForFunction(()=>document.querySelector('.nb-file-preview img')?.naturalWidth>0);
  assert.deepEqual(await calls(),['vehicle-thumb']);
  const image = await modal.locator('img').evaluate(node=>({ natural:node.naturalWidth, width:node.clientWidth, height:node.clientHeight, body:node.parentElement.clientWidth }));
  assert.equal(image.natural,480); assert.equal(image.width,image.body); assert(image.width>500 && image.width<=540);
  assert(Math.abs(image.width/image.height-1.6)<0.01); await firstScreen(); evidence.push({ image });
  await page.screenshot({path:`${output}/r2-image-thumbnail.png`});
  check('image fills 540px modal proportionally using only the thumbnail');
  await page.setViewportSize({width:720,height:520});
  await workspace(true,'&portrait=1');
  await page.locator('.nb-doc-open').filter({hasText:'vehicle.jpg'}).click();
  await page.waitForFunction(()=>document.querySelector('.nb-file-preview img')?.naturalWidth>0);
  assert.deepEqual(await calls(),['vehicle-thumb']); await firstScreen();
  assert(await modal.locator('.nb-file-preview-body').evaluate(node=>node.scrollHeight>node.clientHeight));
  await page.screenshot({path:`${output}/r2-action-first-screen.png`});
  await modal.getByRole('button',{name:'開啟原檔',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.nb-file-preview img')?.naturalWidth===1500);
  assert.deepEqual(await calls(),['vehicle-thumb','vehicle-original']); await firstScreen();
  check('assisted draft at 720x520: tall image scrolls inside; header and Open original remain visible');
  await workspace(); await openPdf(); await firstScreen(); assert.deepEqual(await calls(),['proof-original']);
  check('short viewport PDF: content, metadata and Open original all visible');
  await page.setViewportSize({width:1440,height:1000});
  await workspace();
  await page.evaluate(()=>{
    const fetch=window.fetch;
    window.fetch=async(url,init)=>{
      if(String(url).includes('/files/proof-original/'))await new Promise(resolve=>window.__releasePdf=resolve);
      return fetch(url,init);
    };
  });
  await page.locator('.nb-doc-open').filter({hasText:'proof.pdf'}).click();
  await modal.getByRole('button',{name:'關閉',exact:true}).click();
  await page.evaluate(async()=>{window.__releasePdf();await new Promise(resolve=>setTimeout(resolve,100));});
  assert.deepEqual(await page.evaluate(()=>window.__previewBlobs),[]); assert.equal(await modal.count(),0);
  check('closing a pending PDF request does not leak an object URL or mount a renderer');
  await workspace();
  await page.evaluate(()=>{
    const fetch=window.fetch;
    window.fetch=(url,init)=>String(url).includes('/files/proof-original/') ? Promise.resolve(new Response(new Blob(['broken'],{type:'application/pdf'}))) : fetch(url,init);
  });
  await page.locator('.nb-doc-open').filter({hasText:'proof.pdf'}).click();
  await modal.getByRole('alert').waitFor(); assert((await modal.getByRole('alert').innerText()).includes('無法讀取附件'));
  assert(await modal.getByRole('button',{name:'開啟原檔',exact:true}).isEnabled());
  check('invalid PDF reports failure and keeps the original action available');
  for(const [lang,action] of [['en','Open original'],['fr','Ouvrir l’original']]) {
    await workspace(false,`&lang=${lang}`); await openPdf();
    assert(!/[\u3400-\u9fff]/.test(await modal.innerText()));
    assert(await modal.getByRole('button',{name:action,exact:true}).isVisible());
    assert.deepEqual(await calls(),['proof-original']);
    check(`${lang}: PDF content and translated actions work without extra requests`);
  }
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
  await writeFile(`${output}/r2-preview-assertions.json`,JSON.stringify({checks,evidence,errors,external},null,2));
  console.log(`NORTHBOUND_PREVIEW_R2_UI_CHECK=${checks}/${checks}`);
} finally { await browser.close(); }
