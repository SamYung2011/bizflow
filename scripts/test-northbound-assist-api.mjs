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

const assistBundle = await build({ entryPoints: ['src/lib/northboundAssistApi.js'], bundle: true,
  platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://fixture.invalid', VITE_SUPABASE_ANON_KEY: 'fixture' }) } });
const assist = await import(`data:text/javascript;base64,${Buffer.from(assistBundle.outputFiles[0].text).toString('base64')}`);
const calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init });
  return Response.json({ code: 0, result: String(url).endsWith('/cases/3/upload') ? {
    filelist: [{ cfid: 'file-3', cfinfo: { url: '/functions/v1/honnmono-admin/support/upload/file-3', method: 'POST' } }],
  } : { id: 3 } }); };
const auth = { accessToken: 'fixture-token' };
await assist.createCase(800, { kind: 'renewal', previousCaseId: 2 }, auth);
await assist.listCases(800, auth); await assist.getCase(3, auth);
await assist.updateCase(3, { vehicle: { carId: 51 }, persons: [{ name: 'Alex' }] }, auth);
await assist.addDocument(3, { cfid: 'file-3', kind: 'hrp', clientRequestId: 'retry-3', requestId: 'NB-DOC-001' }, auth);
await assist.removeDocument(3, 4, auth); await assist.submitCase(3, auth); await assist.submitRequest(3, 'NB-DOC-001', auth);
assert.deepEqual(calls.map(({ url, init }) => [new URL(url).pathname.replace('/functions/v1/honnmono-admin/northbound/assist',''), init.method]), [
  ['/users/800/cases','POST'],['/users/800/cases','GET'],['/cases/3','GET'],['/cases/3/update','POST'],
  ['/cases/3/documents','POST'],['/cases/3/documents/4/remove','POST'],['/cases/3/submit','POST'],['/cases/3/doc-requests/NB-DOC-001/submit','POST'],
]);
assert.deepEqual(JSON.parse(calls[0].init.body), { kind:'renewal', previousCaseId:2 });
assert.equal(JSON.parse(calls[4].init.body).requestId, 'NB-DOC-001');
assert(calls.every(({ init }) => init.headers.Authorization === 'Bearer fixture-token'));
const file = new File(['document bytes'], 'paper.pdf', { type: 'application/pdf' });
const stored = await assist.uploadDocument(3, file, auth);
assert.equal(stored.cfid, 'file-3'); assert.equal(calls.at(-1).init.body, file);
assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer fixture-token');
assert.deepEqual(JSON.parse(calls.at(-2).init.body), { filelist: [{ filename:'paper.pdf',size:file.size,mime:'application/pdf' }] });
const count = calls.length;
await assert.rejects(assist.uploadDocument(3, file, { ...auth, limits: { attachmentMaxMb: 0 } }));
assert.equal(calls.length, count);
globalThis.fetch = original;
console.log('NORTHBOUND_ASSIST_API_CHECK=10/10');
