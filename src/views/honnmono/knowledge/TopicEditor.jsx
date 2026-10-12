import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { createTopic, updateTopic } from '../../../lib/knowledgeApi.js';
import MultiLangFields from './MultiLangFields.jsx';
import { fromRecord, payload, saveError, topicFields, validate, isLocked } from './form.js';

export default function TopicEditor({ record, options, onSaved, onStatus }) {
  const { t } = useT();
  const [form, setForm] = useState(() => fromRecord(record));
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(!record?.id);
  const locked = isLocked(record);
  const act = async enabled => {
    setBusy(true); onStatus('');
    try {
      validate(form, topicFields, t, { slugRequired: true });
      const body = payload({ ...form, enabled: enabled ?? form.enabled }, topicFields);
      const saved = record?.id ? await updateTopic(record.id, body, options) : await createTopic(body, options);
      setForm(fromRecord(saved));
      await onSaved(saved);
      onStatus(t('已儲存'));
    } catch (error) { onStatus(saveError(error, t)); }
    finally { setBusy(false); }
  };
  return <section className={`promo-detail knowledge-topic-editor ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
    <header><h2>{record?.id ? record.title['zh-Hant'] : t('新增主題')}</h2><span className="promo-pill">{t(form.enabled ? '已啟用' : '已停用')}</span>
      {record?.id && <button type="button" className="knowledge-back" aria-expanded={expanded} onClick={() => { setExpanded(value => !value); onStatus(''); }}>{t(expanded ? '收起主題編輯' : '編輯主題')}</button>}
    </header>
    {expanded && <>
    <div className="promo-fields">
      <label className="promo-field"><span>{t('slug')} *</span><input readOnly={locked} value={form.slug} maxLength={100}
        onChange={event => setForm({ ...form, slug: event.target.value })}/>{locked && <small>{t('App 直接使用，不可改')}</small>}</label>
      <label className="promo-field"><span>{t('排序')}</span><input type="number" step="1" value={form.sort}
        onChange={event => setForm({ ...form, sort: event.target.value })}/></label>
    </div>
    <MultiLangFields fields={topicFields} value={form} onChange={setForm}/>
    <div className="promo-actions">
      <button type="button" disabled={busy} onClick={() => act()}>{t('儲存')}</button>
      <button type="button" disabled={busy || form.enabled} onClick={() => act(true)}>{t('啟用')}</button>
      {!locked && <button type="button" disabled={busy || !form.enabled} onClick={() => act(false)}>{t('停用')}</button>}
    </div>
    {!locked && <p className="nb-muted">{t('停用後此主題下的文章一併隱藏')}</p>}
    </>}
  </section>;
}
