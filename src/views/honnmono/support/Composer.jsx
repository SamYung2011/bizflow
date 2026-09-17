import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../../../i18n.jsx';
import SupportIcon from './SupportIcon.jsx';
import { fileSize } from './format.js';

async function prepareImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  if (!blob) throw new Error('Image conversion failed');
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

export default function Composer({ closed, limits, onSend }) {
  const { t } = useT();
  const [text, setText] = useState(''), [files, setFiles] = useState([]), [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const input = useRef(null), textarea = useRef(null), urls = useRef(new Set());
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);
  useLayoutEffect(() => {
    if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 150)}px`; }
  }, [text]);
  async function attach(selected) {
    setPreparing(true); setError('');
    try {
      const prepared = await Promise.all([...selected].map(prepareImage));
      if (prepared.some(file => file.size > limits.attachmentMaxMb * 1024 * 1024)) {
        setError(t('附件不可超過 {size} MB', { size: limits.attachmentMaxMb })); return;
      }
      setFiles(current => [...current, ...prepared.map(file => {
        const url = URL.createObjectURL(file); urls.current.add(url); return { file, url };
      })]);
    } catch { setError(t('無法讀取附件，請重試')); }
    finally { setPreparing(false); if (input.current) input.current.value = ''; }
  }
  function remove(index) {
    URL.revokeObjectURL(files[index].url); urls.current.delete(files[index].url);
    setFiles(current => current.filter((_, item) => item !== index));
  }
  function submit(event) {
    event.preventDefault();
    if (closed || preparing || !text.trim() && !files.length) return;
    onSend({ content: text.trim(), files: files.map(item => item.file) });
    files.forEach(item => { URL.revokeObjectURL(item.url); urls.current.delete(item.url); });
    setFiles([]); setText(''); setError(''); textarea.current.focus();
  }
  if (closed) return <div className="support-closed"><SupportIcon name="check" /><div><strong>{t('此會話已結束')}</strong><span>{t('記錄已保留，使用者再次聯絡會開啟新會話')}</span></div></div>;
  return <form className="support-composer" onSubmit={submit}>
    {files.length > 0 && <div className="support-attachment-previews">{files.map(({ file, url }, index) => <div key={url}>
      {file.type.startsWith('image/') ? <img src={url} alt={file.name} /> : <span><SupportIcon name="file" />{file.name}<small>{fileSize(file.size)}</small></span>}
      <button type="button" aria-label={t('移除附件：{name}', { name: file.name })} onClick={() => remove(index)}><SupportIcon name="close" size={14} /></button>
    </div>)}</div>}
    {error && <div className="support-error" role="alert">{error}</div>}
    <div className="support-compose-row">
      <input hidden ref={input} type="file" multiple onChange={event => attach(event.target.files)} />
      <button type="button" className="support-icon-button" aria-label={t('加入圖片或檔案')} disabled={preparing} onClick={() => input.current.click()}><SupportIcon name="clip" /></button>
      <textarea ref={textarea} rows={1} value={text} placeholder={t('回覆使用者…')} aria-label={t('回覆使用者')}
        onChange={event => setText(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) submit(event);
        }} />
      <button type="submit" className="support-send" disabled={preparing || !text.trim() && !files.length} aria-label={t('傳送訊息')}><SupportIcon name="send" size={20} /></button>
    </div>
    <div className="support-composer-hint"><span>{t(preparing ? '正在處理附件…' : 'Enter 傳送 · Shift + Enter 換行')}</span><span>{t('以客服身分回覆')}</span></div>
  </form>;
}
