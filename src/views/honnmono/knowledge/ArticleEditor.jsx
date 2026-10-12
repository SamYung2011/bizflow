import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { createArticle, updateArticle } from '../../../lib/knowledgeApi.js';
import MultiLangFields from './MultiLangFields.jsx';
import StepsEditor from './StepsEditor.jsx';
import { articleFields, fromRecord, payload, saveError, sourceFields } from './form.js';

export default function ArticleEditor({ record, topicId, topics, options, onSaved, onBack }) {
  const { t } = useT();
  const [form, setForm] = useState(() => ({ ...fromRecord(record), topicId: record?.topicId || topicId, kind: record?.kind || 'article' }));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const act = async enabled => {
    setBusy(true); setMessage('');
    try {
      if (!form.title['zh-Hant']?.trim() || !form.summary['zh-Hant']?.trim()) throw Error(t('請填妥繁體標題與摘要'));
      const steps = form.steps['zh-Hant'] || [];
      if (form.kind === 'workflow' && !steps.length) throw Error(t('步驟類文章至少一步'));
      if (form.kind === 'workflow' && steps.some(step => !step.title.trim() || !step.text.trim())) throw Error(t('請填妥繁體步驟標題與內容'));
      if (form.kind === 'article' && !form.body['zh-Hant']?.trim()) throw Error(t('請填妥繁體正文'));
      if (form.slug.trim() && !/^[a-z0-9-]{2,100}$/.test(form.slug.trim())) throw Error(t('slug 請用 2–100 個小寫英文字母、數字或連字號'));
      const body = { ...payload({ ...form, enabled: enabled ?? form.enabled }, [...articleFields, { key: 'body' }]),
        topicId: Number(form.topicId), kind: form.kind,
        steps: Object.fromEntries(Object.entries(form.steps).filter(([, values]) => values.length)) };
      const saved = record?.id ? await updateArticle(record.id, body, options) : await createArticle(body, options);
      setForm({ ...fromRecord(saved), topicId: saved.topicId, kind: saved.kind }); setMessage(t('已儲存'));
      await onSaved(saved);
    } catch (error) { setMessage(saveError(error, t)); }
    finally { setBusy(false); }
  };
  const fields = [...articleFields, ...(form.kind === 'article' ? [{ key: 'body', label: '正文', max: 20000, required: true, multiline: true }] : []), ...sourceFields];
  return <section className="promo-detail knowledge-article-editor">
    <button type="button" className="knowledge-back" onClick={onBack}>{t('返回文章列表')}</button>
    <header><h2>{t(record?.id ? '編輯文章' : '新增文章')}</h2><span className="promo-pill">{t(form.enabled ? '已上架' : '草稿')}</span></header>
    <div className="promo-fields">
      <label className="promo-field"><span>{t('所屬主題')}</span><select value={form.topicId}
        onChange={event => setForm({ ...form, topicId: event.target.value })}>
        {topics.map(topic => <option key={topic.id} value={topic.id}>{topic.title['zh-Hant']}</option>)}
      </select></label>
      <fieldset className="knowledge-kind"><legend>{t('類型')}</legend>
        {[['article', '普通文章'], ['workflow', '步驟']].map(([value, label]) => <label key={value}>
          <input type="radio" name="knowledge-kind" checked={form.kind === value} onChange={() => setForm({ ...form, kind: value })}/>{t(label)}
        </label>)}
      </fieldset>
      <label className="promo-field"><span>{t('slug（選填）')}</span><input maxLength={100} value={form.slug} onChange={event => setForm({ ...form, slug: event.target.value })}/></label>
      <label className="promo-field"><span>{t('排序')}</span><input type="number" step="1" value={form.sort} onChange={event => setForm({ ...form, sort: event.target.value })}/></label>
    </div>
    <MultiLangFields fields={fields} value={form} onChange={setForm} onCopyLanguage={language => {
      if (form.kind === 'workflow') setForm(current => ({ ...current, steps: { ...current.steps, [language]: (current.steps['zh-Hant'] || []).map(step => ({ ...step })) } }));
    }}>{language => form.kind === 'workflow' && <StepsEditor steps={form.steps[language] || []} required={language === 'zh-Hant'}
      onChange={steps => setForm(current => ({ ...current, steps: { ...current.steps, [language]: steps } }))}/>}</MultiLangFields>
    <div className="promo-actions">
      <button type="button" disabled={busy} onClick={() => act()}>{t('儲存')}</button>
      <button type="button" disabled={busy || form.enabled} onClick={() => act(true)}>{t('上架')}</button>
      <button type="button" disabled={busy || !form.enabled} onClick={() => act(false)}>{t('下架')}</button>
    </div>
    {message && <p role="status" className="promo-message">{message}</p>}
  </section>;
}
