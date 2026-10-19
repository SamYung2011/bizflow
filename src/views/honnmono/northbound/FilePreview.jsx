import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { fileBlob } from '../../../lib/northboundApi.js';
import { DocumentMetadata } from './DocumentLink.jsx';

// Shared by the existing CaseDetail preview and assisted drafts. Only this mounted
// dialog may request bytes; document rows themselves render metadata only.
export default function FilePreview({ document: file, options, onClose }) {
  const { t } = useT();
  const [thumb, setThumb] = useState(''), [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const resources = useRef(null), dialog = useRef(null);
  const isImage = file.mime?.startsWith('image/');
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(), urls = [];
    const resource = { controller, urls, opening: false };
    resources.current = resource;
    setThumb(''); setOriginal(''); setError(''); setLoading(false);
    if (isImage && file.thumbCfid) {
      fileBlob({ cfid: file.thumbCfid, name: 'thumbnail.jpg' }, { ...options, signal: controller.signal })
        .then(blob => {
          if (controller.signal.aborted) return;
          const url = URL.createObjectURL(blob); urls.push(url); setThumb(url);
        }).catch(() => { if (!controller.signal.aborted) setError(t('無法讀取附件，請重試。')); });
    }
    return () => { controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [file.cfid, file.thumbCfid, isImage, options.accessToken, t]);

  async function openOriginal() {
    const resource = resources.current;
    if (resource.opening || original) return;
    resource.opening = true; setLoading(true); setError('');
    try {
      const blob = await fileBlob(file, { ...options, signal: resource.controller.signal });
      if (resource.controller.signal.aborted) return;
      const url = URL.createObjectURL(blob); resource.urls.push(url); setOriginal(url);
    } catch {
      if (!resource.controller.signal.aborted) setError(t('無法讀取附件，請重試。'));
    } finally {
      resource.opening = false;
      if (!resource.controller.signal.aborted) setLoading(false);
    }
  }
  function keyDown(event) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const nodes = [...dialog.current.querySelectorAll('button:not(:disabled),iframe,a[href]')];
    if (!nodes.includes(document.activeElement) || document.activeElement === (event.shiftKey ? nodes[0] : nodes.at(-1))) {
      event.preventDefault(); (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
    }
  }
  useEffect(() => {
    document.addEventListener('keydown', keyDown, true);
    return () => document.removeEventListener('keydown', keyDown, true);
  }, [onClose]);
  const url = original || thumb;
  return <div className="nb-preview-overlay" role="presentation" onClick={onClose}>
    <div ref={dialog} tabIndex={-1} className={`nb-preview${original ? ' is-original' : ''}`} role="dialog" aria-modal="true"
      aria-label={t('查看文件')} onClick={event => event.stopPropagation()}>
      <header><strong>{file.name}</strong><button type="button" onClick={onClose}>{t('關閉')}</button></header>
      <DocumentMetadata document={file} />
      {isImage && url ? <img src={url} alt={file.name} /> : original ? <iframe src={original} title={file.name} /> :
        <div className="nb-preview-placeholder"><span className="nb-file-placeholder">{file.mime === 'application/pdf' ? 'PDF' : t('文件')}</span></div>}
      {error && <p role="alert" className="nb-alert">{error}</p>}
      <button type="button" className="nb-primary" disabled={loading || !!original} onClick={openOriginal}>{t(loading ? '載入中…' : '開啟原檔')}</button>
    </div>
  </div>;
}
