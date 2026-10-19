import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../i18n.jsx';
import { useAppEmbedVisible } from '../../../lib/appEmbedVisibility.js';
import { getUserProfile } from '../../../lib/supportApi.js';
import * as api from '../../../lib/northboundAssistApi.js';
import AssistUserSearch from './AssistUserSearch.jsx';
import AssistForm from './AssistForm.jsx';
import AssistFiles from './AssistFiles.jsx';
import CaseDetail from './CaseDetail.jsx';
import { KIND_LABELS, TYPE_LABELS, STAGE_LABELS } from './labels.js';
import './assist.css';

const MISSING = { applicant_name: '姓名', phone_hk: '香港電話', phone_cn: '內地電話', address_hk: '香港聯絡地址',
  plate_no: '車牌', car_color: '車輛顏色', driver_mode: '司機模式', persons: '指定司機配置', ...KIND_LABELS };

export default function AssistDraft({ options, onClose, onSubmitted }) {
  const { t, lang } = useT(), visible = useAppEmbedVisible();
  const [user, setUser] = useState(null), [kind, setKind] = useState('first'), [previousCaseId, setPreviousCaseId] = useState('');
  const [record, setRecord] = useState(null), [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [missing, setMissing] = useState([]), [notice, setNotice] = useState('');
  const alert = useRef(null);
  const profile = useQuery({ queryKey: ['northboundAssist', options.operatorEmail, 'profile', user?.id],
    queryFn: ({ signal }) => getUserProfile(user.id, { ...options, signal }), enabled: visible && !!user });
  const cases = useQuery({ queryKey: ['northboundAssist', options.operatorEmail, 'cases', user?.id],
    queryFn: ({ signal }) => api.listCases(user.id, { ...options, signal }), enabled: visible && !!user });
  async function run(action, next) {
    setBusy(true); setError(''); setMissing([]);
    try { const saved = await action(); if (saved) setRecord(saved); if (next != null) setStep(next); return saved; }
    catch (err) {
      setError(t(err.message === 'attachment_too_large' ? '附件超過大小限制' : '操作失敗，請重試'));
      setMissing(err.result?.missing || []);
      requestAnimationFrame(() => alert.current?.scrollIntoView({ block: 'nearest' }));
      return null;
    } finally { setBusy(false); }
  }
  async function create() {
    const saved = await run(() => api.createCase(user.id, { kind, ...(kind === 'renewal' && previousCaseId ? { previousCaseId: Number(previousCaseId) } : {}) }, options), 1);
    if (saved?.existing) setNotice(t('此使用者已有草稿'));
    if (saved) cases.refetch();
  }
  async function open(id) {
    setNotice('');
    const saved = await run(() => api.getCase(id, options));
    if (saved) setStep(saved.status === 'draft' ? 1 : 2);
  }
  async function submit(requestId) {
    const saved = await run(() => requestId ? api.submitRequest(record.id, requestId, options) : api.submitCase(record.id, options));
    if (saved) onSubmitted(saved.id);
  }
  function navigate(next) { setStep(next); setError(''); setMissing([]); }
  return <div className="nb-assist">
    <header className="assist-head"><div><span className="nb-eyebrow">{t('APP 北上')}</span><h2>{t('代客建檔')}</h2></div>
      <button type="button" disabled={busy} onClick={onClose}>{t('返回案件列表')}</button></header>
    <ol className="assist-steps">{['搜尋使用者','填寫資料','上傳與預覽'].map((label,index) => <li key={label} className={Math.min(step,2)===index?'is-current':''}>
      <span>{index+1}</span>{t(label)}</li>)}</ol>
    <div ref={alert}>{error && <div role="alert" className="nb-alert"><p>{missing.length ? t('請補齊以下項目') : error}</p>
      {!!missing.length && <ul>{missing.map(key => <li key={key}>{t(MISSING[key] || '必填資料')}</li>)}</ul>}</div>}
      {notice && <p role="status" className="nb-success">{notice}</p>}</div>
    {step===0 ? <>
      <p className="nb-muted">{t('使用者須已有 App 帳號。')}</p>
      <AssistUserSearch options={options} selectedId={user?.id} disabled={busy} onSelect={value => { setUser(value); setRecord(null); setPreviousCaseId(''); setNotice(''); setError(''); }} />
      {user && <section className="nb-card"><h3>{user.nickname || user.email}</h3>
        {cases.isPending || profile.isPending ? <p>{t('載入中…')}</p> : cases.isError || profile.isError ? <p role="alert">{t('載入失敗，請重試')} <button onClick={() => { cases.refetch(); profile.refetch(); }}>{t('重試')}</button></p> : <>
          {!!cases.data.length && <div className="assist-existing">{cases.data.map(row => <button key={row.id} type="button" disabled={busy} onClick={() => open(row.id)}>
            <strong>{row.caseNo}</strong> · {t(STAGE_LABELS[row.status] || (row.status==='draft'?'草稿 · 尚未提交':'已取消'))}
            {row.pendingRequestCount>0 && <span> · {t('待補件')}</span>}</button>)}</div>}
          <div className="assist-grid"><label className="nb-field">{t('申請類型')}<select value={kind} disabled={busy} onChange={event => setKind(event.target.value)}>
            {Object.entries(TYPE_LABELS).map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
            {kind==='renewal' && <label className="nb-field">{t('上一宗申請')}<select value={previousCaseId} disabled={busy} onChange={event => setPreviousCaseId(event.target.value)}>
              <option value="">{t('不帶入')}</option>{cases.data.map(row => <option key={row.id} value={row.id}>{row.caseNo}</option>)}</select></label>}</div>
          <button className="nb-primary" type="button" disabled={busy} onClick={create}>{t('建立草稿')}</button>
        </>}
      </section>}
    </> : record && <>
      <div className="assist-context"><strong>{record.user?.nickname || user?.nickname}</strong><span>{record.caseNo}</span>
        <button disabled={busy} type="button" onClick={() => navigate(0)}>{t('返回搜尋')}</button></div>
      {step===1 && <AssistForm key={record.id} record={record} cars={profile.data?.cars || []} busy={busy}
        onSave={body => run(() => api.updateCase(record.id, body, options), 2)} />}
      {step===2 && <><AssistFiles key={record.id} record={record} options={options} run={run} busy={busy}
        onPreview={() => navigate(3)} onSubmit={submit} />
        {record.status==='draft' && <button type="button" disabled={busy} onClick={() => navigate(1)}>{t('返回填寫資料')}</button>}</>}
      {step===3 && <><div className="assist-actions"><button type="button" disabled={busy} onClick={() => navigate(2)}>{t('返回文件上傳')}</button>
        {record.status==='draft' && <button className="nb-primary" type="button" disabled={busy} onClick={() => submit()}>{t('代提交申請')}</button>}</div>
        <CaseDetail record={record} options={options} reload={() => run(() => api.getCase(record.id, options))} lang={lang} readOnly />
      </>}
    </>}
  </div>;
}
