import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { createTopic, updateTopic } from '../../../lib/knowledgeApi.js';
import MultiLangFields from './MultiLangFields.jsx';
import { fromRecord, payload, saveError, topicFields } from './form.js';

export default function TopicEditor({ record, options, onSaved }) {
  const { t } = useT();
  const [form, setForm] = useState(() => fromRecord(record));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const act = async enabled => {
    setBusy(true); setMessage('');
    try {
      if (!form.title['zh-Hant']?.trim() || !form.subtitle['zh-Hant']?.trim()) throw Error(t('請填妥繁體標題與副標'));
      if (!/^[a-z0-9-]{2,100}$/.test(form.slug.trim())) throw Error(t('slug 請用 2–100 個小寫英文字母、數字或連字號'));
      const body = payload({ ...form, enabled: enabled ?? form.enabled }, topicFields.slice(0, 3));
      const saved = record?.id ? await updateTopic(record.id, body, options) : await createTopic(body, options);
      setForm(fromRecord(saved)); setMessage(t('已儲存'));
      await onSaved(saved);
    } catch (error) { setMessage(saveError(error, t)); }
    finally { setBusy(false); }
  };
  return <section className="promo-detail knowledge-topic-editor">
    <header><h2>{t(record?.id ? '編輯主題' : '新增主題')}</h2><span className="promo-pill">{t(form.enabled ? '已啟用' : '已停用')}</span></header>
    <div className="promo-fields">
      <label className="promo-field"><span>{t('slug')} *</span><input value={form.slug} maxLength={100}
        onChange={event => setForm({ ...form, slug: event.target.value })}/></label>
      <label className="promo-field"><span>{t('排序')}</span><input type="number" step="1" value={form.sort}
        onChange={event => setForm({ ...form, sort: event.target.value })}/></label>
    </div>
    <MultiLangFields fields={topicFields} value={form} onChange={setForm}/>
    <div className="promo-actions">
      <button type="button" disabled={busy} onClick={() => act()}>{t('儲存')}</button>
      <button type="button" disabled={busy || form.enabled} onClick={() => act(true)}>{t('啟用主題')}</button>
      <button type="button" disabled={busy || !form.enabled} onClick={() => act(false)}>{t('停用')}</button>
    </div>
    <p className="nb-muted">{t('停用後此主題下的文章一併隱藏')}</p>
    {message && <p role="status" className="promo-message">{message}</p>}
  </section>;
}
