// Local-only visual fixture for Part 8 staff review. Never contacts a service.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '../src/i18n.jsx';
import AppInsurance from '../src/views/honnmono/AppInsurance.jsx';
import policyList from './fixtures/p8-insurance/policy-list.json';
import policyDetail from './fixtures/p8-insurance/policy-detail.json';
import claimList from './fixtures/p8-insurance/claim-list.json';
import claimDetail from './fixtures/p8-insurance/claim-detail.json';
import enquiryList from './fixtures/p8-insurance/enquiry-list.json';
import enquiryDetail from './fixtures/p8-insurance/enquiry-detail.json';

const query = new URLSearchParams(location.search);
const scenario = query.get('scenario') || 'policy-list';
const type = scenario.split('-')[0];
const lists = { policy: structuredClone(policyList), claim: structuredClone(claimList), enquiry: structuredClone(enquiryList) };
const details = { policy: structuredClone(policyDetail), claim: structuredClone(claimDetail), enquiry: structuredClone(enquiryDetail) };
const record = details[type].result;
const now = Date.now();
const event = (kind, stage, text = '') => ({ id: now, type: kind, stage, text, actor: 'staff', createdAt: now });

if (scenario === 'policy-ready') Object.assign(record, { status: 'ready', insurer: '本地保險公司', coverEnd: '2027-10-01', staffNote: '已核對保單資料。' });
if (scenario === 'policy-unreadable') Object.assign(record, { status: 'unreadable', staffNote: '保單影像未能讀取，請重新上傳。' });
if (scenario === 'claim-accepted') record.documents[0].status = 'accepted';
if (scenario === 'claim-returned') Object.assign(record.documents[0], { status: 'rejected', staffNote: '請補拍文件右下角。' });
if (scenario.startsWith('claim-stage-')) {
  const stage = scenario.slice('claim-stage-'.length);
  record.status = stage === 'paid' || stage === 'denied' || stage === 'closed' ? 'result' : stage;
  record.result = stage === 'paid' || stage === 'denied' || stage === 'closed' ? stage : null;
  record.stageNote = `已更新至${stage}。`;
  record.events.push(event('stage', record.status, record.stageNote));
}
if (scenario === 'claim-request') {
  record.pendingRequests = [{ requestId: 'CL-DOC-001', kinds: ['repair_quote'], note: '請補交維修報價單。' }];
  record.events.push(event('doc_request', null, '請補交維修報價單。'));
}
if (scenario === 'claim-notice') record.events.push(event('notice', null, '已聯絡保險公司，請留意後續消息。'));
if (scenario.startsWith('enquiry-stage-')) {
  const stage = scenario.slice('enquiry-stage-'.length);
  record.status = stage;
  record.agentName = 'Mia';
  if (stage === 'quoted' || stage === 'done') record.quote = { insurer: '本地保險公司', premium: '3000', cover: '綜合車保', excess: '500', validUntil: '2026-12-31' };
  record.events.push(event(stage === 'quoted' ? 'quote' : 'stage', stage, stage === 'need_info' ? '請補充 NCD。' : '已更新詢價。'));
}
record.updatedAt = now;
if (lists[type]?.result?.items?.length) {
  lists[type].result.items[0].status = record.status;
  lists[type].result.items[0].lastActionAt = now;
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.includes('/functions/v1/honnmono-admin/insurance/')) return originalFetch(input, options);
  const route = url.pathname.split('/insurance/')[1];
  if (route.startsWith('files/')) return new Response(new Blob([]), { status: 200 });
  if (options?.method === 'POST') {
    const body = JSON.parse(options.body || '{}');
    if (route.includes('/extract')) Object.assign(details.policy.result, body);
    if (route.includes('/documents/') && route.endsWith('/review')) {
      const id = Number(route.split('/documents/')[1].split('/')[0]);
      const document = details.claim.result.documents.find(item => item.id === id);
      if (document) Object.assign(document, { status: body.status, staffNote: body.note });
    }
    if (route.includes('/stage')) Object.assign(details[type].result, { status: body.status,
      ...(body.result ? { result: body.result } : {}), ...(body.quote ? { quote: body.quote } : {}) });
    if (route.includes('/doc-requests')) details.claim.result.pendingRequests.push({
      requestId: 'CL-DOC-002', kinds: body.kinds, note: body.note });
    if (route.endsWith('/notice')) details.claim.result.events.push(event('notice', null, body.text));
    details[type].result.updatedAt = Date.now();
    lists[type].result.items[0].status = details[type].result.status;
    return new Response(JSON.stringify({ code: 0, des: 'success', result: details[type].result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  const response = route.startsWith('items') ? lists[url.searchParams.get('type') || 'policy'] :
    route.startsWith('policies/') ? details.policy : route.startsWith('claims/') ? details.claim :
    route.startsWith('enquiries/') ? details.enquiry : { code: 404, des: 'fixture route missing', result: {} };
  return new Response(JSON.stringify(response), { status: response.code === 0 ? 200 : 404,
    headers: { 'Content-Type': 'application/json' } });
};

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')).render(<I18nProvider><QueryClientProvider client={client}>
  <AppInsurance session={{ access_token: 'local-fixture', user: { id: 1, email: 'fixture@example.test' } }}/>
</QueryClientProvider></I18nProvider>);

let selectedType = type === 'policy';
let selectedRecord = scenario.endsWith('-list');
let actionStarted = false;
let actionPrepared = false;
const actionLabel = query.get('lang') !== 'zh' ? null : scenario === 'policy-ready' ? '標記已整理' :
  scenario === 'policy-unreadable' ? '標記未能讀取' :
  scenario === 'policy-history' ? '查看已移除文件' :
  scenario === 'claim-accepted' ? '接受' : scenario === 'claim-returned' ? '退回' :
  scenario.startsWith('claim-stage-') ? '儲存階段' :
  scenario === 'claim-request' ? '發出補件要求' : scenario === 'claim-notice' ? '儲存通知' :
  ({ assigned: '分派代理', need_info: '要求補充資料', quoted: '發出報價',
    done: '標記完成', cancelled: '取消詢價' })[scenario.replace('enquiry-stage-', '')];
const timer = setInterval(() => {
  if (!selectedType) {
    const nav = document.querySelector('.ins-type-tabs');
    const button = nav?.querySelectorAll('button')[type === 'claim' ? 1 : 2];
    if (!button) return;
    button.click(); selectedType = true;
  }
  if (!selectedRecord) {
    const button = document.querySelector('.nb-case');
    if (!button) return;
    button.click(); selectedRecord = true;
  }
  if (selectedType && selectedRecord) {
    if (actionLabel && !actionStarted) {
      if (!document.querySelector('.nb-detail')) return;
      if (!actionPrepared && scenario === 'claim-request') document.querySelector('.nb-check-grid input')?.click();
      if (!actionPrepared && scenario === 'claim-notice') {
        const field = [...document.querySelectorAll('.nb-field')].find(item => item.textContent.includes('通知內容'))?.querySelector('textarea');
        if (field) {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, '已聯絡保險公司，請留意後續消息。');
          field.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      actionPrepared = true;
      const button = [...document.querySelectorAll('.nb-detail button')].find(item => item.textContent.trim() === actionLabel);
      if (!button || button.disabled) return;
      button.click(); actionStarted = true;
      return;
    }
    if (actionLabel && scenario !== 'policy-history' && !document.querySelector('[role="status"]')) return;
    clearInterval(timer);
    const workspace = document.querySelector('.nb-workspace');
    workspace.style.height = '2200px';
    workspace.style.maxHeight = 'none';
    window.__P8_PREVIEW_READY = true;
  }
}, 100);
