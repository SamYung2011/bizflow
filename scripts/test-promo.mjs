import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { promoSummary } from '../src/views/honnmono/support/format.js';

assert.equal(promoSummary('優惠 · 旅途服務禮遇\n\n優惠 旅途服務禮遇\n\n優惠券 HM-CP-123456 · 旅途服務禮遇'),
  '優惠 旅途服務禮遇\n優惠券 HM-CP-123456 · 旅途服務禮遇');
console.log('Promo summary: 1/1');

const bundle = await build({ entryPoints: ['src/lib/promoApi.js'], bundle: true,
  platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://fixture.invalid',
    VITE_SUPABASE_ANON_KEY: 'public-fixture' }) } });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const previous = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), options });
  return Response.json({ code: 0, result: { id: 7, items: [] } });
};
const auth = { accessToken: 'fixture-token' };
try {
  await api.listOffers({ status: 'published', q: 'local', page: 1, size: 30 }, auth);
  await api.createOffer({ title: 'Local' }, auth);
  await api.getOffer(7, auth);
  await api.updateOffer(7, { status: 'published' }, auth);
  await api.listCoupons({ status: 'available', offerId: 7, q: 'code', page: 1, size: 30 }, auth);
  await api.getCoupon(9, auth);
  await api.useCoupon(9, { note: 'local' }, auth);
  await api.voidCoupon(9, { reason: 'local' }, auth);
  assert.deepEqual(calls.map(item => [new URL(item.url).pathname.replace('/functions/v1/honnmono-admin', ''), item.options.method]), [
    ['/promo/offers', 'GET'], ['/promo/offers', 'POST'], ['/promo/offers/7', 'GET'],
    ['/promo/offers/7', 'PATCH'], ['/promo/coupons', 'GET'], ['/promo/coupons/9', 'GET'],
    ['/promo/coupons/9/use', 'POST'], ['/promo/coupons/9/void', 'POST'],
  ]);
  assert.equal(new URL(calls[0].url).searchParams.get('q'), 'local');
  assert.equal(new URL(calls[4].url).searchParams.get('offerId'), '7');
  assert.deepEqual(JSON.parse(calls[3].options.body), { status: 'published' });
  assert(calls.every(item => item.options.headers.Authorization === 'Bearer fixture-token'));
  console.log('PROMO_API_S1_S8=8/8');
  globalThis.fetch = async () => Response.json({ error: 'Forbidden' }, { status: 403 });
  await assert.rejects(api.listOffers({}, auth), /HTTP 403/);
  globalThis.fetch = async () => Response.json({ error: 'Unauthorized' }, { status: 401 });
  await assert.rejects(api.listOffers({}, auth), /HTTP 401/);
  await assert.rejects(api.listOffers({}, {}), /Missing access token/);
  console.log('PROMO_API_AUTH=3/3');
  globalThis.fetch = async () => Response.json({ code: 409, des: 'Coupon already used', result: {} }, { status: 409 });
  await assert.rejects(api.useCoupon(9, {}, auth), /Coupon already used/);
  globalThis.fetch = async () => Response.json({ code: 409, des: 'Offer changed', result: {} });
  await assert.rejects(api.updateOffer(7, {}, auth), /Offer changed/);
  globalThis.fetch = async () => Response.json({ detail: [{ loc: ['body', 'title'], msg: 'Field required' }] }, { status: 422 });
  await assert.rejects(api.createOffer({}, auth), error => error.message.includes('title：Field required') &&
    !error.message.includes('[object Object]'));
  console.log('PROMO_API_ERRORS=3/3');
} finally { globalThis.fetch = previous; }
