// Local-only visual fixture. It never reaches a live bridge or device.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '../src/i18n.jsx';
import AppNorthbound from '../src/views/honnmono/AppNorthbound.jsx';

const now = Date.now();
const base = {
  id: 71, caseNo: 'HM-NB-000071', kind: 'renewal', status: 'checking', result: null,
  stageNote: '資料已收到，正在核對。', applicant: { name: '陳小姐', phoneHk: '6123 4567', phoneCn: '138 0000 1234', addressHk: '香港九龍' },
  vehicle: { carId: 2, plateNo: 'AB 1234', color: '銀色', brand: 'Tesla', model: 'Model 3' },
  driverMode: '0+2', freeService: null, renewalWindowOk: true, renewalEmailOk: null,
  renewalDataSame: null, qualifiedUntil: '', createdAt: now - 86400000,
  updatedAt: now, submittedAt: now - 70000000, staffUpdatedAt: now - 10000,
  user: { id: 19, nickname: '陳小姐', email: 'customer@example.test' },
  persons: [{ id: 1, sort: 0, name: '陳先生', idNo: '' }, { id: 2, sort: 1, name: '林小姐', idNo: '' }],
  documents: [
    { id: 1, cfid: 'fixture-one', thumbCfid: 'fixture-thumb', name: '車輛牌簿.jpg', mime: 'image/png', kind: 'vehicle_license', version: 1, status: 'uploaded' },
    { id: 2, cfid: 'fixture-two', name: '回鄉證.pdf', mime: 'application/pdf', kind: 'hrp', version: 1, status: 'accepted' },
  ],
  events: [{ id: 1, type: 'stage', stage: 'submitted', text: '', actor: 'user', createdAt: now - 70000000 },
    { id: 2, type: 'notice', text: '已收到申請文件。', actor: 'staff@example.test', createdAt: now - 10000 }],
  pendingRequests: [{ requestId: 'NB-DOC-001', kinds: ['driver_doc'], note: '請補交司機證件。' }],
  pendingRequestCount: 1,
};
const records = [base, { ...base, id: 70, caseNo: 'HM-NB-000070', kind: 'first', status: 'result', result: 'approved',
  qualifiedUntil: '2027-09-30', pendingRequests: [], pendingRequestCount: 0, documents: [], events: [], updatedAt: now - 86400000 }];
const scenario = new URLSearchParams(location.search).get('scenario') || 'detail';
if (scenario === 'result') base.status = 'result', base.result = 'rejected', base.pendingRequests = [];

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#f5e6a4"/><rect x="13" y="15" width="94" height="60" rx="5" fill="white"/><text x="23" y="49" font-size="14" fill="#222">HM SAMPLE</text></svg>`;
window.fetch = async (input, init = {}) => {
  const url = new URL(input);
  if (url.origin !== 'https://fixture.invalid') throw new Error('Fixture forbids external requests');
  const path = url.pathname.replace('/functions/v1/honnmono-admin/northbound', '');
  if (path.startsWith('/files/')) return new Response(icon, { headers: { 'Content-Type': 'image/svg+xml' } });
  let result;
  if (path === '/cases' && init.method === 'GET') {
    const status = url.searchParams.get('status');
    const items = records.filter(row => status === 'all' || (status === 'done' ? row.status === 'result' : row.status !== 'result'));
    result = { items, total: items.length, page: 1, size: 30 };
  } else if (/^\/cases\/\d+$/.test(path) && init.method === 'GET') {
    result = records.find(row => row.id === Number(path.split('/').at(-1)));
  } else if (init.method === 'POST') {
    const row = records.find(value => String(value.id) === path.split('/')[2]);
    const body = JSON.parse(init.body || '{}');
    if (path.endsWith('/stage')) Object.assign(row, { status: body.status, result: body.result || null, stageNote: body.note || '', qualifiedUntil: body.qualifiedUntil || row.qualifiedUntil });
    if (path.endsWith('/doc-requests')) row.pendingRequests.push({ requestId: `NB-DOC-${String(row.pendingRequests.length + 1).padStart(3, '0')}`, ...body });
    if (path.includes('/review')) row.documents.find(doc => String(doc.id) === path.split('/')[4]).status = body.status;
    if (path.endsWith('/notice')) row.events.push({ id: row.events.length + 1, type: 'notice', text: body.text, createdAt: Date.now() });
    if (path.endsWith('/flags')) Object.assign(row, body);
    row.updatedAt = Date.now();
    result = row;
  }
  return Response.json({ code: 0, result });
};

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><I18nProvider>
  <AppNorthbound session={{ access_token: 'local-fixture', user: { id: 'staff', email: 'staff@example.test' } }} />
</I18nProvider></QueryClientProvider>);
if (scenario !== 'list') {
  const highlight = { review: '.nb-doc-group', stage: '.nb-actions .nb-card:nth-child(1)',
    request: '.nb-actions .nb-card:nth-child(2)', notice: '.nb-actions .nb-card:nth-child(3)',
    flags: '.nb-actions .nb-card:nth-child(4)' }[scenario];
  if (highlight) {
    const style = document.createElement('style');
    style.textContent = `${highlight}{outline:3px solid #ffd12d;outline-offset:3px}`;
    document.head.append(style);
  }
  let switched = false;
  const timer = setInterval(() => {
    if (scenario === 'result' && !switched) {
      const done = document.querySelector('.nb-filters button:nth-child(2)');
      if (done) { done.click(); switched = true; }
      return;
    }
    const first = document.querySelector('.nb-case');
    if (!first) return;
    first.click();
    clearInterval(timer);
    if (scenario === 'preview') {
      const previewTimer = setInterval(() => {
        const file = document.querySelector('.nb-doc-open');
        if (file) { file.click(); clearInterval(previewTimer); }
      }, 100);
    }
  }, 100);
}
