import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../i18n.jsx';
import { useAppEmbedVisible } from '../../../lib/appEmbedVisibility.js';
import { searchUsers } from '../../../lib/supportApi.js';
import './assist.css';

// The same account search serves support, northbound, insurance and assisted filing.
export default function AssistUserSearch({ options, onSelect, selectedId, disabled = false,
  value, onSearch, compact = false, placeholder = '搜尋姓名、電郵、電話、編號或備註' }) {
  const { t } = useT(), visible = useAppEmbedVisible();
  const [input, setInput] = useState(value || ''), [localQ, setLocalQ] = useState(''), [page, setPage] = useState(1);
  const q = value === undefined ? localQ : value;
  useEffect(() => { if (value !== undefined) setInput(value); setPage(1); }, [value]);
  const query = useQuery({ queryKey: ['appUsers', options.operatorEmail, q, page],
    queryFn: ({ signal }) => searchUsers({ q, page, size: 10 }, { ...options, signal }),
    enabled: visible && !disabled && q.trim().length >= 2, gcTime: 0 });
  function search(event) {
    event.preventDefault(); const next = input.trim();
    if (!onSearch && next && next.length < 2) return;
    setPage(1); setLocalQ(next); onSearch?.(next);
  }
  return <section className={`nb-card app-user-search${compact ? ' is-compact' : ''}`}>
    {!compact && <h3>{t('搜尋使用者')}</h3>}
    <form className="assist-search" onSubmit={search}>
      <input aria-label={t(placeholder)} placeholder={t(placeholder)} maxLength={120}
        disabled={disabled} value={input} onChange={event => setInput(event.target.value)} />
      <button type="submit" disabled={disabled || (!onSearch && !!input.trim() && input.trim().length < 2)}>{t('搜尋')}</button>
      {q && <button type="button" disabled={disabled} onClick={() => { setInput(''); setLocalQ(''); setPage(1); onSearch?.(''); }}>{t('清除')}</button>}
    </form>
    {!onSearch && input.trim().length === 1 && <small>{t('請輸入至少兩個字元')}</small>}
    {q.trim().length >= 2 && <div className="app-user-results">
      <h3>{t('APP 使用者')}</h3>
      {query.isPending ? <p>{t('載入中…')}</p> : query.isError ? <p role="alert">{t('載入失敗，請重試')} <button type="button" onClick={() => query.refetch()}>{t('重試')}</button></p>
        : <><div className="assist-users">{(query.data?.items || []).map(user => <button type="button" key={user.id}
          className={selectedId === user.id ? 'is-selected' : ''} disabled={disabled} onClick={() => onSelect(user)}>
          <strong>{user.nickname || user.email}</strong><span>{user.email}</span><span>{[user.phoneHk, user.phoneCn, user.phone].filter(Boolean).join(' · ')}</span>
          <small>{user.appmodel} · #{user.id}</small>{user.staffNote?.text && <small className="app-user-note">{user.staffNote.text}</small>}
        </button>)}</div>{!query.data?.items.length && <p>{t('找不到使用者')}</p>}
        {query.data?.total > 10 && <nav className="nb-page-controls"><button type="button" disabled={page===1 || disabled} onClick={() => setPage(page-1)}>{t('上一頁')}</button>
          <span>{page}/{Math.ceil(query.data.total/10)}</span><button type="button" disabled={page*10>=query.data.total || disabled} onClick={() => setPage(page+1)}>{t('下一頁')}</button></nav>}</>}
    </div>}
  </section>;
}
