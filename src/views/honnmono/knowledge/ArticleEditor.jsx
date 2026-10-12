import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { createArticle, updateArticle } from '../../../lib/knowledgeApi.js';
import MultiLangFields from './MultiLangFields.jsx';
import { articleFields, fromRecord, payload, saveError, validate, isLocked } from './form.js';

export default function ArticleEditor({ record, topicId, topics, options, onSaved, onBack, onStatus }) {
  const { t } = useT();
  const [form, setForm] = useState(() => ({ ...fromRecord(record), topicId: record?.topicId || topicId, kind: record?.kind || 'article' }));
  const [busy, setBusy] = useState(false);
  const locked = isLocked(record);
  const fields = articleFields(form.kind);
  const act = async enabled => {
    setBusy(true); onStatus('');
    try {
      validate(form, fields, t);
      const content = payload({ ...form, enabled: enabled ?? form.enabled }, fields);
      const body = { ...content, topicId: Number(form.topicId), kind: form.kind, steps: content.steps || {} };
      const saved = record?.id ? await updateArticle(record.id, body, options) : await createArticle(body, options);
      setForm({ ...fromRecord(saved), topicId: saved.topicId, kind: saved.kind });
      await onSaved(saved);
      onStatus(t('已儲存'));
    } catch (error) { onStatus(saveError(error, t)); }
    finally { setBusy(false); }
  };

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
      <label className="promo-field"><span>{t('slug（選填）')}</span><input maxLength={100} readOnly={locked} value={form.slug} onChange={event => setForm({ ...form, slug: event.target.value })}/>{locked && <small>{t('App 直接使用，不可改')}</small>}</label>
      <label className="promo-field"><span>{t('排序')}</span><input type="number" step="1" value={form.sort} onChange={event => setForm({ ...form, sort: event.target.value })}/></label>
    </div>
    <MultiLangFields fields={fields} value={form} onChange={setForm}/>
    <div className="promo-actions">
      <button type="button" disabled={busy} onClick={() => act()}>{t('儲存')}</button>
      <button type="button" disabled={busy || form.enabled} onClick={() => act(true)}>{t('上架')}</button>
      {!locked && <button type="button" disabled={busy || !form.enabled} onClick={() => act(false)}>{t('下架')}</button>}
    </div>
  </section>;
}
