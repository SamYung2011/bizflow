import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({ entryPoints: ['src/lib/honnmonoAdmin.js'], bundle: true,
  platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://fixture.invalid', VITE_SUPABASE_ANON_KEY: 'local' }) } });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const original = globalThis.fetch;
try {
  globalThis.fetch = async () => Response.json({ code: 422, des: 'Missing required fields',
    result: { missing: ['phone_hk', 'vehicle_license'] } }, { status: 422 });
  await assert.rejects(api.callHonnmonoAdmin('/northbound/assist/cases/71/submit', { accessToken: 'local', method: 'POST', body: {} }), error => {
    assert.equal(error.message, 'HTTP 422: Missing required fields');
    assert.equal(error.status, 422);
    assert.deepEqual(error.result.missing, ['phone_hk', 'vehicle_license']);
    return true;
  });
  globalThis.fetch = async () => Response.json({ detail: [{ loc: ['body', 'vehicle', 'carId'], msg: 'Invalid value' }] }, { status: 422 });
  await assert.rejects(api.callHonnmonoAdmin('/northbound/assist/cases/71/update', { accessToken: 'local' }), /vehicle.carId：Invalid value/);
  console.log('NORTHBOUND_ASSIST_ERROR_CHECK=2/2');
} finally { globalThis.fetch = original; }
