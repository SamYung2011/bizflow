import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../i18n.jsx';
import { useAppEmbedVisible } from '../../../lib/appEmbedVisibility.js';
import { searchUsers } from '../../../lib/supportApi.js';

export default function AssistUserSearch({ options, onSelect, selectedId, disabled }) {
  const { t } = useT(), visible = useAppEmbedVisible();
  const [input, setInput] = useState(''), [q, setQ] = useState(''), [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ['northboundAssist', options.operatorEmail, 'users', q, page],
    queryFn: ({ signal }) => searchUsers({ q, page, size: 10 }, { ...options, signal }), enabled: visible && !!q });
  return <section className="nb-card">
    <h3>{t('搜尋使用者')}</h3>
    <form className="assist-search" onSubmit={event => { event.preventDefault(); setQ(input.trim()); setPage(1); }}>
      <input aria-label={t('搜尋暱稱、電郵、電話或使用者編號')} placeholder={t('搜尋暱稱、電郵、電話或使用者編號')}
        value={input} onChange={event => setInput(event.target.value)} />
      <button type="submit" disabled={!input.trim() || disabled}>{t('搜尋')}</button>
    </form>
    {q && (query.isPending ? <p>{t('載入中…')}</p> : query.isError ? <p role="alert">{t('載入失敗，請重試')} <button onClick={() => query.refetch()}>{t('重試')}</button></p>
      : <><div className="assist-users">{query.data.items.map(user => <button type="button" key={user.id}
        className={selectedId === user.id ? 'is-selected' : ''} disabled={disabled} onClick={() => onSelect(user)}>
        <strong>{user.nickname || user.email}</strong><span>{user.email}</span><span>{[user.phoneHk, user.phoneCn, user.phone].filter(Boolean).join(' · ')}</span>
        <small>{user.appmodel} · #{user.id}</small>
      </button>)}</div>{!query.data.items.length && <p>{t('找不到使用者')}</p>}
      {query.data.total > 10 && <nav className="nb-page-controls"><button disabled={page===1 || disabled} onClick={() => setPage(page-1)}>{t('上一頁')}</button>
        <span>{page}/{Math.ceil(query.data.total/10)}</span><button disabled={page*10>=query.data.total || disabled} onClick={() => setPage(page+1)}>{t('下一頁')}</button></nav>}</>)}
  </section>;
}
