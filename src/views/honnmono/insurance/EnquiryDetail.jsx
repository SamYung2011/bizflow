import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { formatFeedbackTime } from '../../../lib/honnmonoAdmin.js';
import { changeEnquiryStage } from '../../../lib/insuranceApi.js';
import { ActionStatus, Field, Line, UserCard, useAction } from './Common.jsx';
import { ENQUIRY_STATUS } from './labels.js';

export default function EnquiryDetail({ record, options, reload, lang }) {
  const { t } = useT();
  const action = useAction(reload);
  const [agentName, setAgentName] = useState(record.agentName || '');
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState(() => ({ insurer: record.quote?.insurer || '',
    premium: record.quote?.premium || '', cover: record.quote?.cover || '',
    excess: record.quote?.excess || '', validUntil: record.quote?.validUntil || '',
    note: record.quote?.note || '' }));
  const setQuoteField = (key, value) => setQuote(current => ({ ...current, [key]: value }));
  const stage = (status, extra = {}) => action.run(() => changeEnquiryStage(record.id,
    { status, agentName: agentName || null, note: note || null, ...extra }, options));
  return <div className="nb-detail">
    <header className="nb-detail-head"><div><span>{t('報價詢價')}</span><h2>{record.enquiryNo}</h2>
      <p>{t(ENQUIRY_STATUS[record.status] || record.status)}</p></div>
      <small>{t('最後動作')} {formatFeedbackTime(record.updatedAt, lang)}</small></header>
    <ActionStatus action={action}/>
    <div className="nb-detail-grid"><UserCard user={record.user}/>
      <section className="nb-card"><h3>{t('本次詢價')}</h3>
        <Line label={t('報價車輛')}>{record.carLabel}</Line>
        <Line label={t('想要的保障')}>{t(({ third_party: '第三者保障', comprehensive: '綜合車保', agent_suggest: '請代理提供方案' })[record.coverChoice])}</Line>
        <Line label={t('無索償折扣（NCD）')}>{record.ncd}</Line>
        <Line label={t('主要司機年齡')}>{record.driverAge}</Line>
        <Line label={t('駕駛年資')}>{record.drivingYears}</Line>
        <Line label={t('事故／索償紀錄')}>{record.claimsRecord}</Line>
      </section></div>
    <div className="nb-detail-grid ins-spaced">
      <section className="nb-card"><h3>{t('車輛')}</h3>
        <Line label={t('品牌與車款')}>{[record.vehicle?.brand, record.vehicle?.series].filter(Boolean).join(' ')}</Line>
        <Line label={t('車牌')}>{record.vehicle?.plate}</Line>
      </section>
      <section className="nb-card"><h3>{t('當前保單')}</h3>
        <Line label={t('保險公司')}>{record.policy?.insurer}</Line>
        <Line label={t('保單號碼')}>{record.policy?.policyNo}</Line>
        <Line label={t('保障到期日')}>{record.policy?.coverEnd}</Line>
      </section></div>
    {record.quote && <section className="nb-card ins-spaced"><h3>{t('已錄入報價')}</h3>
      <Line label={t('保險公司')}>{record.quote.insurer}</Line><Line label={t('總保費')}>{record.quote.premium}</Line>
      <Line label={t('保障')}>{record.quote.cover}</Line><Line label={t('墊底費')}>{record.quote.excess}</Line>
      <Line label={t('報價有效期')}>{record.quote.validUntil}</Line><Line label={t('承接代理')}>{record.agentName}</Line>
    </section>}
    <div className="nb-detail-grid nb-actions">
      <section className="nb-card"><h3>{t('代理跟進')}</h3>
        <Field label={t('承接代理')} value={agentName} onChange={setAgentName}/>
        <Field label={t('給使用者看的備註')} value={note} onChange={setNote} multiline/>
        <div className="ins-actions"><button className="nb-primary" type="button" disabled={action.busy || !agentName.trim()}
          onClick={() => stage('assigned')}>{t('分派代理')}</button>
          <button type="button" disabled={action.busy} onClick={() => stage('need_info')}>{t('要求補充資料')}</button></div>
      </section>
      <section className="nb-card"><h3>{t('填寫代理報價')}</h3>
        <Field label={t('保險公司')} value={quote.insurer} onChange={value => setQuoteField('insurer', value)}/>
        <Field label={t('總保費')} value={quote.premium} onChange={value => setQuoteField('premium', value)}/>
        <Field label={t('保障')} value={quote.cover} onChange={value => setQuoteField('cover', value)} multiline/>
        <Field label={t('墊底費')} value={quote.excess} onChange={value => setQuoteField('excess', value)}/>
        <Field label={t('報價有效期')} type="date" value={quote.validUntil} onChange={value => setQuoteField('validUntil', value)}/>
        <Field label={t('報價備註')} value={quote.note} onChange={value => setQuoteField('note', value)} multiline/>
        <button className="nb-primary" type="button" disabled={action.busy || !quote.insurer.trim() || !quote.premium.trim() || !quote.cover.trim() || !quote.validUntil}
          onClick={() => stage('quoted', { quote })}>{t('發出報價')}</button>
      </section>
      <section className="nb-card"><h3>{t('結束詢價')}</h3>
        <p className="nb-muted">{t('完成後，記得把新保單錄入保單核對。')}</p>
        <div className="ins-actions"><button className="nb-primary" type="button" disabled={action.busy}
          onClick={() => stage('done')}>{t('標記完成')}</button>
          <button type="button" disabled={action.busy} onClick={() => stage('cancelled')}>{t('取消詢價')}</button></div>
      </section>
    </div>
  </div>;
}
