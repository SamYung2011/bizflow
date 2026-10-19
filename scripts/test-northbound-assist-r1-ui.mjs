import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const origin = process.env.PREVIEW_ORIGIN || 'http://127.0.0.1:5199';
const output = process.env.EVIDENCE_DIR || '/tmp/support-profile-r1-1019';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
  external.push(url.origin); return route.abort();
});
await page.addInitScript(() => localStorage.setItem('bizflow-lang', new URLSearchParams(location.search).get('lang') || 'zh'));
async function load(lang = 'zh') {
  await page.goto(`${origin}/scripts/tg5-c-preview.html?view=assist&lang=${lang}`);
  await page.locator('.nb-assist-launch').click();
  // Model real backend responses: partially filled 0+2 draft, validated count, active-case conflict.
  await page.evaluate(() => {
    const fetch = window.fetch;
    window.fetch = async (url, init = {}) => {
      if (init.method === 'POST' && String(url).endsWith('/assist/users/801/cases')) {
        return Response.json({ code: 409, des: 'Northbound case in progress', result: { id: 71, caseNo: 'HM-NB-000071' } }, { status: 409 });
      }
      if (String(url).endsWith('/update')) {
        const body = JSON.parse(init.body);
        if (body.persons.length !== (body.driverMode === '0+2' ? 2 : 1)) return Response.json({ code: 422 }, { status: 422 });
      }
      const response = await fetch(url, init);
      if (init.method === 'POST' && /\/assist\/users\/\d+\/cases$/.test(String(url))) {
        const value = await response.json(); value.result.driverMode = '0+2'; value.result.persons = [];
        return Response.json(value);
      }
      return response;
    };
  });
}
async function select(name) {
  await page.locator('.assist-search input').fill(name);
  await page.locator('.assist-search button').click();
  await page.locator('.assist-users button').filter({ hasText: name }).click();
  await page.locator('.nb-card .nb-primary').waitFor();
}
try {
  await load(); await select('Alex Chan');
  await page.getByRole('button', { name: '建立草稿' }).click();
  const drivers = () => page.locator('.assist-grid label').filter({ hasText: /^指定司機 \d/ }).locator('input');
  await page.getByLabel('指定司機 2', { exact: true }).waitFor();
  assert.equal(await drivers().count(), 2);
  await page.getByLabel('指定司機 1', { exact: true }).fill('Alex Chan');
  await page.getByLabel('指定司機 2', { exact: true }).fill('Chris Chan');
  await page.getByLabel('司機模式', { exact: true }).selectOption('1+1');
  assert.equal(await drivers().count(), 1);
  assert.equal(await page.getByLabel('指定司機 1', { exact: true }).inputValue(), 'Alex Chan');
  await page.getByLabel('司機模式', { exact: true }).selectOption('0+2');
  assert.equal(await drivers().count(), 2);
  await page.getByLabel('指定司機 2', { exact: true }).fill('Chris Chan');
  await page.screenshot({ path: `${output}/fs1-two-drivers.png` });
  await page.getByRole('button', { name: '儲存並上傳文件' }).click();
  await page.getByRole('button', { name: '預覽申請', exact: true }).waitFor();
  const update = (await page.evaluate(() => window.__assistCalls)).find(call => call.path.endsWith('/update'));
  assert.equal(update.body.driverMode, '0+2');
  assert.deepEqual(update.body.persons.map(person => person.name), ['Alex Chan', 'Chris Chan']);
  console.log('ASSIST_R1_UI 1: initial 0+2 and mode changes render and submit the exact driver count');
  const pdf = name => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 local fixture') });
  const bad = { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') };
  await page.getByLabel('車輛牌簿', { exact: true }).setInputFiles([pdf('first.pdf'), bad, pdf('third.pdf')]);
  await page.locator('.assist-file').getByText('third.pdf', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.assist-upload-kind input').disabled);
  assert.deepEqual(await page.locator('.assist-file .nb-doc-open strong').allTextContents(), ['first.pdf', 'third.pdf']);
  assert.match(await page.locator('.assist-file-failure').innerText(), /上傳失敗：broken.png/);
  assert.equal(await page.locator('.assist-file-failure').count(), 1);
  const attaches = (await page.evaluate(() => window.__assistCalls)).filter(call => call.path.endsWith('/documents'));
  assert.equal(attaches.length, 2); assert.equal(new Set(attaches.map(call => call.body.cfid)).size, 2);
  await page.screenshot({ path: `${output}/fm1-upload-partial-failure.png` });
  console.log('ASSIST_R1_UI 2: successful attachments stay visible, failed filename is isolated, later files continue');
  for (const lang of ['zh', 'en', 'fr']) {
    await load(lang); await select('Sophie Wong');
    await page.locator('.nb-card .nb-primary').click();
    await page.getByRole('alert').getByText(/HM-NB-000071/).waitFor();
    const message = await page.getByRole('alert').innerText();
    assert(message.includes('HM-NB-000071'));
    if (lang === 'zh') assert(message.includes('此使用者已有在辦申請（案號 HM-NB-000071）'));
    else assert(!/[\u3400-\u9fff]/.test(message));
    assert.equal(await page.getByRole('alert').getByRole('button').count(), 1);
    if (lang === 'zh') await page.screenshot({ path: `${output}/fs2-existing-case-409.png` });
    await page.getByRole('alert').getByRole('button').click();
    await page.locator('.assist-context').getByText('HM-NB-000071', { exact: true }).waitFor();
    assert((await page.locator('.assist-context').innerText()).includes('Sophie Wong'));
    assert((await page.evaluate(() => window.__assistCalls)).some(call => call.path.endsWith('/assist/cases/71') && call.method === 'GET'));
    console.log(`ASSIST_R1_UI ${lang === 'zh' ? 3 : lang === 'en' ? 4 : 5}: ${lang} conflict identifies and opens the existing customer case`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('ASSIST_R1_UI_CHECK=5/5');
} finally { await browser.close(); }
