// Local visual fixture: every listed offer/coupon below was exported from the task's local PostgreSQL API.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '../src/i18n.jsx';
import AppOffers from '../src/views/honnmono/AppOffers.jsx';
import offers from './fixtures/p9-promo/offers.json';
import coupons from './fixtures/p9-promo/coupons.json';
import offer1 from './fixtures/p9-promo/offers-1.json';
import offer2 from './fixtures/p9-promo/offers-2.json';
import offer3 from './fixtures/p9-promo/offers-3.json';
import coupon1 from './fixtures/p9-promo/coupons-1.json';
import coupon2 from './fixtures/p9-promo/coupons-2.json';
import coupon3 from './fixtures/p9-promo/coupons-3.json';
import support from './fixtures/p9-promo/support.json';
import ConversationHeader from '../src/views/honnmono/support/ConversationHeader.jsx';
import ConversationList from '../src/views/honnmono/support/ConversationList.jsx';
import '../src/views/honnmono/support/support.css';

const scenario = new URLSearchParams(location.search).get('scenario') || 'offer-list';
const offerDetails = { 1: offer1, 2: offer2, 3: offer3 };
const couponDetails = { 1: coupon1, 2: coupon2, 3: coupon3 };
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.includes('/functions/v1/honnmono-admin/promo/')) return originalFetch(input, options);
  const route = url.pathname.split('/promo/')[1];
  const group = route.startsWith('offers') ? offers : coupons;
  let data;
  if (route === 'offers' || route === 'coupons') {
    const status = url.searchParams.get('status');
    const offerId = url.searchParams.get('offerId');
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const items = group.result.items.filter(row => (!status || row.status === status) &&
      (!offerId || row.offerId === Number(offerId)) &&
      (!q || JSON.stringify(row).toLowerCase().includes(q)));
    data = { ...group, result: { ...group.result, items, total: items.length } };
  } else {
    const id = Number(route.split('/')[1]);
    data = route.startsWith('offers/') ? offerDetails[id] : couponDetails[id];
  }
  return Response.json(data || { code: 404, des: 'Local fixture missing', result: {} },
    { status: data ? 200 : 404 });
};

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')).render(<I18nProvider><QueryClientProvider client={queryClient}>
  {scenario === 'support-tag' ? <div className="support-workspace">
    <ConversationList query={{ data: { pages: [[support]] } }} selectedId={support.id} onSelect={() => {}}
      filters={{ state: 'waiting', category: '', search: '' }} setFilters={() => {}} />
    <div className="support-thread"><ConversationHeader conversation={support} employees={[]}
      onChange={async () => {}} onBack={() => {}} /></div>
  </div> : <AppOffers session={{ access_token: 'local-fixture', user: { id: 1, email: 'p9-local@example.test' } }}/>}
</QueryClientProvider></I18nProvider>);

let switched = false, selected = false;
const timer = setInterval(() => {
  if (scenario === 'support-tag') { clearInterval(timer); window.__P9_PREVIEW_READY = true; return; }
  if (scenario.startsWith('coupon') || scenario === 'used' || scenario === 'voided' || scenario === 'available') {
    if (!switched) { document.querySelectorAll('.promo-tabs button')[1]?.click(); switched = true; return; }
  } else switched = true;
  if (scenario === 'new' && !selected) { document.querySelector('.promo-new')?.click(); selected = true; return; }
  if (['published', 'used', 'voided', 'available'].includes(scenario) && !selected) {
    const id = scenario === 'published' ? 1 : scenario === 'used' ? 1 : scenario === 'voided' ? 2 : 3;
    const button = [...document.querySelectorAll('.nb-list .nb-case')].find(item =>
      item.textContent.includes(scenario === 'published' ? offers.result.items.find(row => row.id === id).title :
        coupons.result.items.find(row => row.id === id).code));
    if (!button) return;
    button.click(); selected = true; return;
  }
  if (!document.querySelector('.nb-workspace') ||
      (['offer-list', 'coupon-list'].includes(scenario) && !document.querySelector('.nb-list .nb-case'))) return;
  if (['new', 'published', 'used', 'voided', 'available'].includes(scenario) && !document.querySelector('.promo-detail')) return;
  clearInterval(timer);
  document.querySelector('.nb-workspace').style.height = '1100px';
  window.__P9_PREVIEW_READY = true;
}, 100);
