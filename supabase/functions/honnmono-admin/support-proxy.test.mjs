import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forwardSupport, SUPPORT_UPLOAD_BYTES, northboundUpstreamPath, supportUpstreamPath, isStaffUpstream } from './support-proxy.mjs';
const options = { token: 'fixture-internal', operatorEmail: 'mia@example.test', cors: { 'Access-Control-Allow-Origin': '*' } };
const invoke = (path, init = {}) => forwardSupport(new Request('https://edge.example.test/support', init), new URL(`https://app-api.honnmono.top${path}`), options);
test('support bytes, signature rewrite, limits and methods', async t => {
  const original = globalThis.fetch;
  try {
    await t.test('B7 returns exact bytes including a JSON attachment', async () => {
      const bytes = new Uint8Array([0, 255, 10, 34]);
      globalThis.fetch = async () => new Response(bytes, { headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="a.json"' } });
      const result = await invoke('/internal/admin/support/files/a/a.json');
      assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
      assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(result.headers.get('access-control-allow-origin'), '*');
    });
    await t.test('S8 northbound file returns exact bytes with private headers', async () => {
      const bytes = new Uint8Array([0, 255, 10, 34]);
      globalThis.fetch = async () => new Response(bytes, { headers: { 'content-type': 'image/png' } });
      const result = await invoke('/internal/admin/northbound/files/abc/image.png');
      assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
      assert.equal(result.headers.get('cache-control'), 'private, no-store');
      assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    });
    await t.test('S11 insurance file returns exact bytes with private headers', async () => {
      const bytes = new Uint8Array([0, 255, 10, 34]);
      globalThis.fetch = async () => new Response(bytes, { headers: { 'content-type': 'application/pdf' } });
      const result = await invoke('/internal/admin/insurance/files/abc/policy.pdf');
      assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
      assert.equal(result.headers.get('cache-control'), 'private, no-store');
      assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    });
    await t.test('upload sends untouched bytes with internal identity and rewrites only signed upload URL', async () => {
      const bytes = new Uint8Array([0, 128, 255]);
      globalThis.fetch = async (_url, init) => {
        assert.deepEqual(init.body, bytes);
        assert.equal(init.headers['X-Operator-Email'], options.operatorEmail);
        assert.equal(init.headers['X-Internal-Token'], options.token);
        assert.equal(init.headers['Content-Type'], 'image/png');
        return Response.json({ code: 0, result: {} });
      };
      assert.equal((await invoke('/internal/cloud-storage/upload/abc', { method: 'POST', body: bytes, headers: { 'content-type': 'image/png' } })).status, 200);
      globalThis.fetch = async () => Response.json({ code: 0, result: { filelist: [{ cfid: 'abc', cfinfo: { url: 'https://internal.invalid/upload/abc' } }] } });
      const result = await (await invoke('/internal/admin/support/upload', { method: 'POST', body: '{}' })).json();
      assert.equal(result.result.filelist[0].cfinfo.url, '/functions/v1/honnmono-admin/support/upload/abc');
    });
    await t.test('S11a assist signature rewrites uploads to the authenticated support byte bridge', async () => {
      globalThis.fetch = async (url, init) => {
        assert.equal(url.pathname, '/internal/admin/northbound/assist/cases/71/upload');
        assert.equal(init.headers['X-Operator-Email'], options.operatorEmail);
        return Response.json({ code: 0, result: { filelist: [{ cfid: 'doc_71', filename: 'car.jpg',
          cfinfo: { url: 'https://private.invalid/internal/cloud-storage/upload/doc_71', method: 'POST' } }] } });
      };
      const response = await invoke('/internal/admin/northbound/assist/cases/71/upload', { method: 'POST', body: '{}' });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).result.filelist, [{ cfid: 'doc_71', filename: 'car.jpg',
        cfinfo: { url: '/functions/v1/honnmono-admin/support/upload/doc_71', method: 'POST' } }]);
    });
    await t.test('DELETE stays DELETE and upstream auth failure is sanitized', async () => {
      globalThis.fetch = async (_url, init) => { assert.equal(init.method, 'DELETE'); return Response.json({ private: true }, { status: 403 }); };
      const result = await invoke('/internal/admin/support/example', { method: 'DELETE' });
      assert.equal(result.status, 502); assert.deepEqual(await result.json(), { error: 'Honnmono support service unavailable' });
    });
    await t.test('oversized upload and invalid JSON never call upstream', async () => {
      globalThis.fetch = () => assert.fail('must not forward');
      assert.equal((await invoke('/internal/cloud-storage/upload/abc', { method: 'POST', body: new Uint8Array(SUPPORT_UPLOAD_BYTES + 1) })).status, 413);
      assert.equal((await invoke('/internal/admin/support/upload', { method: 'POST', body: 'broken' })).status, 400);
    });
  } finally { globalThis.fetch = original; }
});


test('support profile and northbound assist retain the existing path and method boundary', () => {
  assert.equal(supportUpstreamPath('/support/users/19/profile', 'GET'), '/internal/admin/support/users/19/profile');
  for (const suffix of ['users/19/cases', 'cases/71', 'cases/71/update', 'cases/71/upload',
    'cases/71/documents', 'cases/71/documents/8/remove', 'cases/71/submit', 'cases/71/doc-requests/NB-DOC-001/submit']) {
    for (const method of ['GET', 'POST']) {
      const path = northboundUpstreamPath(`/northbound/assist/${suffix}`, method);
      assert.equal(path, `/internal/admin/northbound/assist/${suffix}`);
      assert(isStaffUpstream(path));
    }
    assert.equal(northboundUpstreamPath(`/northbound/assist/${suffix}`, 'DELETE'), '');
  }
  assert.equal(northboundUpstreamPath('/northbound/assist/%2e%2e/secrets', 'POST'), '');
});
