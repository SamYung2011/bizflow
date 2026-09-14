import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

// Execute the real Edge handler. Every fetch is replaced; no live credentials,
// employee records or device writes are used by this permission matrix.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../supabase/functions/honnmono-admin/index.ts', import.meta.url))],
  bundle: true, format: 'iife', platform: 'neutral', write: false,
});
const employee = { is_admin: false, bizflow_main_access: true, active: true, kind: 'employee' };
let rows = [employee], authStatus = 200, employeeStatus = 200, upstreamStatus = 200;
let handler;
const calls = [], upstream = [];
const env = {
  SUPABASE_URL: 'https://auth.fixture.invalid', SUPABASE_ANON_KEY: 'fixture-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  HONNMONO_ADMIN_API_URL: 'https://app-api.honnmono.top',
  HONNMONO_ADMIN_INTERNAL_TOKEN: 'fixture-internal-token'.repeat(3),
  OTA_ADMIN_URL: 'http://172.18.0.1:8086', OTA_ADMIN_TOKEN: 'fixture-ota'.repeat(4),
  FLASH_ADMIN_URL: 'http://172.18.0.1:8090', FLASH_ADMIN_TOKEN: 'fixture-flash'.repeat(4),
};
runInNewContext(bundle.outputFiles[0].text, {
  Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
  URL, Request, Response, AbortSignal, TextEncoder,
  fetch: async (input, options) => {
    const url = new URL(input);
    calls.push(url.pathname);
    if (url.origin === env.SUPABASE_URL) {
      if (url.pathname === '/auth/v1/user') {
        assert.equal(options.headers.Authorization, 'Bearer fixture-jwt');
        return Response.json({ id: 'fixture-user', email: 'claude_test@honnmono.local' }, { status: authStatus });
      }
      assert.equal(url.pathname, '/rest/v1/employees');
      assert.equal(url.searchParams.get('select'), 'is_admin,bizflow_main_access,active,kind');
      assert.equal(url.searchParams.get('user_id'), 'eq.fixture-user');
      return Response.json(rows, { status: employeeStatus });
    }
    upstream.push({ url, options });
    return Response.json(upstreamStatus === 404 ? { detail: 'Device not found' } : { ok: true }, { status: upstreamStatus });
  },
});
let checks = 0;
async function check(name, run) { await run(); console.log(`edge-access ${++checks}: ${name}`); }
async function request(path, method = 'GET', token = 'fixture-jwt') {
  calls.length = 0; upstream.length = 0;
  return handler(new Request(`https://edge.fixture.invalid/honnmono-admin${path}`, {
    method, headers: token ? { Authorization: `Bearer ${token}` } : {},
    ...(method === 'POST' ? { body: JSON.stringify({ imei: '000000000000001', expected_userid: 42 }) } : {}),
  }));
}
const adminRoutes = [
  ['/feedback', 'GET'], ['/feedback/1', 'GET'], ['/feedback/1/log-link', 'POST'],
  ['/devices/dc-pro', 'GET'], ['/devices/dc-pro/A/sessions', 'GET'], ['/devices/dc-pro/A/sessions/days', 'GET'],
  ['/devices/flash', 'GET'], ['/devices/flash/A/ota', 'GET'], ['/devices/flash/A/sessions', 'GET'],
  ['/devices/flash/A/sessions/days', 'GET'], ['/devices/flash/A/uploads/1', 'GET'],
  ['/devices/flash/A/unbind', 'POST'], ['/devices/flash/A/actions', 'POST'],
  ['/ota/package', 'GET'], ['/ota/package', 'POST'], ['/ota/legacy-packages', 'GET'],
  ['/ota/legacy-packages/150001', 'POST'], ['/sim/lookup', 'GET'], ['/sim/cards', 'GET'],
  ['/sim/cards', 'POST'], ['/sim/cards/import', 'POST'], ['/sim/refresh', 'POST'],
];
await check('whitelisted employee binding GET and unbind POST preserve operator audit and body', async () => {
  for (const [path, method] of [['/device/binding?imei=000000000000001', 'GET'], ['/device/unbind', 'POST']]) {
    assert.equal((await request(path, method)).status, 200);
    assert.equal(upstream.length, 1);
    const call = upstream[0];
    assert.equal(call.options.headers['X-Operator-Email'], 'claude_test@honnmono.local');
    assert.equal(call.options.headers['X-Internal-Token'], env.HONNMONO_ADMIN_INTERNAL_TOKEN);
    assert.equal(call.options.method, method);
    if (method === 'POST') assert.deepEqual(JSON.parse(call.options.body), { imei: '000000000000001', expected_userid: 42 });
    else assert.equal(call.url.searchParams.get('imei'), '000000000000001');
  }
});
await check('employee cannot reach any of 22 admin route/method pairs', async () => {
  for (const [path, method] of adminRoutes) {
    assert.equal((await request(path, method)).status, 403, `${method} ${path}`);
    assert.equal(upstream.length, 0);
  }
});
await check('wrong verbs, extra segments and trailing slashes cannot widen employee access', async () => {
  for (const [path, method] of [['/device/binding', 'POST'], ['/device/unbind', 'GET'], ['/device/unbind/extra', 'POST'], ['/device/unbind/', 'POST']]) {
    assert.equal((await request(path, method)).status, 403);
    assert.equal(upstream.length, 0);
  }
});
await check('missing employee, team, inactive, absent/false/string main access fail closed', async () => {
  for (const invalidRows of [[], [{}], [{ ...employee, kind: 'task' }], [{ ...employee, active: false }],
    [{ ...employee, active: 'true' }], [{ ...employee, kind: null }],
    [{ ...employee, bizflow_main_access: false }], [{ ...employee, bizflow_main_access: null }],
    [{ ...employee, bizflow_main_access: 'true' }], [{ is_admin: 'true' }]]) {
    rows = invalidRows;
    for (const [path, method] of [['/device/binding', 'GET'], ['/device/unbind', 'POST']]) {
      assert.equal((await request(path, method)).status, 403, JSON.stringify(rows));
      assert.equal(upstream.length, 0);
    }
  }
});
await check('existing admin access preserves every admin route even without main-access fields', async () => {
  rows = [{ is_admin: true }];
  for (const [path, method] of adminRoutes) {
    assert.equal((await request(path, method)).status, 200, `${method} ${path}`);
    assert.ok(upstream.length >= 1);
  }
});
await check('missing/invalid JWT and employee lookup failure never forward', async () => {
  assert.equal((await request('/device/binding', 'GET', '')).status, 401);
  assert.equal(calls.length, 0);
  authStatus = 401;
  assert.equal((await request('/device/binding')).status, 401);
  assert.equal(upstream.length, 0);
  authStatus = 200; employeeStatus = 500;
  assert.equal((await request('/device/binding')).status, 500);
  assert.equal(upstream.length, 0);
  employeeStatus = 200;
});
await check('plain-string backend 404 remains available to the localized frontend error handler', async () => {
  rows = [employee]; upstreamStatus = 404;
  const result = await request('/device/binding');
  assert.equal(result.status, 404);
  assert.deepEqual(await result.json(), { detail: 'Device not found' });
});
console.log(`HONNMONO_ADMIN_ACCESS=${checks}/${checks}`);
