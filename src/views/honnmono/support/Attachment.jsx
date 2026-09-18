import React, { useEffect, useRef, useState } from 'react';
import { fileUrl } from '../../../lib/supportApi.js';
import { useT } from '../../../i18n.jsx';
import SupportIcon from './SupportIcon.jsx';
import { fileSize } from './format.js';

export default function Attachment({ attachment, type, options, onImage }) {
  const { t } = useT();
  const ref = useRef(null);
  const [visible, setVisible] = useState(false), [url, setUrl] = useState('');
  const [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (type === 'file') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(ref.current); return () => observer.disconnect();
  }, [type]);
  useEffect(() => {
    if (!visible || type === 'file') return;
    const controller = new AbortController(); let objectUrl;
    setError(false);
    const thumbnail = type === 'image' && !attachment.thumbCfid && attachment.thumbUrl;
    const source = type === 'image' && attachment.thumbCfid
      ? { ...attachment, cfid: attachment.thumbCfid, name: 'thumbnail.jpg' } : attachment;
    const promise = thumbnail ? Promise.resolve(thumbnail) : fileUrl(source, { ...options, signal: controller.signal });
    promise.then(value => {
      if (!thumbnail) objectUrl = value;
      if (!controller.signal.aborted) setUrl(value);
      else if (objectUrl) URL.revokeObjectURL(objectUrl);
    }).catch(error => { if (error.name !== 'AbortError') setError(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [visible, attachment.cfid, attachment.thumbCfid, attachment.thumbUrl, options.accessToken, type, attempt]);
  async function open() {
    setBusy(true); setError(false);
    try {
      const fullUrl = await fileUrl(attachment, options);
      if (type === 'image') onImage({ url: fullUrl, name: attachment.name });
      else {
        const anchor = document.createElement('a'); anchor.href = fullUrl; anchor.download = attachment.name;
        anchor.click(); setTimeout(() => URL.revokeObjectURL(fullUrl), 60000);
      }
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <div ref={ref} className={`support-attachment ${type}`}>
    {type === 'image' && <button onClick={open} disabled={busy} aria-label={t('開啟圖片：{name}', { name: attachment.name })}>
      {url ? <img src={url} alt={attachment.name} loading="lazy" onError={() => setError(true)} /> : <span className="support-media-placeholder" />}</button>}
    {type === 'voice' && <><span className="support-voice-title">{t('語音訊息')} · {t('{seconds} 秒', { seconds: attachment.duration })}</span>
      <audio controls preload="none" src={url || undefined} aria-label={t('播放語音')} onError={() => setError(true)} /></>}
    {type === 'file' && <button className="support-file" onClick={open} disabled={busy}>
      <span className="support-file-icon"><SupportIcon name="file" size={24} /></span><span><strong>{attachment.name}</strong><small>{fileSize(attachment.size)} · {t(busy ? '準備下載…' : '下載附件')}</small></span><SupportIcon name="arrow" size={18} /></button>}
    {error && <button className="support-media-error" onClick={() => type === 'file' ? open() : setAttempt(value => value + 1)}>{t('載入失敗，請重試')}</button>}
  </div>;
}
