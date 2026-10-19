import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../i18n.jsx';
import { useAppEmbedVisible } from '../../../lib/appEmbedVisibility.js';
import { listConversations } from '../../../lib/supportApi.js';
import { formatFeedbackTime } from '../../../lib/honnmonoAdmin.js';
import { staffName, supportCaseId } from '../../../lib/supportConfig.js';

export default function CustomerHistory({ userId, recent, options, employees, onSelect }) {
  const { t, lang } = useT(), visible = useAppEmbedVisible();
  const [expanded, setExpanded] = useState(false), [page, setPage] = useState(1);
  const list = useRef(null);
  const query = useQuery({ queryKey: ['support', options.operatorEmail, 'customer-history', userId, page],
    queryFn: ({ signal }) => listConversations({ userId, status: 'all', page, size: 20 }, { ...options, signal }),
    enabled: expanded && visible, gcTime: 0 });
  useEffect(() => { if (list.current) list.current.scrollTop = 0; }, [page, expanded]);
  const rows = expanded ? query.data || [] : recent.slice(0, 5);
  return <>
    <div ref={list} className={`customer-history-list${expanded ? ' is-expanded' : ''}`}>
      {expanded && query.isPending ? <p>{t('載入中…')}</p> : expanded && query.isError ? <p role="alert">
        {t('載入失敗，請重試')} <button onClick={() => query.refetch()}>{t('重試')}</button></p> : <>
        {rows.map(row => <button className="customer-history" key={row.id} onClick={() => onSelect(row.id)}>
          <strong>{supportCaseId(row.id)} <span>{t(row.status === 'closed' ? '已結束' : '處理中')}</span></strong>
          <span>{t(row.category || '未分類')} · {t(({ manual: '使用者發起', ai_handoff: 'AI 轉人工', feedback: '意見反饋', northbound: '港車北上', insurance: '車保', promo: '優惠' })[row.source] || '使用者發起')}</span>
          <small>{row.lastMessageAt ? formatFeedbackTime(row.lastMessageAt, lang) : '—'} · {row.assigneeEmail ? staffName(row.assigneeEmail, employees) : t('尚未認領')} · {t('未讀 {count}', { count: row.unreadCount })}</small>
        </button>)}
        {!rows.length && <p>{t('暫無紀錄')}</p>}
      </>}
    </div>
    <div className="customer-history-controls">
      {expanded && <><button disabled={page === 1 || query.isFetching} onClick={() => setPage(value => value - 1)}>{t('上一頁')}</button>
        <span>{page}</span><button disabled={query.isFetching || query.isError || rows.length < 20} onClick={() => setPage(value => value + 1)}>{t('下一頁')}</button></>}
      {!!recent.length && <button aria-expanded={expanded} onClick={() => { setExpanded(value => !value); setPage(1); }}>{t(expanded ? '收起' : '展開')}</button>}
    </div>
  </>;
}
