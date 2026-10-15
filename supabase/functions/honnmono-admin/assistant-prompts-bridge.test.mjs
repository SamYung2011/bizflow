import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { mapHonnmonoAdminPath, isMainAccessRoute, isAllowedHonnmonoUpstream } from './routing.mjs';

test('assistant prompts: admin GET/PATCH, employee denied, body and audit headers preserved', async () => {
  const env = { SUPABASE_URL: 'https://fixture.supabase.test', SUPABASE_ANON_KEY: 'fixture-public',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', HONNMONO_ADMIN_API_URL: 'https://app-api.honnmono.top',
    HONNMONO_ADMIN_INTERNAL_TOKEN: 'local-internal-token-32-characters-long' };
  let handler, employee = { is_admin: true, bizflow_main_access: true, active: true, kind: 'employee' };
  const original = globalThis.fetch, originalTimeout = AbortSignal.timeout;
  const timeoutBudgets = [];
  AbortSignal.timeout = milliseconds => { timeoutBudgets.push(milliseconds); return originalTimeout(milliseconds); };
  globalThis.Deno = { env: { get: key => env[key] }, serve: fn => { handler = fn; } };
  try {
    const bundle = await build({ entryPoints: ['supabase/functions/honnmono-admin/index.ts'], bundle: true,
      platform: 'neutral', format: 'esm', write: false });
    await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    const calls = [];
    globalThis.fetch = async (url, options) => {
      const path = new URL(String(url)).pathname;
      if (path === '/auth/v1/user') return Response.json({ id: 'fixture-id', email: 'admin@example.test' });
      if (path === '/rest/v1/employees') return Response.json([employee]);
      if (path.startsWith('/internal/admin/assistant/')) {
        calls.push({ path, options });
        assert.equal(options.headers['X-Operator-Email'], 'admin@example.test');
        assert.equal(options.headers['X-Internal-Token'], env.HONNMONO_ADMIN_INTERNAL_TOKEN);
        return Response.json({ code: 0, result: { content: 'local' } });
      }
      throw Error(`Unexpected fixture path ${path}`);
    };
    const request = (path, method = 'GET', body, bearer = true) => new Request(`https://edge.example.test/honnmono-admin${path}`, {
      method, headers: bearer ? { authorization: 'Bearer fixture-token' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal((await handler(request('/assistant/prompts'))).status, 200);
    assert.equal((await handler(request('/assistant/prompts/system', 'PATCH', { content: 'prompt' }))).status, 200);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(calls[1].options.body)), { content: 'prompt' });
    assert.equal((await handler(request('/assistant/prompts/system', 'PATCH', { reset: true }))).status, 200);
    for (const method of ['POST', 'DELETE', 'PUT']) assert.equal((await handler(request('/assistant/prompts/system', method))).status, 404);
    assert.equal((await handler(request('/assistant/prompts/..%2Fsystem', 'PATCH', { reset: true }))).status, 404);
    assert.equal((await handler(request('/assistant/prompts', 'GET', undefined, false))).status, 401);
    employee = { ...employee, is_admin: false };
    assert.equal((await handler(request('/assistant/prompts'))).status, 403);
    assert.equal((await handler(request('/assistant/prompts/system', 'PATCH', { reset: true }))).status, 403);
    assert.equal(calls.length, 3);
    assert.equal(isMainAccessRoute('/assistant/prompts', 'GET'), false);
    assert.equal(isMainAccessRoute('/assistant/prompts/system', 'PATCH'), false);
    assert.equal(mapHonnmonoAdminPath('/assistant/prompts', 'GET'), '/internal/admin/assistant/prompts');
    assert(isAllowedHonnmonoUpstream(new URL('https://app-api.honnmono.top/internal/admin/assistant/prompts')));
    employee = { ...employee, is_admin: true };
    assert.equal((await handler(request('/assistant/provider'))).status, 200);
    assert.equal(timeoutBudgets.at(-1), 10000);
    assert.equal((await handler(request('/assistant/provider', 'PATCH', { model: 'fixture-model', apiKey: 'fixture-key' }))).status, 200);
    assert.equal(timeoutBudgets.at(-1), 60000);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(calls[4].options.body)), { model: 'fixture-model', apiKey: 'fixture-key' });
    assert.equal(calls[3].path, '/internal/admin/assistant/provider');
    for (const method of ['POST', 'DELETE', 'PUT']) assert.equal((await handler(request('/assistant/provider', method))).status, 404);
    assert.equal((await handler(request('/assistant/provider/extra'))).status, 404);
    employee = { ...employee, is_admin: false };
    for (const method of ['GET','PATCH']) assert.equal((await handler(request('/assistant/provider', method))).status, 403);
    assert.equal(calls.length, 5);
    assert.equal(isMainAccessRoute('/assistant/provider','GET'), false);
    assert.equal(isMainAccessRoute('/assistant/provider','PATCH'), false);
    assert.equal(mapHonnmonoAdminPath('/assistant/provider','PATCH'), '/internal/admin/assistant/provider');
  } finally { globalThis.fetch = original; AbortSignal.timeout = originalTimeout; delete globalThis.Deno; }
});
