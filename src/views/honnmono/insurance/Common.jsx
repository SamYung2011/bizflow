import React, { useEffect, useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { formatFeedbackTime } from '../../../lib/honnmonoAdmin.js';
import { fileBlob } from '../../../lib/insuranceApi.js';
import { DOC_KINDS } from './labels.js';

const value = item => item == null || item === '' ? '—' : String(item);
export function Line({ label, children }) {
  return <div className="nb-info-line"><span>{label}</span><strong>{value(children)}</strong></div>;
}
export function Field({ label, value: input, onChange, type = 'text', multiline = false, required = false, children }) {
  return <label className="nb-field">{label}{required ? ' *' : ''}{children || (multiline
    ? <textarea value={input ?? ''} onChange={event => onChange(event.target.value)} />
    : <input type={type} value={input ?? ''} onChange={event => onChange(event.target.value)} />)}</label>;
}
export function UserCard({ user }) {
  const { t } = useT();
  return <section className="nb-card"><h3>{t('使用者')}</h3>
    <Line label={t('姓名')}>{user?.nickname}</Line><Line label={t('使用者電郵')}>{user?.email}</Line>
    <Line label={t('電話')}>{user?.phone}</Line><Line label={t('香港電話')}>{user?.phoneHk}</Line>
    <Line label={t('內地電話')}>{user?.phoneCn}</Line>
  </section>;
}
export function useAction(reload) {
  const { t } = useT();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  async function run(action) {
    setBusy(true); setError(''); setSuccess('');
    try { await action(); await reload(); setSuccess(t('已儲存')); }
    catch (failure) {
      const message = /^HTTP \d+: (.+)$/.exec(failure?.message || '');
      setError(message ? message[1] : t('操作失敗，請重試'));
    }
    finally { setBusy(false); }
  }
  return { busy, error, success, run };
}
export function ActionStatus({ action }) {
  return <>{action.error && <p role="alert" className="nb-alert">{action.error}</p>}
    {action.success && <p role="status" className="nb-success">{action.success}</p>}</>;
}

function DocumentRow({ document, options, onPreview, onReview, busy, lang }) {
  const { t } = useT();
  const [thumb, setThumb] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!document.thumbCfid) return undefined;
    let live = true, url = '';
    fileBlob({ cfid: document.thumbCfid, name: 'thumbnail.jpg' }, options)
      .then(blob => { url = URL.createObjectURL(blob); if (live) setThumb(url); else URL.revokeObjectURL(url); })
      .catch(() => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [document.thumbCfid, options]);
  return <div className="nb-doc">
    <button type="button" className="nb-doc-open" disabled={document.status === 'removed'} onClick={() => onPreview(document)}>
      {thumb ? <img className="nb-thumb" src={thumb} alt={t('文件縮圖')} /> :
        <span className="nb-file-placeholder">{document.mime?.startsWith('image/') ? 'IMG' : 'PDF'}</span>}
      <span><strong>{document.name}</strong><small>{t('第 {version} 份', { version: document.version })} ·
        {t(({ accepted: '已接受', rejected: '已退回', removed: '已移除' })[document.status] || '待核對')} ·
        {formatFeedbackTime(document.createdAt, lang)}</small></span>
    </button>
    <span className="nb-muted">{document.staffNote || '—'}</span>
    {onReview && document.status !== 'removed' ? <span className="nb-row-actions">
      <input aria-label={t('文件備註（選填）')} value={note} onChange={event => setNote(event.target.value)} />
      <button type="button" disabled={busy} onClick={() => onReview(document.id, 'accepted', note)}>{t('接受')}</button>
      <button type="button" disabled={busy} onClick={() => onReview(document.id, 'rejected', note)}>{t('退回')}</button>
    </span> : <span />}
  </div>;
}
export function Documents({ documents = [], options, onReview, busy, lang }) {
  const { t } = useT();
  const [preview, setPreview] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);
  async function openFile(document) {
    setError('');
    try {
      const blob = await fileBlob(document, options);
      setPreview({ name: document.name, mime: document.mime, url: URL.createObjectURL(blob) });
    } catch { setError(t('無法讀取附件，請重試。')); }
  }
  const current = documents.filter(item => item.status !== 'removed');
  const removed = documents.filter(item => item.status === 'removed');
  const shown = showHistory ? documents : current;
  return <>{error && <p role="alert" className="nb-alert">{error}</p>}
    <div className="nb-doc-groups">{!shown.length && <p className="nb-muted">{t('尚未上傳文件')}</p>}
    {DOC_KINDS.map(([kind, label]) => {
      const files = shown.filter(item => item.kind === kind);
      return files.length ? <div key={kind} className="nb-doc-group"><h4>{t(label)}</h4>
        {files.map(item => <DocumentRow key={item.id} document={item} options={options}
          onPreview={openFile} onReview={onReview} busy={busy} lang={lang} />)}</div> : null;
    })}</div>
    {!!removed.length && <button className="ins-link" type="button" onClick={() => setShowHistory(value => !value)}>
      {t(showHistory ? '收起已移除文件' : '查看已移除文件')}</button>}
    {preview && <div className="nb-preview-overlay" role="presentation" onClick={() => setPreview(null)}>
      <div className="nb-preview" role="dialog" aria-modal="true" aria-label={t('查看文件')} onClick={event => event.stopPropagation()}>
        <header><strong>{preview.name}</strong><button type="button" onClick={() => setPreview(null)}>{t('關閉')}</button></header>
        {preview.mime?.startsWith('image/') ? <img src={preview.url} alt={preview.name} /> :
          <a href={preview.url} download={preview.name}>{t('下載文件')}</a>}
      </div>
    </div>}</>;
}
