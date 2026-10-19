import React from 'react';
import { useT } from '../../../i18n.jsx';
import { formatFeedbackTime } from '../../../lib/honnmonoAdmin.js';
import { fileSize } from '../support/format.js';

export function DocumentMetadata({ document }) {
  const { t, lang } = useT();
  return <small>{[document.mime || t('文件'), document.size == null ? '—' : fileSize(document.size),
    document.createdAt ? formatFeedbackTime(document.createdAt, lang) : '—'].join(' · ')}</small>;
}

export default function DocumentLink({ document, onPreview }) {
  const { t } = useT();
  return <button type="button" className="nb-doc-open" disabled={document.status === 'removed'} onClick={() => onPreview(document)}
    aria-label={t('查看文件：{name}', { name: document.name })}>
    <span className="nb-file-placeholder" aria-hidden="true">{document.mime === 'application/pdf' ? 'PDF' : t('文件')}</span>
    <span><strong>{document.name}</strong><DocumentMetadata document={document} /></span>
  </button>;
}
