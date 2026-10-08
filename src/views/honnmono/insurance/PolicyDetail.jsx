import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { formatFeedbackTime } from '../../../lib/honnmonoAdmin.js';
import { extractPolicy } from '../../../lib/insuranceApi.js';
import { ActionStatus, Documents, Field, Line, UserCard, useAction } from './Common.jsx';
import { POLICY_STATUS } from './labels.js';
import { fillEmptyPolicyFields } from './viewLogic.js';

const fields = [
  ['insurer', '保險公司'], ['policyNo', '保單號碼'], ['plateNo', '車牌'],
  ['coverStart', '保障開始日', 'date'], ['coverEnd', '保障到期日', 'date'],
  ['thirdPartyLimit', '第三者責任額'], ['ownDamage', '自己的車輛損失'],
  ['ncd', '無索償折扣（NCD）'], ['excess', '墊底費'], ['claimsHotline', '索償熱線'],
];
const initial = record => Object.fromEntries(['carId', 'insurer', 'policyNo', 'docType', 'plateNo',
  'coverStart', 'coverEnd', 'thirdPartyLimit', 'ownDamage', 'ncd', 'excess', 'claimsHotline', 'note']
  .map(key => [key, key === 'note' ? record.staffNote || '' : record[key] ?? '']));

export default function PolicyDetail({ record, options, reload, lang }) {
  const { t } = useT();
  const [form, setForm] = useState(() => initial(record));
  const action = useAction(reload);
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const submit = status => action.run(() => extractPolicy(record.id, {
    ...form, carId: form.carId ? Number(form.carId) : null,
    docType: form.docType || null, coverStart: form.coverStart || null,
    coverEnd: form.coverEnd || null, status,
  }, options));
  return <div className="nb-detail">
    <header className="nb-detail-head"><div><span>{t('保單核對')}</span><h2>{t(record.region === 'hk' ? '香港保單' : '內地保單')} · #{record.id}</h2>
      <p>{t(POLICY_STATUS[record.status] || record.status)}</p></div>
      <small>{t('最後動作')} {formatFeedbackTime(record.updatedAt, lang)}</small></header>
    <ActionStatus action={action} />
    <div className="nb-detail-grid"><UserCard user={record.user} />
      <section className="nb-card"><h3>{t('保單資料')}</h3>
        <Line label={t('地區')}>{t(record.region === 'hk' ? '香港' : '中國內地')}</Line>
        <Line label={t('保單號碼')}>{record.policyNo}</Line>
        <Line label={t('車牌')}>{record.plateNo}</Line>
        <Line label={t('保障到期日')}>{record.coverEnd}</Line>
      </section></div>
    <section className="nb-card ins-spaced"><h3>{t('保單文件')}</h3>
      <Documents documents={record.documents} options={options} lang={lang} /></section>
    <section className="nb-card"><h3>{t('人工整理保單')}</h3>
      {record.previousPolicy && <button type="button" className="ins-link" disabled={action.busy}
        onClick={() => setForm(current => fillEmptyPolicyFields(current, initial(record.previousPolicy)))}>
        {t('帶入上一張保單資料')}</button>}
      <div className="nb-detail-grid">
        <label className="nb-field">{t('連結車輛')}<select value={form.carId} onChange={event => set('carId', event.target.value)}>
          <option value="">{t('未連結')}</option>
          {(record.vehicles || []).map(car => <option key={car.id} value={car.id}>
            {[car.brand, car.series].filter(Boolean).join(' ')} · {car.plate || '—'}</option>)}
        </select></label>
        <label className="nb-field">{t('文件類型')}<select value={form.docType} onChange={event => set('docType', event.target.value)}>
          <option value="">{t('未選擇')}</option><option value="certificate">{t('保險證書')}</option>
          <option value="policy">{t('保單')}</option><option value="other">{t('其他')}</option></select></label>
        {fields.map(([key, label, type]) => <Field key={key} label={t(label)} value={form[key]}
          required={key === 'insurer' || key === 'coverEnd'}
          type={type || 'text'} onChange={value => set(key, value)} />)}
      </div>
      <Field label={t('給使用者看的備註')} value={form.note} onChange={value => set('note', value)} multiline />
      <div className="ins-actions"><button className="nb-primary" type="button" disabled={action.busy || !form.insurer.trim() || !form.coverEnd || record.status === 'superseded' || record.status === 'removed'}
        onClick={() => submit('ready')}>{t('標記已整理')}</button>
        <button type="button" disabled={action.busy || record.status === 'superseded' || record.status === 'removed'}
          onClick={() => submit('unreadable')}>{t('標記未能讀取')}</button></div>
    </section>
  </div>;
}
