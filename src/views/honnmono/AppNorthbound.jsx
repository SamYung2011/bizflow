import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../i18n.jsx';
import { formatFeedbackTime } from '../../lib/honnmonoAdmin.js';
import { getCase, listCases } from '../../lib/northboundApi.js';
import CaseDetail from './northbound/CaseDetail.jsx';
import { STAGE_LABELS, TYPE_LABELS } from './northbound/labels.js';
import './northbound/northbound.css';

const PAGE_SIZE = 30;
const FILTERS = [['open', '進行中'], ['done', '已完成'], ['all', '全部']];

function Workspace({ session }) {
  const { t, lang } = useT();
  const options = useMemo(() => ({ accessToken: session.access_token }), [session.access_token]);
  const [status, setStatus] = useState('open');
  const [searchDraft, setSearchDraft] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const list = useQuery({
    queryKey: ['appNorthbound', session.user.email, 'list', status, q, page],
    queryFn: ({ signal }) => listCases({ status, q, page, size: PAGE_SIZE }, { ...options, signal }),
    refetchInterval: 10000, staleTime: 0,
  });
  const detail = useQuery({
    queryKey: ['appNorthbound', session.user.email, 'detail', selectedId],
    queryFn: ({ signal }) => getCase(selectedId, { ...options, signal }),
    enabled: !!selectedId, refetchInterval: 10000, staleTime: 0,
  });
  const rows = (list.data?.items || []).filter(row => row.submittedAt != null);
  const total = list.data?.total || 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  async function reload() { await Promise.all([list.refetch(), detail.refetch()]); }
  return <div className="nb-workspace">
    <aside className="nb-sidebar">
      <header><span className="nb-eyebrow">Honnmono APP</span><h1>{t('APP 北上')}</h1>
        <p>{t('跟進申請、文件及續期')}</p></header>
      <nav className="nb-filters" aria-label={t('篩選案件')}>
        {FILTERS.map(([value, label]) => <button key={value} type="button"
          aria-selected={status === value} onClick={() => { setStatus(value); setPage(1); }}>{t(label)}</button>)}
      </nav>
      <form className="nb-search" onSubmit={event => { event.preventDefault(); setQ(searchDraft.trim()); setPage(1); }}>
        <input value={searchDraft} onChange={event => setSearchDraft(event.target.value)}
          aria-label={t('搜尋案號、姓名、車牌或電郵')} placeholder={t('搜尋案號、姓名、車牌或電郵')} />
        <button type="submit">{t('搜尋')}</button>
      </form>
      <div className="nb-list">
        {list.isPending ? <p className="nb-muted">{t('載入北上案件…')}</p>
          : list.isError ? <div role="alert" className="nb-error">{t('載入失敗，請重試')}
            <button type="button" onClick={() => list.refetch()}>{t('重試')}</button></div>
            : !rows.length ? <p className="nb-muted">{t('沒有符合條件的案件')}</p>
              : rows.map(row => <button key={row.id} type="button" className={selectedId === row.id ? 'nb-case is-selected' : 'nb-case'}
                onClick={() => setSelectedId(row.id)}>
                <span><strong>{row.caseNo}</strong><small>{t(TYPE_LABELS[row.kind] || '首次申請')}</small></span>
                <span className="nb-case-name">{row.applicant?.name || row.user?.nickname || row.user?.email || '—'}</span>
                <span className="nb-case-meta">{t(STAGE_LABELS[row.status] || (row.status === 'draft' ? '草稿 · 尚未提交' : '已取消'))}
                  {row.pendingRequestCount > 0 && <em>{t('待補件')}</em>}</span>
                <time>{formatFeedbackTime(row.updatedAt, lang)}</time>
              </button>)}
      </div>
      <footer className="nb-page-controls"><span>{t('共 {count} 宗', { count: total })}</span>
        <button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{t('上一頁')}</button>
        <span>{page}/{lastPage}</span>
        <button type="button" disabled={page >= lastPage} onClick={() => setPage(value => value + 1)}>{t('下一頁')}</button>
      </footer>
    </aside>
    <main className="nb-main">
      {!selectedId ? <div className="nb-welcome"><h2>{t('選擇案件')}</h2><p>{t('從左側選擇一宗申請。')}</p></div>
        : detail.isPending ? <p className="nb-loading">{t('載入案件詳情…')}</p>
          : detail.isError ? <div role="alert" className="nb-error">{t('載入失敗，請重試')}
            <button type="button" onClick={() => detail.refetch()}>{t('重試')}</button></div>
            : <CaseDetail key={selectedId} record={detail.data} options={options} reload={reload} lang={lang} />}
    </main>
  </div>;
}

export default function AppNorthbound({ session, embedded = false }) {
  const { t } = useT();
  if (!session?.access_token || !session?.user?.email) return <div role="alert">{t('未登入或沒有主站權限')}</div>;
  return <div className={embedded ? 'nb-container nb-embedded' : 'nb-container'}>
    <Workspace key={session.user.id || session.user.email} session={session} />
  </div>;
}
