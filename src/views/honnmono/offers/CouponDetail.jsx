import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { formatFeedbackTime } from '../../../lib/honnmonoAdmin.js';
import { useCoupon, voidCoupon } from '../../../lib/promoApi.js';

export default function CouponDetail({ record, options, onChanged }) {
  const { t, lang } = useT();
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const act = async kind => {
    if (kind === 'void' && !reason.trim()) { setMessage(t('請填寫作廢原因')); return; }
    setBusy(true); setMessage('');
    try {
      if (kind === 'use') await useCoupon(record.id, { note: note.trim() }, options);
      else await voidCoupon(record.id, { reason: reason.trim() }, options);
      setMessage(t('狀態已更新'));
      await onChanged();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <section className="promo-detail">
    <header><h2>{t('優惠券詳情')}</h2><span className="promo-pill">{t(({ available: '可使用', used: '已使用', expired: record.voidReason ? '已作廢' : '已過期' })[record.status] || record.status)}</span></header>
    <dl className="promo-facts">
      <div><dt>{t('券號')}</dt><dd>{record.code}</dd></div>
      <div><dt>{t('使用者')}</dt><dd>{record.user?.nickname || '—'} · {record.user?.email || '—'} · {record.user?.phone || '—'}</dd></div>
      <div><dt>{t('優惠')}</dt><dd>{record.offerTitle}</dd></div>
      <div><dt>{t('有效期')}</dt><dd>{formatFeedbackTime(record.validUntil, lang)}</dd></div>
    </dl>
    {record.status === 'available' && <div className="promo-coupon-actions">
      <label className="promo-field"><span>{t('核銷備註（可空）')}</span><input value={note} onChange={event => setNote(event.target.value)}/></label>
      <button type="button" disabled={busy} onClick={() => act('use')}>{t('標記已使用')}</button>
      <label className="promo-field"><span>{t('作廢原因')}</span><input value={reason} onChange={event => setReason(event.target.value)}/></label>
      <button type="button" disabled={busy} onClick={() => act('void')}>{t('作廢')}</button>
    </div>}
    {message && <p role="status" className="promo-message">{message}</p>}
    <h3>{t('事件時間線')}</h3>
    <ol className="promo-timeline">{(record.events || []).map(event => <li key={event.id}>
      <strong>{t(({ claimed: '已領取', presented: '已出示', used: '已使用', voided: '已作廢' })[event.type] || event.type)}</strong>
      <span>{formatFeedbackTime(event.createdAt, lang)} · {event.actor === 'staff' ? t('員工') : event.actor}</span>
      {event.text && <p>{event.text}</p>}
    </li>)}</ol>
  </section>;
}
