import React from 'react';
import { useT } from '../../../i18n.jsx';
import { SUPPORT_CATEGORIES, conversationState } from '../../../lib/supportConfig.js';
import SupportIcon from './SupportIcon.jsx';
import SupportSkeleton from './SupportSkeleton.jsx';
import { formatTime } from './format.js';

export default function ConversationList({ query, selectedId, onSelect, filters, setFilters }) {
  const { t, lang } = useT();
  const rows = (query.data?.pages.flat() || []).filter(item =>
    (filters.state !== 'active' || conversationState(item) === 'active')
    && (!filters.category || item.category === filters.category));
  return <aside className="support-list" aria-label={t('客服會話')}>
    <div className="support-list-heading"><div className="support-brand-icon"><SupportIcon name="chat" size={23} /></div>
      <div><h1>{t('APP 客服')}</h1><span>{t('Honnmono 使用者服務')}</span></div>
    </div>
    <div className="support-search"><SupportIcon name="search" size={18} />
      <input aria-label={t('搜尋暱稱或手機')} placeholder={t('搜尋暱稱或手機')} value={filters.search}
        onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} />
    </div>
    <div className="support-tabs" role="tablist" aria-label={t('會話狀態')}>
      {[['waiting', '待回覆'], ['active', '處理中'], ['closed', '已結束']].map(([value, label]) =>
        <button type="button" key={value} role="tab" aria-selected={filters.state === value}
          onClick={() => setFilters(current => ({ ...current, state: value }))}>{t(label)}</button>)}
    </div>
    <div className="support-list-filter"><select value={filters.category} aria-label={t('按類型篩選')}
      onChange={event => setFilters(current => ({ ...current, category: event.target.value }))}>
      <option value="">{t('全部類型')}</option>{SUPPORT_CATEGORIES.map(category => <option key={category} value={category}>{t(category)}</option>)}
    </select><span>{t('{count} 條會話', { count: rows.length })}</span></div>
    <div className="support-list-scroll">
      {query.isPending ? <SupportSkeleton list /> : rows.map(item => <button type="button" className={`support-conversation ${selectedId === item.id ? 'is-selected' : ''}`}
        key={item.id} onClick={() => onSelect(item.id)} aria-current={selectedId === item.id ? 'true' : undefined}>
        <span className={`support-avatar tone-${item.id % 5}`}>{item.userNickname?.slice(0, 1).toUpperCase()}</span>
        <span className="support-conversation-copy"><span className="support-conversation-title"><strong>{item.userNickname}</strong>
          {item.category && <span className="support-category">{t(item.category)}</span>}</span>
          <span className="support-preview">{item.lastMessagePreview === '[attachment]' ? t('附件') : item.lastSenderRole === 'system' ? t(item.lastMessagePreview) : item.lastMessagePreview}</span>
          <span className="support-conversation-source">{t(item.source === 'ai_handoff' ? 'AI 轉人工' : '使用者發起')}
            {item.assigneeEmail && <span> · {t('已認領')}</span>}</span>
        </span>
        <span className="support-conversation-meta"><time>{formatTime(item.lastMessageAt, lang)}</time>
          {item.unreadCount > 0 && <span className="support-unread" aria-label={t('{count} 條未讀', { count: item.unreadCount })}>{item.unreadCount}</span>}</span>
      </button>)}
      {query.isError && <div className="support-error" role="alert">{t('載入失敗，請重試')} <button onClick={() => query.refetch()}>{t('重試')}</button></div>}
      {!query.isPending && !query.isError && !rows.length && <div className="support-empty-list">{t('沒有符合條件的會話')}</div>}
      {query.hasNextPage && <button className="support-load-more" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>{t('載入更多會話')}</button>}
    </div>
    <div className="support-list-footer"><span className="support-online-dot" />{t('訊息自動更新')}</div>
  </aside>;
}
