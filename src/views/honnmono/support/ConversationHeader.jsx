import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { SUPPORT_CATEGORIES, conversationState, staffName } from '../../../lib/supportConfig.js';
import SupportIcon from './SupportIcon.jsx';

export default function ConversationHeader({ conversation, employees, onChange, onBack }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const state = conversationState(conversation);
  async function change(value) {
    setBusy(true); setError(false);
    try { await onChange(value); } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <header className="support-header">
    <div className="support-header-main">
      <button className="support-icon-button support-back" aria-label={t('返回會話列表')} onClick={onBack}><SupportIcon name="back" /></button>
      <span className={`support-avatar tone-${conversation.id % 5}`}>{conversation.userNickname?.slice(0, 1).toUpperCase()}</span>
      <div className="support-contact"><div><h2>{conversation.userNickname}</h2><span className={`support-status ${state}`}>
        <i />{t(state === 'closed' ? '已結束' : state === 'waiting' ? '待回覆' : '處理中')}</span></div>
        <p>{conversation.userPhone || '—'}<span> · </span>{conversation.userEmail || '—'}</p></div>
      <div className="support-header-actions">
        {conversation.status !== 'closed' && <button className="support-button" disabled={busy} onClick={() => change('close')}>
          <SupportIcon name="check" size={16} />{t('結束會話')}</button>}
      </div>
    </div>
    <div className="support-header-details"><label>{t('問題類型')}
      <select value={conversation.category || ''} disabled={busy} aria-label={t('問題類型')}
        onChange={event => change({ category: event.target.value })}>
        <option value="">{t('未分類')}</option>
        {!SUPPORT_CATEGORIES.includes(conversation.category) && conversation.category && <option>{conversation.category}</option>}
        {SUPPORT_CATEGORIES.map(category => <option key={category} value={category}>{t(category)}</option>)}
      </select></label><span>{conversation.assigneeEmail
        ? t('負責人：{name}', { name: staffName(conversation.assigneeEmail, employees) }) : t('尚未認領')}</span>
      <span className="support-source-label">{t(conversation.source === 'ai_handoff' ? 'AI 轉人工' : '使用者發起')}</span>
    </div>
    {conversation.summary && <details className="support-summary" open><summary><span>{t('個案摘要')}</span><span>{t('AI 已整理')}</span></summary><p>{conversation.summary}</p></details>}
    {error && <div className="support-error" role="alert">{t('操作失敗，請重試')}</div>}
  </header>;
}
