import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createPageScope } from '../root-site/spa/page-lifecycle.js';
import { appFeedbackCopy } from '../root-site/bizflow/app-feedback-i18n.js';
import { SECTION_MENU_ITEMS } from '../root-site/components/navigation-registry.js';
import { routeManifest } from '../root-site/spa/route-manifest.js';

// Real mount/render/controllers/API; only identity, unread and network are fake.
const fixture = { user: null, session: null };
globalThis.__unbindAccessFixture = fixture;
const stubs = new Map([
  ['../data/auth.js', `export const getSession=async()=>globalThis.__unbindAccessFixture.session;
    export const getSupabaseClient=async()=>({supabaseUrl:'https://fixture.invalid',supabaseKey:'fixture-anon'});`],
  ['../data/provider.js', `export const getCurrentUser=async()=>globalThis.__unbindAccessFixture.user;`],
  ['../data/page-unread.js', `export const cachedPageUnread=()=>({unread:{}});export const loadPageUnread=async()=>({});`],
]);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../root-site/bizflow/app-feedback.js', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'unbind-access-fixture', setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs.has(a.path) ? { path: a.path, namespace: 'fixture' } : null);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs.get(a.path), loader: 'js' }));
  } }],
});
const pageModule = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const user = isAdmin => ({ isBfAdmin: isAdmin, bizflowMainAccess: !isAdmin, hasPermission: () => false });
const session = { user: { id: 'fixture-user' }, access_token: 'fixture-jwt' };
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const tick = () => new Promise(resolve => setImmediate(resolve));
const originalFetch = globalThis.fetch, originalDocument = globalThis.document, originalWindow = globalThis.window;
let checks = 0;
async function check(name, run) { await run(); console.log(`unbind-access ${++checks}: ${name}`); }
async function mount(isAdmin, saved = {}, lang = 'zh') {
  fixture.user = user(isAdmin); fixture.session = session;
  globalThis.document = new EventTarget();
  document.visibilityState = 'visible';
  globalThis.window = { scrollTo() {}, scrollX: 0, scrollY: 0 };
  const element = { outerHTML: '' }, calls = [], timers = [];
  document.querySelector = selector => selector === '[data-app-feedback-page]' ? element : null;
  let responder = () => Response.json({ items: [], total: 0 });
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://fixture.invalid');
    calls.push({ path: url.pathname.replace('/functions/v1/honnmono-admin', '') + url.search, options });
    return responder(url, options);
  };
  const base = createPageScope();
  const scope = { ...base, timeout(fn, ms) { timers.push({ fn, ms }); return 0; }, animationFrame(fn) { fn(); } };
  const controller = await pageModule.mountPage({ scope, signal: scope.signal, historyState: saved,
    url: new URL('https://fixture.invalid/bizflow/app-feedback.html'), navigation: { hardNavigate() { assert.fail('authorized user redirected'); } } });
  element.outerHTML = controller.page.render({ lang, escapeHtml });
  controller.activate(); await tick();
  function event(type, selector, value = '') {
    const target = { value, disabled: false, matches: s => s === selector,
      closest: s => s === selector ? target : null, getAttribute: () => value };
    const ev = new Event(type, { cancelable: true });
    Object.defineProperty(ev, 'target', { value: target });
    document.dispatchEvent(ev);
  }
  return { calls, timers, controller, html: () => element.outerHTML,
    respond(fn) { responder = fn; }, event,
    async tab(tab) { event('click', '[data-app-feedback-tab]', tab); await tick(); },
    async lookup() { event('input', '[data-device-imei]', '000000000000001'); event('submit', '[data-device-search]'); await tick(); },
    dispose() { controller.dispose(); base.dispose(); } };
}
try {
  await check('signed-in main-site predicate requires strict whitelist or admin and a real auth context', async () => {
    for (const [current, activeSession, allowed] of [
      [user(false), session, true], [user(true), session, true],
      [{ ...user(false), bizflowMainAccess: false }, session, false],
      [{ ...user(false), bizflowMainAccess: 'true' }, session, false],
      [{ ...user(false), hasPermission: null }, session, false],
      [user(false), null, false], [null, session, false],
    ]) assert.equal(pageModule.canUseDeviceUnbind(current, activeSession), allowed);
    fixture.user = { ...user(false), bizflowMainAccess: false }; fixture.session = session;
    const scope = createPageScope(); let redirect;
    await assert.rejects(pageModule.mountPage({ scope, signal: scope.signal, url: new URL('https://fixture.invalid/bizflow/app-feedback.html'),
      navigation: { hardNavigate(url) { redirect = url.pathname; } } }), { name: 'AbortError' });
    assert.equal(redirect, '/bizflow/home.html'); scope.dispose();
  });
  await check('entry and route open to main site while all four OCPP routes stay admin-only', async () => {
    assert.equal(SECTION_MENU_ITEMS.bizflow.find(x => x.id === 'app-feedback').adminOnly, undefined);
    assert.equal(routeManifest['/bizflow/app-feedback.html'].frame.access, 'default');
    for (const id of ['ocpp-monitor', 'ocpp-charging', 'ocpp-users', 'ocpp-finance']) {
      assert.equal(SECTION_MENU_ITEMS.bizflow.find(x => x.id === id).adminOnly, true);
      assert.equal(routeManifest[`/bizflow/${id}.html`].frame.access, 'bf-admin');
    }
  });
  await check('employee restores every saved tab into device only, ignores forbidden tab events, makes no loads or poll timers', async () => {
    for (const activeTab of [undefined, 'feedback', 'device', 'devices', 'sim']) {
      const f = await mount(false, { activeTab });
      try {
        assert.equal(f.controller.captureState().activeTab, 'device');
        assert.match(f.html(), /data-device-search/);
        assert.doesNotMatch(f.html(), /data-app-feedback-tab|data-ota-|data-sim-|data-adapter-/);
        for (const tab of ['feedback', 'devices', 'sim']) await f.tab(tab);
        assert.equal(f.controller.captureState().activeTab, 'device');
        document.dispatchEvent(new Event('visibilitychange')); await tick();
        assert.equal(f.calls.length, 0); assert.equal(f.timers.length, 0);
      } finally { f.dispose(); }
    }
  });
  await check('admin retains four tabs, initial feedback and polling, device OTA, list and SIM loads', async () => {
    const f = await mount(true);
    try {
      assert.deepEqual([...f.html().matchAll(/data-app-feedback-tab="([^"]+)"/g)].map(m => m[1]), ['feedback', 'device', 'devices', 'sim']);
      assert.ok(f.calls.some(x => x.path.startsWith('/feedback?')));
      assert.ok(f.timers.some(x => x.ms === 30_000));
      await f.tab('device'); assert.match(f.html(), /data-ota-/);
      assert.ok(f.calls.some(x => x.path === '/ota/package'));
      await f.tab('devices'); assert.ok(f.calls.some(x => x.path.startsWith('/devices/flash?')));
      await f.tab('sim'); assert.ok(f.calls.some(x => x.path.startsWith('/sim/cards?')));
    } finally { f.dispose(); }
  });
  await check('never-bound lookup immediately shows localized notice and disabled title in all three languages', async () => {
    for (const lang of ['zh', 'en', 'fr']) {
      const f = await mount(false, {}, lang);
      try {
        f.respond(() => Response.json({ imei: '000000000000001', unbound: true, dev_cloud: { userid: 0 } }));
        await f.lookup();
        assert.ok(f.html().includes(appFeedbackCopy[lang].deviceUnbound));
        assert.ok(f.html().includes(appFeedbackCopy[lang].deviceUnboundNotice));
        assert.ok(f.html().includes(`title="${escapeHtml(appFeedbackCopy[lang].unbindDisabledUnbound)}" disabled`));
        assert.ok(f.html().indexOf(appFeedbackCopy[lang].deviceUnboundNotice) < f.html().indexOf('data-device-unbind'));
        f.event('click', '[data-device-unbind]'); await tick();
        assert.doesNotMatch(f.html(), /data-device-confirm-submit/);
        f.event('click', '[data-device-confirm-submit]'); await tick();
        assert.equal(f.calls.filter(x => x.options.method === 'POST').length, 0);
      } finally { f.dispose(); }
    }
  });
  await check('plain backend 404 displays the never-bound or mistyped explanation in all languages', async () => {
    for (const lang of ['zh', 'en', 'fr']) {
      const f = await mount(false, {}, lang);
      try {
        f.respond(() => Response.json({ detail: 'Device not found' }, { status: 404 }));
        await f.lookup(); assert.ok(f.html().includes(appFeedbackCopy[lang].deviceNotFoundError));
      } finally { f.dispose(); }
    }
  });
  await check('employee bound device still follows lookup, confirmation, then audited unbind request', async () => {
    const f = await mount(false);
    try {
      f.respond((_url, options) => Response.json(options.method === 'POST'
        ? { status: 'unbound', binding: { unbound: true, dev_cloud: { userid: 0 } }, steps: [] }
        : { imei: '000000000000001', unbound: false, dev_cloud: { userid: 42 }, binding_user: { username: 'Fixture owner' } }));
      await f.lookup(); assert.match(f.html(), /Fixture owner/);
      assert.equal(f.calls.length, 1);
      f.event('click', '[data-device-unbind]'); await tick();
      assert.match(f.html(), /data-device-confirm-submit/); assert.equal(f.calls.length, 1);
      f.event('click', '[data-device-confirm-submit]'); await tick();
      assert.equal(f.calls[1].path, '/device/unbind');
      assert.deepEqual(JSON.parse(f.calls[1].options.body), { imei: '000000000000001', expected_userid: 42 });
      assert.match(f.html(), /title="設備未綁定，無需解綁" disabled/);
    } finally { f.dispose(); }
  });
  await check('admin device-list unbound tooltips apply to both kinds and preserve charging tooltip priority', async () => {
    const f = await mount(true, { activeTab: 'device' });
    try {
      f.respond(url => Response.json(url.pathname.includes('/devices/') ? { total: 2, items: [
        { certid: 'A', imei: '000000000000001', binding: { userId: 0 } },
        { certid: 'B', imei: '000000000000002', binding: { userId: 42 }, charging: true },
      ] } : {}));
      await f.tab('devices');
      assert.match(f.html(), /data-adapter-id="A" title="設備未綁定，無需解綁" disabled/);
      assert.match(f.html(), /data-adapter-id="B" title="設備正在充電，請先停止充電再解綁" disabled/);
      f.event('click', '[data-adapter-kind]', 'dc-pro'); await tick();
      assert.match(f.html(), /data-adapter-id="A" title="設備未綁定，無需解綁" disabled/);
    } finally { f.dispose(); }
  });
} finally {
  globalThis.fetch = originalFetch; globalThis.document = originalDocument; globalThis.window = originalWindow;
  delete globalThis.__unbindAccessFixture;
}
console.log(`APP_FEEDBACK_UNBIND_ACCESS=${checks}/${checks}`);
