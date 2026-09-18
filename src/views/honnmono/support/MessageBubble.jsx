import React from 'react';
import { useT } from '../../../i18n.jsx';
import { staffName, systemMessageKey } from '../../../lib/supportConfig.js';
import { formatTime, fileSize } from './format.js';
import Attachment from './Attachment.jsx';
import SupportIcon from './SupportIcon.jsx';

export default function MessageBubble({ message, employees, options, onRetry, onImage }) {
  const { t, lang } = useT();
  const staff = message.senderRole === 'staff';
  if (message.senderRole === 'system' || message.msgType === 'system') return <div className="support-system">{t(systemMessageKey(message.content))}</div>;
  return <div className={`support-message-row ${staff ? 'is-staff' : ''}`} data-message-id={message.id}>
    <div className={`support-bubble ${message.senderRole === 'ai' ? 'is-ai' : ''} ${message.state === 'failed' ? 'is-failed' : ''}`}>
      {message.senderRole === 'ai' && <span className="support-ai-name">{t('AI 助手')}</span>}
      {message.msgType === 'order' ? <a className="support-order" href={`/bizflow/orders.html?q=${encodeURIComponent(systemMessageKey(message.content))}`} target="_blank" rel="noreferrer">
        <SupportIcon name="file" /><span><small>{t('關聯訂單')}</small><strong>{message.content} ↗</strong></span></a>
        : message.content && <div className="support-message-text">{message.content}</div>}
      {!!message.attachments?.length && !message.files && <div className={message.msgType === 'image' ? 'support-image-grid' : 'support-attachments'}>
        {message.attachments.map(attachment => <Attachment key={attachment.cfid} attachment={attachment} type={message.msgType} options={options} onImage={onImage} />)}
      </div>}
      {!!message.files?.length && <div className={message.msgType === 'image' ? 'support-image-grid' : 'support-attachments'}>
        {message.files.map((file, index) => file.type.startsWith('image/')
          ? <img className="support-local-image" key={index} src={message.previewUrls[index]} alt={file.name} />
          : <div className="support-file" key={index}><SupportIcon name="file" /><span>{file.name}<small>{fileSize(file.size)}</small></span></div>)}
      </div>}
      <div className="support-message-meta"><time>{formatTime(message.createdAt, lang)}</time>
        {message.state === 'sending' ? <><span className="support-spinner" />{t('傳送中')}</> : staff && message.state !== 'failed' ? <SupportIcon name="check" size={13} /> : null}</div>
    </div>
    {staff && <div className="support-staff-caption">{staffName(message.senderName, employees)}</div>}
    {message.state === 'failed' && <button className="support-retry" onClick={() => onRetry(message)}>{t('傳送失敗，點擊重試')}</button>}
  </div>;
}
