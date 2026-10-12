export const PAGE_SIZE = 30;
const lockedSlugs = new Set(['insurance', 'northbound', 'hk-accident-guide']);
export const isLocked = record => lockedSlugs.has(record?.slug);
export const sourceFields = [
  { key: 'sourceName', source: 'name', label: '來源名稱', max: 120 },
  { key: 'sourceDesc', source: 'desc', label: '來源說明', max: 300, multiline: true },
  { key: 'scope', source: 'scope', label: '適用範圍', max: 300, multiline: true },
];
export const topicFields = [
  { key: 'title', label: '標題', required: '請填妥繁體標題與副標', max: 120 },
  { key: 'subtitle', label: '副標', required: '請填妥繁體標題與副標', max: 120 },
  { key: 'description', label: '主題說明', max: 300, multiline: true }, ...sourceFields,
];
export const articleFields = kind => [
  { key: 'title', label: '標題', required: '請填妥繁體標題與摘要', max: 120 },
  { key: 'listTitle', label: '列表標題（留空 = 同標題）', max: 120 },
  { key: 'summary', label: '文章摘要', required: '請填妥繁體標題與摘要', max: 300, multiline: true },
  { key: 'body', label: kind === 'workflow' ? '導語（選填）' : '正文', max: 20000, multiline: true,
    rows: kind === 'workflow' ? 3 : 10, required: kind === 'workflow' ? false : '請填妥繁體正文' },
  ...(kind === 'workflow' ? [{ key: 'steps', label: '步驟', kind: 'steps', required: '步驟類文章至少一步', invalid: '請填妥繁體步驟標題與內容' }] : []),
  ...sourceFields,
];
export const fromRecord = (record = {}) => ({ ...record, slug: record.slug || '', sort: record.sort || 0,
  title: record.title || {}, subtitle: record.subtitle || {}, description: record.description || {},
  listTitle: record.listTitle || {}, summary: record.summary || {}, body: record.body || {}, steps: record.steps || {},
  sourceName: record.source?.name || {}, sourceDesc: record.source?.desc || {}, scope: record.source?.scope || {},
  enabled: record.enabled ?? false });
const clean = value => Object.fromEntries(Object.entries(value || {}).map(([key, text]) => [key, text.trim()]).filter(([, text]) => text));
export function cleanSteps(value) {
  return Object.fromEntries(Object.entries(value || {}).map(([lang, steps]) => [lang,
    steps.map(step => ({ title: step.title.trim(), text: step.text.trim() })).filter(step => step.title || step.text)
  ]).filter(([, steps]) => steps.length));
}
export function validate(form, fields, t, { slugRequired = false } = {}) {
  for (const field of fields.filter(field => field.required)) {
    const value = form[field.key]?.['zh-Hant'];
    if (field.kind === 'steps') {
      if (!value?.length) throw Error(t(field.required));
      if (value.some(step => !step.title.trim() || !step.text.trim())) throw Error(t(field.invalid));
    } else if (!value?.trim()) throw Error(t(field.required));
  }
  if ((slugRequired || form.slug.trim()) && !/^[a-z0-9-]{2,100}$/.test(form.slug.trim()))
    throw Error(t('slug 請用 2–100 個小寫英文字母、數字或連字號'));
}
export function payload(form, fields) {
  return { ...Object.fromEntries(fields.filter(field => !field.source).map(field =>
    [field.key, field.kind === 'steps' ? cleanSteps(form[field.key]) : clean(form[field.key])])),
    source: Object.fromEntries(sourceFields.map(field => [field.source, clean(form[field.key])])),
    slug: form.slug.trim() || null, sort: Number(form.sort), enabled: form.enabled };
}
export const saveError = (error, t) => error.message.includes('slug_locked')
  ? t('此項目由 App 直接使用，不能改 slug 或停用')
  : error.message.includes('slug_taken') ? t('此 slug 已被使用') : error.message;
