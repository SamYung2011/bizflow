import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import DocumentLink from './DocumentLink.jsx';
import { KIND_LABELS } from './labels.js';

export default function Files({ documents = [], onReview, onPreview, busy }) {
  const { t } = useT();
  const groups = Object.entries(documents.reduce((result, document) => {
    (result[document.kind] ||= []).push(document);
    return result;
  }, {}));
  if (!groups.length) return <p className="nb-muted">{t('尚未上傳文件')}</p>;
  return <div className="nb-doc-groups">{groups.map(([kind, rows]) => <section key={kind} className="nb-doc-group">
    <h4>{t(KIND_LABELS[kind] || '其他文件')}</h4>
    {rows.map(document => <DocumentRow key={document.id} document={document}
      onReview={onReview} onPreview={onPreview} busy={busy} />)}
  </section>)}</div>;
}

function DocumentRow({ document, onReview, onPreview, busy }) {
  const { t } = useT();
  const [note, setNote] = useState('');
  return <div className="nb-doc">
    <DocumentLink document={document} onPreview={onPreview} />
    {onReview && <><input value={note} onChange={event => setNote(event.target.value)}
      placeholder={t('文件備註（選填）')} aria-label={t('文件備註（選填）')} />
    <div className="nb-row-actions">
      <button type="button" disabled={busy || document.status === 'removed'} onClick={() => onReview(document.id, 'accepted', note)}>{t('接受')}</button>
      <button type="button" disabled={busy || document.status === 'removed'} onClick={() => onReview(document.id, 'rejected', note)}>{t('退回')}</button>
    </div></>}
  </div>;
}
