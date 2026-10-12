export const sourceFields = [
  { key: 'sourceName', label: '來源名稱', max: 120 },
  { key: 'sourceDesc', label: '來源說明', max: 300, multiline: true },
  { key: 'scope', label: '適用範圍', max: 300, multiline: true },
];
export const topicFields = [
  { key: 'title', label: '標題', required: true, max: 120 },
  { key: 'subtitle', label: '副標', required: true, max: 120 },
  { key: 'description', label: '主題說明', max: 300, multiline: true }, ...sourceFields,
];
export const articleFields = [
  { key: 'title', label: '標題', required: true, max: 120 },
  { key: 'listTitle', label: '列表標題（留空 = 同標題）', max: 120 },
  { key: 'summary', label: '文章摘要', required: true, max: 300, multiline: true },
];
export const fromRecord = (record = {}) => ({ ...record, slug: record.slug || '', sort: record.sort || 0,
  title: record.title || {}, subtitle: record.subtitle || {}, description: record.description || {},
  listTitle: record.listTitle || {}, summary: record.summary || {}, body: record.body || {}, steps: record.steps || {},
  sourceName: record.source?.name || {}, sourceDesc: record.source?.desc || {}, scope: record.source?.scope || {},
  enabled: record.enabled ?? false });
const clean = value => Object.fromEntries(Object.entries(value || {}).map(([key, text]) => [key, text.trim()]).filter(([, text]) => text));
export function payload(form, fields) {
  return { ...Object.fromEntries(fields.map(({ key }) => [key, clean(form[key])])),
    source: { name: clean(form.sourceName), desc: clean(form.sourceDesc), scope: clean(form.scope) },
    slug: form.slug.trim() || null, sort: Number(form.sort), enabled: form.enabled };
}
export const saveError = (error, t) => error.message.includes('slug_taken') ? t('此 slug 已被使用') : error.message;
