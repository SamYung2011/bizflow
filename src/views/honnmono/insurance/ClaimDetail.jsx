import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { formatFeedbackTime } from '../../../lib/honnmonoAdmin.js';
import * as api from '../../../lib/insuranceApi.js';
import { ActionStatus, Documents, Field, Line, UserCard, useAction } from './Common.jsx';
import { CLAIM_RESULTS, CLAIM_STAGES, CLAIM_STATUS, DOC_KINDS } from './labels.js';

function Timeline({ record, lang, t }) {
  const steps = CLAIM_STAGES.filter(([code]) => code !== 'cancelled');
  const active = record.status === 'cancelled' ? -1 : steps.findIndex(([code]) => code === record.status);
  const notices = (record.events || []).filter(event => event.type === 'notice' && event.text);
  return <section className="nb-card"><h3>{t('出險進度')}</h3>
    <ol className="nb-timeline">{steps.map(([code, label], index) => <li key={code}
      className={record.status === 'result' || (active >= 0 && index < active) ? 'is-complete' : index === active ? 'is-current' : ''}>
      <span className="nb-step-dot"/><span>{t(label)}</span>
      {index === active && record.stageNote && <small>{record.stageNote}</small>}
    </li>)}</ol>
    {!!notices.length && <div className="nb-notices"><h4>{t('通知')}</h4>
      {notices.map(event => <p key={event.id}>{event.text}<small>{formatFeedbackTime(event.createdAt, lang)}</small></p>)}
    </div>}
    {record.status === 'result' && <div className="nb-result"><strong>{t(CLAIM_RESULTS.find(([code]) => code === record.result)?.[1] || '已結案')}</strong>
      {record.stageNote && <p>{record.stageNote}</p>}</div>}
  </section>;
}

export default function ClaimDetail({ record, options, reload, lang }) {
  const { t } = useT();
  const action = useAction(reload);
  const [stage, setStage] = useState(record.status);
  const [result, setResult] = useState(record.result || '');
  const [stageNote, setStageNote] = useState('');
  const [wanted, setWanted] = useState([]);
  const [requestNote, setRequestNote] = useState('');
  const [notice, setNotice] = useState('');
  const toggle = kind => setWanted(current => current.includes(kind)
    ? current.filter(item => item !== kind) : [...current, kind]);
  const review = (documentId, status, note) => action.run(() => api.reviewClaimDocument(record.id, documentId, { status, note }, options));
  return <div className="nb-detail">
    <header className="nb-detail-head"><div><span>{t('出險個案')}</span><h2>{record.claimNo}</h2>
      <p>{t(CLAIM_STATUS[record.status] || record.status)}</p></div>
      <small>{t('最後動作')} {formatFeedbackTime(record.updatedAt, lang)}</small></header>
    <ActionStatus action={action} />
    <div className="nb-detail-grid"><UserCard user={record.user} />
      <section className="nb-card"><h3>{t('事故資料')}</h3>
        <Line label={t('事故地區')}>{t(record.region === 'hk' ? '香港' : '中國內地')}</Line>
        <Line label={t('事故日期及時間')}>{formatFeedbackTime(record.incidentAt, lang)}</Line>
        <Line label={t('事故位置')}>{record.location}</Line>
        <Line label={t('事故經過')}>{record.summary}</Line>
        <Line label={t('是否已通知保險公司？')}>{t(({ yes: '已自行通知', no: '尚未通知', unknown: '不確定' })[record.insurerNotified] || '尚未選擇')}</Line>
        <Line label={t('是否有人受傷？')}>{t(({ none: '無人受傷', injured: '有人受傷', unknown: '不確定' })[record.injury] || '尚未選擇')}</Line>
      </section></div>
    <section className="nb-card ins-spaced"><h3>{t('本次所選保單')}</h3>
      <Line label={t('保險公司')}>{record.policy?.insurer}</Line>
      <Line label={t('保單號碼')}>{record.policy?.policyNo}</Line>
      <Line label={t('索償熱線')}>{record.policy?.claimsHotline}</Line>
    </section>
    <Timeline record={record} lang={lang} t={t}/>
    <section className="nb-card"><h3>{t('事故相片與文件')}</h3>
      <Documents documents={record.documents} options={options} lang={lang} busy={action.busy} onReview={review}/></section>
    <div className="nb-detail-grid nb-actions"><section className="nb-card"><h3>{t('更新辦理階段')}</h3>
      <label className="nb-field">{t('階段')}<select value={stage} onChange={event => setStage(event.target.value)}>
        {CLAIM_STAGES.map(([code, label]) => <option key={code} value={code}>{t(label)}</option>)}</select></label>
      <Field label={t('給使用者看的備註')} value={stageNote} onChange={setStageNote} multiline />
      {stage === 'result' && <label className="nb-field">{t('理賠結果')}<select value={result} onChange={event => setResult(event.target.value)}>
        <option value="">{t('請選擇')}</option>{CLAIM_RESULTS.map(([code, label]) => <option key={code} value={code}>{t(label)}</option>)}
      </select></label>}
      <button className="nb-primary" type="button" disabled={action.busy || (stage === 'result' && !result)}
        onClick={() => action.run(() => api.changeClaimStage(record.id,
          { status: stage, note: stageNote || null, ...(stage === 'result' ? { result } : {}) }, options))}>{t('儲存階段')}</button>
    </section>
      <section className="nb-card"><h3>{t('要求補交文件')}</h3>
        <div className="nb-check-grid">{DOC_KINDS.map(([kind, label]) => <label key={kind}>
          <input type="checkbox" checked={wanted.includes(kind)} onChange={() => toggle(kind)} />{t(label)}</label>)}</div>
        <Field label={t('補件備註')} value={requestNote} onChange={setRequestNote} multiline/>
        <button className="nb-primary" type="button" disabled={action.busy || !wanted.length || ['result', 'cancelled'].includes(record.status)}
          onClick={() => action.run(async () => { await api.requestClaimDocuments(record.id,
            { kinds: wanted, note: requestNote }, options); setWanted([]); setRequestNote(''); })}>{t('發出補件要求')}</button>
        {!!record.pendingRequests?.length && <div className="nb-pending">{record.pendingRequests.map(item =>
          <p key={item.requestId}><strong>{item.requestId}</strong> · {item.kinds.map(kind => t(DOC_KINDS.find(([code]) => code === kind)?.[1] || '其他文件')).join('、')}</p>)}</div>}
      </section>
      <section className="nb-card"><h3>{t('通知使用者')}</h3>
        <Field label={t('通知內容')} value={notice} onChange={setNotice} multiline/>
        <button className="nb-primary" type="button" disabled={action.busy || !notice.trim()}
          onClick={() => action.run(async () => { await api.addClaimNotice(record.id, { text: notice.trim() }, options); setNotice(''); })}>{t('儲存通知')}</button>
      </section></div>
  </div>;
}
