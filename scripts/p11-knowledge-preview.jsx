// Disposable browser fixture. No request reaches Supabase, Shenzhen or DeepSeek.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '../src/i18n.jsx';
import AppKnowledge from '../src/views/honnmono/AppKnowledge.jsx';

localStorage.setItem('bizflow-lang', new URLSearchParams(location.search).get('lang') || 'zh');
const source = { name: { 'zh-Hant': 'Honnmono 技術支援' }, desc: { 'zh-Hant': '員工維護的參考資料' }, scope: { 'zh-Hant': 'Honnmono App 使用者' } };
const common = { source, sort: 1, updatedAt: 1791763200000, updatedBy: 'mia@example.test' };
let topics = [
  { ...common, id: 1, slug: 'charging', title: { 'zh-Hant': '充電與轉插' }, subtitle: { 'zh-Hant': '使用、紀錄與異常排查' }, description: { 'zh-Hant': '為使用者解答轉插及充電的常見問題。' }, enabled: true },
  { ...common, id: 2, slug: 'insurance', title: { 'zh-Hant': '車保與北上' }, subtitle: { 'zh-Hant': '辦理前的常見問題' }, description: {}, enabled: true },
  { ...common, id: 3, slug: 'staff-notes', title: { 'zh-Hant': '停用主題' }, subtitle: { 'zh-Hant': '保留資料，暫不公開' }, description: {}, enabled: false },
];
let articles = [
  { ...common, id: 11, topicId: 1, topicSlug: 'charging', slug: 'charging-history', kind: 'article', title: { 'zh-Hant': '如何查看充電紀錄' }, listTitle: { 'zh-Hant': '查看充電紀錄' }, summary: { 'zh-Hant': '了解紀錄內的時間與電量資訊。' }, body: { 'zh-Hant': '在 App「充電紀錄」選擇轉插及日期，再開啟要查看的紀錄。若紀錄未完整，可聯絡真人客服核對；不要據此推斷付款或退款結果。' }, steps: {}, enabled: true, createdAt: 1791763200000 },
  { ...common, id: 12, topicId: 1, topicSlug: 'charging', slug: 'charging-check', kind: 'workflow', title: { 'zh-Hant': '充電異常怎麼排查' }, listTitle: { 'zh-Hant': '充電異常排查' }, summary: { 'zh-Hant': '先確認狀態，再交給客服處理。' }, body: { 'zh-Hant': '遇到充電異常時，請先確保人身安全，再按以下步驟保留資料。' }, steps: { 'zh-Hant': [{ title: '確保安全', text: '如有異味、冒煙或受傷，先遠離設備並尋求緊急協助。' }, { title: '核對紀錄', text: '查看轉插狀態與最近充電紀錄，保留相關時間及截圖。' }] }, enabled: false, createdAt: 1791763200000 },
  { ...common, id: 13, topicId: 2, topicSlug: 'insurance', slug: 'hk-accident-guide', kind: 'article', title: { 'zh-Hant': '香港事故處理' }, listTitle: { 'zh-Hant': '事故指南' }, summary: { 'zh-Hant': '先確保安全，再聯絡真人客服。' }, body: { 'zh-Hant': '請保留相關資料，由真人客服協助核對。' }, steps: {}, enabled: true, createdAt: 1791763200000 },
];
const topicResult = row => ({ ...row, articleCount: articles.filter(a => a.topicId === row.id).length,
  enabledArticleCount: articles.filter(a => a.topicId === row.id && a.enabled).length });
window.__P11_CALLS = [];
window.__P11_STATE = () => structuredClone({ topics, articles });
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.includes('/functions/v1/honnmono-admin/knowledge/')) throw Error(`Unexpected fixture request: ${url.pathname}`);
  const route = url.pathname.split('/knowledge/')[1], [kind, id] = route.split('/'), method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : undefined;
  window.__P11_CALLS.push({ route, method, query: Object.fromEntries(url.searchParams), body });
  if (method !== 'GET' && window.__P11_FAIL_NEXT) {
    const des = window.__P11_FAIL_NEXT;
    delete window.__P11_FAIL_NEXT;
    return Response.json({ code: 422, des }, { status: 422 });
  }
  const group = kind === 'topics' ? topics : articles;
  let data;
  if (method === 'GET') {
    if (id) data = group.find(row => row.id === Number(id));
    else if (kind === 'topics') data = topics.map(topicResult).sort((a, b) => a.sort - b.sort || a.id - b.id);
    else {
      const enabled = url.searchParams.get('enabled'), q = url.searchParams.get('q') || '', topicId = Number(url.searchParams.get('topicId'));
      const rows = articles.filter(row => (!topicId || row.topicId === topicId) && (!enabled || row.enabled === (enabled === 'true')) &&
        (!q || [row.title['zh-Hant'], row.listTitle['zh-Hant'], row.summary['zh-Hant']].join(' ').includes(q)));
      const page = Number(url.searchParams.get('page') || 1), size = Number(url.searchParams.get('size') || 30);
      data = { items: rows.slice((page - 1) * size, page * size), total: rows.length, page, size };
    }
  } else {
    const locked = group.find(row => row.id === Number(id));
    if (locked && ['insurance', 'northbound', 'hk-accident-guide'].includes(locked.slug) &&
        ((Object.hasOwn(body, 'slug') && body.slug !== locked.slug) || body.enabled === false))
      return Response.json({ code: 422, des: 'slug_locked' }, { status: 422 });
    if (body.slug && group.some(row => row.slug === body.slug && row.id !== Number(id)))
      return Response.json({ code: 409, des: 'slug_taken', result: {} }, { status: 409 });
    const existing = id ? group.find(row => row.id === Number(id)) : null;
    data = { ...common, ...(existing || {}), ...body, id: existing?.id || Math.max(0, ...group.map(row => row.id)) + 1,
      enabled: body.enabled ?? existing?.enabled ?? false };
    if (kind === 'articles') {
      data.topicSlug = topics.find(row => row.id === data.topicId)?.slug;
      if (!Object.keys(data.listTitle || {}).length) data.listTitle = structuredClone(data.title);
    }
    if (existing) Object.assign(existing, data); else group.push(data);
  }
  if (kind === 'topics' && data && !Array.isArray(data)) data = topicResult(data);
  return Response.json(data ? { code: 0, des: 'success', result: data } : { code: 404, des: 'Not found', result: {} }, { status: data ? 200 : 404 });
};
createRoot(document.getElementById('root')).render(<I18nProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <AppKnowledge session={{ access_token: 'local-fixture', user: { id: 'local-employee', email: 'mia@example.test' } }}/>
</QueryClientProvider></I18nProvider>);
