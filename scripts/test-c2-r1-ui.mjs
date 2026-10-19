import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const origin=process.env.PREVIEW_ORIGIN||'http://127.0.0.1:5199', output=process.env.EVIDENCE_DIR||'/tmp/support-profile-c2-r1-1019';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
const errors=[],external=[];let checks=0;
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin===origin || ['blob:','data:'].includes(url.protocol))return route.continue();
  external.push(url.href);return route.abort();
});
await page.addInitScript(()=>localStorage.setItem('bizflow-lang',new URLSearchParams(location.search).get('lang')||'zh'));
const noFiles=async()=>assert.deepEqual(await page.evaluate(()=>window.__assistCalls.filter(c=>c.path.startsWith('/northbound/files/'))),[]);
const check=name=>console.log(`C2_R1_UI ${++checks}: ${name}`);
try {
  for (const [lang,states,versions] of [
    ['zh',['已接受','已退回','已移除','待核對'],['第 2 版','第 3 版','第 1 版','第 4 版']],
    ['en',['Accepted','Returned','Removed','Awaiting review'],['Version 2','Version 3','Version 1','Version 4']],
    ['fr',['Accepté','Retourné','Supprimé','À vérifier'],['Version 2','Version 3','Version 1','Version 4']]]) {
    await page.goto(`${origin}/scripts/tg5-c-preview.html?view=assist&files=1&statuses=1&lang=${lang}`);
    await page.locator('.nb-case').first().click();await page.locator('.nb-doc-open').first().waitFor();
    for(const [index,name] of ['vehicle.jpg','proof.pdf','legacy.jpg','new-version.jpg'].entries()) {
      const row=page.locator('.nb-doc-open').filter({has:page.locator('strong',{hasText:new RegExp(`^${name.replace('.','\\.')}$`)})});
      assert.equal((await row.locator('.nb-document-state').textContent()).trim(),`${versions[index]} · ${states[index]}`);
      assert.equal(await row.isDisabled(),index===2);
      assert((await row.innerText()).includes('2026'));
    }
    assert.equal(await page.locator('.nb-document-note').filter({hasText:'Superseded document'}).count(),1);
    assert.equal(await page.locator('.nb-document-note').filter({hasText:'Unclear scan'}).count(),1);
    await noFiles();
    if(lang==='zh') {
      await page.locator('.nb-doc-groups').scrollIntoViewIfNeeded();
      await page.screenshot({path:`${output}/m1-file-version-status.png`});
      const row=page.locator('.nb-doc').filter({has:page.getByRole('button',{name:'查看文件：new-version.jpg',exact:true})});
      await row.getByRole('button',{name:'接受',exact:true}).click();
      await row.locator('.nb-document-state').filter({hasText:'已接受'}).waitFor();
      await row.getByRole('textbox').fill('Replacement required');
      await row.getByRole('button',{name:'退回',exact:true}).click();
      await row.locator('.nb-document-state').filter({hasText:'已退回'}).waitFor();
      await row.locator('.nb-document-note').filter({hasText:'Replacement required'}).waitFor();
      await noFiles();
      check('review actions update version/status and staff note without requesting file bytes');
    }
    check(`${lang}: four versions and review states, removal reason and disabled removed file; zero file requests`);
  }
  const path='src/views/honnmono/northbound/northbound.css';
  const main=execFileSync('git',['show',`e657d46:${path}`],{encoding:'utf8'}),old=execFileSync('git',['show',`58227c5:${path}`],{encoding:'utf8'}),current=await readFile(path,'utf8');
  const rules=css=>['.nb-preview {','.nb-preview img {'].map(marker=>css.slice(css.indexOf(marker),css.indexOf('}',css.indexOf(marker))+1)).join('\n');
  assert.equal(rules(current),rules(main));
  await page.goto(`${origin}/scripts/p8-insurance-preview.html?scenario=claim-preview&lang=zh`);
  await page.waitForFunction(()=>window.__P8_PREVIEW_READY);
  await page.locator('.nb-doc-open').filter({hasText:'policy-scan.jpg'}).click();
  await page.waitForFunction(()=>document.querySelector('.nb-preview img')?.naturalWidth===2400);
  const image=page.locator('.nb-preview img');
  const dimensions=()=>image.evaluate(node=>{const box=node.getBoundingClientRect();return{width:box.width,height:box.height};});
  const restored=await dimensions();
  assert.equal(await page.locator('.nb-file-preview').count(),0);
  assert(Math.abs(restored.width-876)<1 && Math.abs(restored.height-547.5)<1);
  await page.screenshot({path:`${output}/m2-insurance-preview-restored.png`});
  const replay=await page.addStyleTag({content:rules(old)});
  const previous=await dimensions();
  assert(Math.abs(previous.width-516)<1 && Math.abs(previous.height-322.5)<1);
  await page.screenshot({path:`${output}/m2-insurance-preview-before-css-replay.png`});
  await replay.evaluate(node=>node.remove());assert.deepEqual(await dimensions(),restored);
  await writeFile(`${output}/insurance-preview-dimensions.json`,JSON.stringify({previousCssCommit:'58227c5',baselineCssCommit:'e657d46',previous,restored},null,2));
  check('insurance uses unchanged main preview rules: 2400x1500 scan restores 876x547.5, previous CSS replay is 516x322.5');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(`C2_R1_UI_CHECK=${checks}/${checks}`);
} finally {await browser.close();}
