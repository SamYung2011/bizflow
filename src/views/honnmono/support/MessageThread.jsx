import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { dayKey, formatDate } from './format.js';
import MessageBubble from './MessageBubble.jsx';
import SupportSkeleton from './SupportSkeleton.jsx';
import SupportIcon from './SupportIcon.jsx';

export default function MessageThread({ data, conversation, employees, options }) {
  const { t, lang } = useT();
  const viewport = useRef(null), content = useRef(null), nearBottom = useRef(true);
  const previous = useRef([]), restore = useRef(null), initialized = useRef(false);
  const [newCount, setNewCount] = useState(0), [image, setImage] = useState(null);
  const messages = data.messages;
  const handoff = conversation.source === 'ai_handoff' ? messages.find(message => message.senderRole === 'system')?.id : null;
  const firstUnread = messages.find(message => message.senderRole === 'user' && message.id > data.unreadId)?.id;
  function bottom() {
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
    nearBottom.current = true; setNewCount(0);
  }
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !messages.length) return;
    if (restore.current && messages[0]?.id !== restore.current.firstId) {
      element.scrollTop = element.scrollHeight - restore.current.height + restore.current.top;
      restore.current = null;
    } else if (!restore.current && (!initialized.current || nearBottom.current)) bottom();
    else {
      const old = previous.current;
      const last = old.at(-1);
      const added = last ? messages.filter(message => message.createdAt >= last.createdAt
        && !old.some(item => item.id === message.id || item.clientMsgId && item.clientMsgId === message.clientMsgId)) : [];
      if (added.length) setNewCount(count => count + added.length);
    }
    initialized.current = true; previous.current = messages;
  }, [messages]);
  useEffect(() => {
    if (!content.current) return;
    const observer = new ResizeObserver(() => { if (nearBottom.current) bottom(); });
    observer.observe(content.current); return () => observer.disconnect();
  }, [data.thread.isPending]);
  useEffect(() => {
    if (!image) return;
    const handleKey = event => { if (event.key === 'Escape') setImage(null); };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); URL.revokeObjectURL(image.url); };
  }, [image]);
  async function older() {
    const element = viewport.current;
    restore.current = { height: element.scrollHeight, top: element.scrollTop, firstId: messages[0]?.id };
    const count = await data.loadOlder();
    if (!count) restore.current = null;
  }
  return <div className="support-thread-shell">
    <div className="support-thread" ref={viewport} tabIndex={0} aria-label={t('訊息記錄')}
      onScroll={() => {
        const element = viewport.current;
        nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 70;
        if (nearBottom.current) setNewCount(0);
      }}>
      {data.thread.isPending ? <SupportSkeleton /> : <div className="support-thread-content" ref={content}>
        {data.hasOlder && <button className="support-load-more" disabled={data.olderBusy} onClick={older}>{t(data.olderBusy ? '載入中…' : '載入較早訊息')}</button>}
        {data.olderError && <div className="support-error" role="alert">{t('載入失敗，請重試')}</div>}
        {messages.map((message, index) => <React.Fragment key={message.clientMsgId || message.id}>
          {(index === 0 || dayKey(message.createdAt) !== dayKey(messages[index - 1].createdAt)) && <div className="support-date"><span>{formatDate(message.createdAt, lang)}</span></div>}
          {index === 0 && handoff && <div className="support-ai-divider">{t('AI 對話記錄')}</div>}
          {firstUnread === message.id && <div className="support-unread-divider">{t('以下為未讀')}</div>}
          <div className={handoff && message.id < handoff ? 'support-ai-history' : ''}>
            <MessageBubble message={message} employees={employees} options={options} onRetry={data.retry} onImage={setImage} />
          </div>
        </React.Fragment>)}
        {data.thread.isError && <div className="support-error" role="alert">{t('載入失敗，請重試')} <button onClick={() => data.thread.refetch()}>{t('重試')}</button></div>}
      </div>}
    </div>
    {newCount > 0 && <button className="support-new-messages" onClick={bottom}><SupportIcon name="arrow" size={16} />{t('{count} 條新訊息', { count: newCount })}</button>}
    {image && <div className="support-lightbox" role="dialog" aria-modal="true" aria-label={t('圖片預覽')} onClick={() => setImage(null)}>
      <button className="support-icon-button" autoFocus onClick={() => setImage(null)} aria-label={t('關閉預覽')}><SupportIcon name="close" /></button>
      <img src={image.url} alt={image.name} onClick={event => event.stopPropagation()} /><span>{image.name}</span>
    </div>}
  </div>;
}
