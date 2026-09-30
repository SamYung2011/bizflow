import React, { useEffect, useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { formatFeedbackTime } from '../../../lib/honnmonoAdmin.js';
import * as api from '../../../lib/northboundApi.js';
import Files from './Files.jsx';
import { KINDS, RESULT_LABELS, STAGES, STAGE_LABELS, TYPE_LABELS } from './labels.js';

const display = value => value == null || value === '' ? '—' : String(value);
const triValue = value => value == null ? '' : String(value);
const parseTri = value => value === '' ? null : value === 'true';

function Line({ label, value }) {
  return <div className="nb-info-line"><span>{label}</span><strong>{display(value)}</strong></div>;
}

function TriSelect({ label, value, onChange, t }) {
  return <label className="nb-field">{label}<select value={value} onChange={event => onChange(event.target.value)}>
    <option value="">{t('待核對')}</option><option value="true">{t('是')}</option><option value="false">{t('否')}</option>
  </select></label>;
}

function Timeline({ record, t, lang }) {
  const active = STAGES.findIndex(([code]) => code === record.status);
  const notices = (record.events || []).filter(event => event.type === 'notice' && event.text);
  return <section className="nb-card"><h3>{t('辦理進度')}</h3>
    <ol className="nb-timeline">{STAGES.map(([code, name], index) => <li key={code}
      className={index < active ? 'is-complete' : index === active ? 'is-current' : ''}>
      <span className="nb-step-dot" /><span>{t(name)}</span>
      {index === active && record.stageNote && <small>{record.stageNote}</small>}
    </li>)}</ol>
    {!!notices.length && <div className="nb-notices"><h4>{t('通知')}</h4>{notices.map(event =>
      <p key={event.id}>{event.text}<small>{formatFeedbackTime(event.createdAt, lang)}</small></p>)}</div>}
    {record.status === 'result' && <div className="nb-result">
      <strong>{t(RESULT_LABELS[record.result] || '官方結果')}</strong>
      {record.result === 'approved' && record.qualifiedUntil && <span>{t('有效至')} {record.qualifiedUntil}</span>}
      {record.stageNote && <p>{record.stageNote}</p>}
    </div>}
  </section>;
}

export default function CaseDetail({ record, options, reload, lang }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [preview, setPreview] = useState(null);
  const [stage, setStage] = useState(STAGES.some(([code]) => code === record.status) ? record.status : 'submitted');
  const [stageNote, setStageNote] = useState('');
  const [result, setResult] = useState(record.result || '');
  const [resultDate, setResultDate] = useState(record.qualifiedUntil || '');
  const [wanted, setWanted] = useState([]);
  const [requestNote, setRequestNote] = useState('');
  const [notice, setNotice] = useState('');
  const [flagEdits, setFlagEdits] = useState({});
  const flags = {
    freeService: triValue(record.freeService), renewalWindowOk: triValue(record.renewalWindowOk),
    renewalEmailOk: triValue(record.renewalEmailOk), renewalDataSame: triValue(record.renewalDataSame),
    qualifiedUntil: record.qualifiedUntil || '', ...flagEdits,
  };
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  async function run(action) {
    setBusy(true); setError(''); setSuccess('');
    try { await action(); await reload(); setSuccess(t('已儲存')); }
    catch { setError(t('操作失敗，請重試')); }
    finally { setBusy(false); }
  }
  async function openFile(document) {
    setError('');
    try {
      const blob = await api.fileBlob(document, options);
      setPreview({ name: document.name, mime: document.mime, url: URL.createObjectURL(blob) });
    } catch { setError(t('無法讀取附件，請重試。')); }
  }
  const updateFlag = (key, value) => setFlagEdits(current => ({ ...current, [key]: value }));
  const toggleKind = kind => setWanted(current => current.includes(kind) ? current.filter(value => value !== kind) : [...current, kind]);

  return <div className="nb-detail">
    <header className="nb-detail-head"><div><span>{t(TYPE_LABELS[record.kind] || '首次申請')}</span>
      <h2>{record.caseNo}</h2><p>{t(STAGE_LABELS[record.status] || (record.status === 'draft' ? '草稿 · 尚未提交' : '已取消'))}</p></div>
      <small>{t('最後動作')} {formatFeedbackTime(record.updatedAt, lang)}</small></header>
    {error && <p role="alert" className="nb-alert">{error}</p>}
    {success && <p role="status" className="nb-success">{success}</p>}
    <div className="nb-detail-grid">
      <section className="nb-card"><h3>{t('申請人')}</h3>
        <Line label={t('姓名')} value={record.applicant?.name} />
        <Line label={t('香港電話')} value={record.applicant?.phoneHk} />
        <Line label={t('內地電話')} value={record.applicant?.phoneCn} />
        <Line label={t('香港聯絡地址')} value={record.applicant?.addressHk} />
        <Line label={t('使用者電郵')} value={record.user?.email} />
      </section>
      <section className="nb-card"><h3>{t('申請車輛')}</h3>
        <Line label={t('車牌')} value={record.vehicle?.plateNo} />
        <Line label={t('品牌與車款')} value={[record.vehicle?.brand, record.vehicle?.model].filter(Boolean).join(' ')} />
        <Line label={t('車輛顏色')} value={record.vehicle?.color} />
        <Line label={t('指定司機配置')} value={record.driverMode} />
        {(record.persons || []).map(person => <Line key={person.id}
          label={t('指定司機 {number}', { number: person.sort + 1 })}
          value={`${person.name}${person.idNo ? ` · ${person.idNo}` : ''}`} />)}
      </section>
    </div>
    <Timeline record={record} t={t} lang={lang} />
    <section className="nb-card"><h3>{t('申請文件')}</h3>
      <Files documents={record.documents} options={options} onPreview={openFile} busy={busy}
        onReview={(docId, status, note) => run(() => api.reviewDocument(record.id, docId, { status, note }, options))} />
    </section>
    <div className="nb-detail-grid nb-actions">
      <section className="nb-card"><h3>{t('更新辦理階段')}</h3>
        <label className="nb-field">{t('階段')}<select value={stage} onChange={event => setStage(event.target.value)}>
          {STAGES.map(([code, label]) => <option key={code} value={code}>{t(label)}</option>)}
        </select></label>
        <label className="nb-field">{t('給使用者看的備註')}<textarea value={stageNote} onChange={event => setStageNote(event.target.value)} /></label>
        {stage === 'result' && <><label className="nb-field">{t('官方結果')}<select value={result} onChange={event => setResult(event.target.value)}>
          <option value="">{t('請選擇')}</option><option value="approved">{t('已批核')}</option>
          <option value="rejected">{t('未獲批准')}</option></select></label>
          {result === 'approved' && <label className="nb-field">{t('資格有效至')}<input type="date" value={resultDate} onChange={event => setResultDate(event.target.value)} /></label>}</>}
        <button className="nb-primary" type="button" disabled={busy || record.status === 'draft' || (stage === 'result' && !result)}
          onClick={() => run(() => api.changeStage(record.id, { status: stage, note: stageNote || null,
            ...(stage === 'result' ? { result, ...(result === 'approved' && resultDate ? { qualifiedUntil: resultDate } : {}) } : {}) }, options))}>{t('儲存階段')}</button>
        {record.status === 'draft' && <small className="nb-muted">{t('草稿由使用者提交後才能更新階段')}</small>}
      </section>
      <section className="nb-card"><h3>{t('要求補交文件')}</h3>
        <div className="nb-check-grid">{KINDS.map(([kind, label]) => <label key={kind}>
          <input type="checkbox" checked={wanted.includes(kind)} onChange={() => toggleKind(kind)} />{t(label)}</label>)}</div>
        <label className="nb-field">{t('補件備註')}<textarea value={requestNote} onChange={event => setRequestNote(event.target.value)} /></label>
        <button className="nb-primary" type="button" disabled={busy || record.status === 'draft' || record.status === 'result' || record.status === 'cancelled' || !wanted.length}
          onClick={() => run(async () => { await api.requestDocuments(record.id, { kinds: wanted, note: requestNote }, options); setWanted([]); setRequestNote(''); })}>{t('發出補件要求')}</button>
        {!!record.pendingRequests?.length && <div className="nb-pending">{record.pendingRequests.map(item =>
          <p key={item.requestId}><strong>{item.requestId}</strong> · {item.kinds.map(kind => t(KINDS.find(([code]) => code === kind)?.[1] || '其他文件')).join(lang === 'zh' ? '、' : ', ')}</p>)}</div>}
      </section>
      <section className="nb-card"><h3>{t('通知使用者')}</h3>
        <label className="nb-field">{t('通知內容')}<textarea value={notice} onChange={event => setNotice(event.target.value)} /></label>
        <button className="nb-primary" type="button" disabled={busy || !notice.trim()}
          onClick={() => run(async () => { await api.addNotice(record.id, { text: notice.trim() }, options); setNotice(''); })}>{t('儲存通知')}</button>
      </section>
      <section className="nb-card"><h3>{t('資格與續期核對')}</h3>
        <TriSelect t={t} label={t('免費代辦')} value={flags.freeService} onChange={value => updateFlag('freeService', value)} />
        <TriSelect t={t} label={t('續期窗口')} value={flags.renewalWindowOk} onChange={value => updateFlag('renewalWindowOk', value)} />
        <TriSelect t={t} label={t('續期電郵')} value={flags.renewalEmailOk} onChange={value => updateFlag('renewalEmailOk', value)} />
        <TriSelect t={t} label={t('去年資料一致')} value={flags.renewalDataSame} onChange={value => updateFlag('renewalDataSame', value)} />
        <label className="nb-field">{t('資格有效至')}<input type="date" value={flags.qualifiedUntil} onChange={event => updateFlag('qualifiedUntil', event.target.value)} /></label>
        <button className="nb-primary" type="button" disabled={busy || !Object.keys(flagEdits).length}
          onClick={() => run(async () => {
            const body = Object.fromEntries(Object.entries(flagEdits).map(([key, value]) =>
              [key, key === 'qualifiedUntil' ? value || null : parseTri(value)]));
            await api.updateFlags(record.id, body, options);
            setFlagEdits({});
          })}>{t('儲存核對')}</button>
      </section>
    </div>
    {preview && <div className="nb-preview-overlay" role="presentation" onClick={() => setPreview(null)}>
      <div className="nb-preview" role="dialog" aria-modal="true" aria-label={t('查看文件')} onClick={event => event.stopPropagation()}>
        <header><strong>{preview.name}</strong><button type="button" onClick={() => setPreview(null)}>{t('關閉')}</button></header>
        {preview.mime?.startsWith('image/') ? <img src={preview.url} alt={preview.name} /> :
          <a href={preview.url} download={preview.name}>{t('下載文件')}</a>}
      </div>
    </div>}
  </div>;
}
