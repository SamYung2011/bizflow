import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

test('insurance bridge: employee 200, no main access 403, anonymous 401, traversal 404', async () => {
  const env = {
    SUPABASE_URL: 'https://fixture.supabase.test', SUPABASE_ANON_KEY: 'public-fixture',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-fixture',
    HONNMONO_ADMIN_API_URL: 'https://app-api.honnmono.top',
    HONNMONO_ADMIN_INTERNAL_TOKEN: 'local-internal-token-32-characters-long',
  };
  let handler;
  globalThis.Deno = { env: { get: key => env[key] }, serve: fn => { handler = fn; } };
  const output = await build({ entryPoints: ['supabase/functions/honnmono-admin/index.ts'],
    bundle: true, platform: 'neutral', format: 'esm', write: false });
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
  assert.equal(typeof handler, 'function');
  const original = globalThis.fetch;
  let employee = { is_admin: false, bizflow_main_access: true, active: true, kind: 'employee' };
  let upstream = 0;
  globalThis.fetch = async (url, options) => {
    const path = new URL(String(url)).pathname;
    if (path === '/auth/v1/user') return Response.json({ id: 'fixture-user', email: 'mia@example.test' });
    if (path === '/rest/v1/employees') return Response.json([employee]);
    if (path === '/internal/admin/insurance/items') {
      upstream += 1;
      assert.equal(options.headers['X-Operator-Email'], 'mia@example.test');
      assert.equal(options.headers['X-Internal-Token'], env.HONNMONO_ADMIN_INTERNAL_TOKEN);
      return Response.json({ code: 0, result: { items: [] } });
    }
    throw Error(`unexpected URL ${url}`);
  };
  try {
    const request = (path, bearer = true) => new Request(`https://edge.example.test/honnmono-admin${path}`,
      { headers: bearer ? { authorization: 'Bearer fixture-token' } : {} });
    assert.equal((await handler(request('/insurance/items'))).status, 200);
    assert.equal(upstream, 1);
    employee = { ...employee, bizflow_main_access: false };
    assert.equal((await handler(request('/insurance/items'))).status, 403);
    employee = { ...employee, bizflow_main_access: true, active: false };
    assert.equal((await handler(request('/insurance/items'))).status, 403);
    employee = { ...employee, active: true, kind: 'team' };
    assert.equal((await handler(request('/insurance/items'))).status, 403);
    employee = { ...employee, kind: 'employee' };
    assert.equal((await handler(request('/insurance/items', false))).status, 401);
    assert.equal((await handler(request('/insurance/..%2Fsupport/items'))).status, 404);
    assert.equal(upstream, 1);
  } finally {
    globalThis.fetch = original;
    delete globalThis.Deno;
  }
});
