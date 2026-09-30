import React, { useEffect, useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { fileBlob } from '../../../lib/northboundApi.js';
import { KIND_LABELS } from './labels.js';

function Thumbnail({ document, options }) {
  const { t } = useT();
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!document.thumbCfid) return undefined;
    let active = true, objectUrl = '';
    fileBlob({ cfid: document.thumbCfid, name: 'thumbnail.jpg' }, options)
      .then(blob => { objectUrl = URL.createObjectURL(blob); if (active) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl); })
      .catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [document.thumbCfid, options]);
  return url ? <img className="nb-thumb" src={url} alt={t('文件縮圖')} /> : <span className="nb-file-placeholder">{t('文件')}</span>;
}

export default function Files({ documents = [], options, onReview, onPreview, busy }) {
  const { t } = useT();
  const groups = Object.entries(documents.reduce((result, document) => {
    (result[document.kind] ||= []).push(document);
    return result;
  }, {}));
  if (!groups.length) return <p className="nb-muted">{t('尚未上傳文件')}</p>;
  return <div className="nb-doc-groups">{groups.map(([kind, rows]) => <section key={kind} className="nb-doc-group">
    <h4>{t(KIND_LABELS[kind] || '其他文件')}</h4>
    {rows.map(document => <DocumentRow key={document.id} document={document} options={options}
      onReview={onReview} onPreview={onPreview} busy={busy} />)}
  </section>)}</div>;
}

function DocumentRow({ document, options, onReview, onPreview, busy }) {
  const { t } = useT();
  const [note, setNote] = useState('');
  return <div className="nb-doc">
    <button type="button" className="nb-doc-open" disabled={document.status === 'removed'} onClick={() => onPreview(document)}
      aria-label={t('查看文件：{name}', { name: document.name })}>
      <Thumbnail document={document} options={options} />
      <span><strong>{document.name}</strong><small>{t('第 {version} 版', { version: document.version })} · {t(
        document.status === 'accepted' ? '已接受' : document.status === 'rejected' ? '已退回'
          : document.status === 'removed' ? '已移除' : '待核對')}</small></span>
    </button>
    {onReview && <><input value={note} onChange={event => setNote(event.target.value)}
      placeholder={t('文件備註（選填）')} aria-label={t('文件備註（選填）')} />
    <div className="nb-row-actions">
      <button type="button" disabled={busy || document.status === 'removed'} onClick={() => onReview(document.id, 'accepted', note)}>{t('接受')}</button>
      <button type="button" disabled={busy || document.status === 'removed'} onClick={() => onReview(document.id, 'rejected', note)}>{t('退回')}</button>
    </div></>}
  </div>;
}
