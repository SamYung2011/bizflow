import React from 'react';
import { useT } from '../../../i18n.jsx';
import { reportFact } from './chargeReport.js';
import './charge-report.css';

export default function ChargeReportCard({ report }) {
  const { t, lang } = useT();
  const insights = report.insightsByLanguage?.[lang] || (lang === 'fr' ? report.insightsByLanguage?.en : null) || report.insights;
  const facts = (Array.isArray(report.facts) ? report.facts : []).flatMap((fact, index) => {
    if (!fact || typeof fact.label !== 'string') return [];
    const value = reportFact(fact, t, lang);
    return value === null ? [] : [{ label: fact.label, value, index }];
  });
  return <section className="support-charge-report" aria-label={t('本次充電報告')}>
    <span className="support-operation-label">{t('客戶操作')} · {t('分享充電報告')}</span>
    <h3>{t('本次充電報告')}</h3>
    <p className="support-charge-result">{t(report.summary)}</p>
    {!!facts.length && <dl>{facts.map(fact => <div key={fact.index}><dt>{t(fact.label)}</dt><dd>{fact.value}</dd></div>)}</dl>}
    {insights?.version === 1 && <div className="support-charge-insights">
      {insights.sections?.map(section => <div key={section.kind}><h4>{section.title}</h4><p>{section.text}</p></div>)}
    </div>}
    {Array.isArray(report.notes) && report.notes.length > 0 && <ul className="support-charge-notes">{report.notes.map((note, i) => <li key={i}>{t(note)}</li>)}</ul>}
    {Array.isArray(report.staffAdvice) && report.staffAdvice.length > 0 && <div className="support-charge-advice">
      <h4>{t('客服處理建議')}</h4><ol>{report.staffAdvice.map((advice, i) => <li key={i}>{t(advice)}</li>)}</ol>
    </div>}
  </section>;
}
