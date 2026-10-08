import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { createOffer, updateOffer } from '../../../lib/promoApi.js';

const localValue = value => {
  if (value == null) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
};
const localDateTime = value => localValue(value).slice(0, 16);
const localDate = value => localValue(value).slice(0, 10);
const millis = value => value ? new Date(value).getTime() : null;
const blank = { title: '', category: '', summary: '', terms: '', merchantName: '',
  merchantAddress: '', merchantPhone: '', merchantNote: '', claimStart: '', claimEnd: '',
  validUntil: '', validDays: '30', perUserLimit: '1', totalQuota: '', sort: '0', validity: 'days' };

function fromOffer(record) {
  if (!record) return blank;
  return { title: record.title || '', category: record.category || '', summary: record.summary || '',
    terms: record.terms || '', merchantName: record.merchantName || '',
    merchantAddress: record.merchantAddress || '', merchantPhone: record.merchantPhone || '',
    merchantNote: record.merchantNote || '', claimStart: localDateTime(record.claimStart),
    claimEnd: localDateTime(record.claimEnd), validUntil: localDate(record.validUntil),
    validDays: String(record.validDays || 30), perUserLimit: String(record.perUserLimit || 1),
    totalQuota: record.totalQuota == null ? '' : String(record.totalQuota), sort: String(record.sort || 0),
    validity: record.validUntil != null && record.validDays == null ? 'fixed' : 'days' };
}

function payload(form) {
  return { title: form.title.trim(), category: form.category.trim(), summary: form.summary.trim(),
    terms: form.terms.trim(), merchantName: form.merchantName.trim() || null,
    merchantAddress: form.merchantAddress.trim() || null, merchantPhone: form.merchantPhone.trim() || null,
    merchantNote: form.merchantNote.trim() || null, claimStart: millis(form.claimStart),
    claimEnd: millis(form.claimEnd), validUntil: form.validity === 'fixed' ? millis(`${form.validUntil}T23:59:59`) : null,
    validDays: form.validity === 'days' ? Number(form.validDays) : null,
    perUserLimit: Number(form.perUserLimit), totalQuota: form.totalQuota ? Number(form.totalQuota) : null,
    sort: Number(form.sort) };
}

export default function OfferEditor({ record, options, categories, onSaved }) {
  const { t } = useT();
  const [form, setForm] = useState(() => fromOffer(record));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const set = (field, value) => setForm(current => ({ ...current, [field]: value }));
  const field = (name, label, type = 'text', extra = {}) => <label className="promo-field" key={name}>
    <span>{t(label)}</span><input type={type} value={form[name]} onChange={event => set(name, event.target.value)} {...extra}/>
  </label>;
  const act = async status => {
    setBusy(true); setMessage('');
    try {
      const body = payload(form);
      if (!body.title || !body.category || !body.summary || !body.terms ||
          (form.validity === 'fixed' && !form.validUntil)) throw new Error(t('請填妥優惠內容與有效期'));
      const saved = record?.id ? await updateOffer(record.id, body, options) : await createOffer(body, options);
      const result = status ? await updateOffer(saved.id, { status }, options) : saved;
      setMessage(t('已儲存'));
      await onSaved(result);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <section className="promo-detail">
    <header><h2>{record?.id ? t('編輯優惠') : t('新增優惠')}</h2>
      {record?.id && <span className="promo-pill">{t(({ draft: '草稿', published: '上架中', ended: '已結束' })[record.status] || record.status)}</span>}</header>
    <div className="promo-fields">
      {field('title', '標題', 'text', { required: true })}
      <label className="promo-field"><span>{t('類別')}</span>
        <input list="promo-existing-categories" value={form.category} onChange={event => set('category', event.target.value)} required/>
        <datalist id="promo-existing-categories">{categories.map(value => <option key={value} value={value}/>)}</datalist>
      </label>
      {field('summary', '一句簡介', 'text', { required: true })}
      <label className="promo-field promo-span"><span>{t('條款')}</span><textarea rows="5" value={form.terms}
        onChange={event => set('terms', event.target.value)} required/></label>
      {field('merchantName', '商戶名稱')}{field('merchantAddress', '商戶地址')}
      {field('merchantPhone', '商戶電話')}{field('merchantNote', '預約說明')}
      {field('claimStart', '領取期開始', 'datetime-local')}{field('claimEnd', '領取期結束', 'datetime-local')}
      <label className="promo-field"><span>{t('券有效期規則')}</span><select value={form.validity}
        onChange={event => set('validity', event.target.value)}>
        <option value="days">{t('領取後 N 天')}</option><option value="fixed">{t('固定到期日')}</option>
      </select></label>
      {form.validity === 'fixed' ? field('validUntil', '固定到期日', 'date', { required: true }) :
        field('validDays', '領取後天數', 'number', { min: 1, required: true })}
      {field('perUserLimit', '每人限領', 'number', { min: 1, required: true })}
      {field('totalQuota', '總量（空為不限）', 'number', { min: 1 })}
      {field('sort', '排序', 'number')}
    </div>
    <div className="promo-actions">
      <button type="button" disabled={busy} onClick={() => act()}>{t('儲存')}</button>
      {record?.status !== 'published' && record?.status !== 'ended' &&
        <button type="button" disabled={busy} onClick={() => act('published')}>{t('上架')}</button>}
      {record?.status === 'published' && <button type="button" disabled={busy} onClick={() => act('draft')}>{t('下架')}</button>}
      {record?.id && record.status !== 'ended' && <button type="button" disabled={busy}
        onClick={() => act('ended')}>{t('結束')}</button>}
    </div>
    {message && <p role="status" className="promo-message">{message}</p>}
  </section>;
}
