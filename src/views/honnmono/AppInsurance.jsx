import { useAppEmbedVisible } from '../../lib/appEmbedVisibility.js';
import React, { useMemo, useState } from 'react';
import AssistUserSearch from './northbound/AssistUserSearch.jsx';
import CustomerDrawer from './support/CustomerDrawer.jsx';
import './support/support.css';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../i18n.jsx';
import { formatFeedbackTime } from '../../lib/honnmonoAdmin.js';
import { getClaim, getEnquiry, getPolicy, listItems } from '../../lib/insuranceApi.js';
import ClaimDetail from './insurance/ClaimDetail.jsx';
import EnquiryDetail from './insurance/EnquiryDetail.jsx';
import PolicyDetail from './insurance/PolicyDetail.jsx';
import { CLAIM_STATUS, ENQUIRY_STATUS, POLICY_STATUS, TYPES, labelFor } from './insurance/labels.js';
import './northbound/northbound.css';
import './insurance/insurance.css';

const PAGE_SIZE = 30;
const statusByType = { policy: POLICY_STATUS, claim: CLAIM_STATUS, enquiry: ENQUIRY_STATUS };
const details = { policy: getPolicy, claim: getClaim, enquiry: getEnquiry };
const views = { policy: PolicyDetail, claim: ClaimDetail, enquiry: EnquiryDetail };

function Workspace({ session }) {
  const visible = useAppEmbedVisible();
  const { t, lang } = useT();
  const options = useMemo(() => ({ accessToken: session.access_token, operatorEmail: session.user.email }), [session.access_token, session.user.email]);
  const [type, setType] = useState('policy');
  const [status, setStatus] = useState('');
  const [profileUserId, setProfileUserId] = useState(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const list = useQuery({
    queryKey: ['appInsurance', session.user.email, 'list', type, status, q, page],
    queryFn: ({ signal }) => listItems({ type, status, q, page, size: PAGE_SIZE }, { ...options, signal }),
    refetchInterval: 10000, staleTime: 0, enabled: visible,
  });
  const detail = useQuery({
    queryKey: ['appInsurance', session.user.email, 'detail', type, selectedId],
    queryFn: ({ signal }) => details[type](selectedId, { ...options, signal }),
    enabled: visible && selectedId != null, refetchInterval: 10000, staleTime: 0,
  });
  const rows = list.data?.items || [];
  const total = list.data?.total || 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const Detail = views[type];
  const reload = async () => { await Promise.all([list.refetch(), detail.refetch()]); };
  return <div className="nb-workspace ins-workspace">
    <aside className="nb-sidebar">
      <header><span className="nb-eyebrow">Honnmono APP</span><h1>{t('APP 車保')}</h1>
        <p>{t('核對保單、跟進出險及報價')}</p></header>
      <nav className="nb-filters ins-type-tabs" aria-label={t('車保類型')}>
        {TYPES.map(([value, label]) => <button type="button" key={value} aria-selected={type === value}
          onClick={() => { setType(value); setStatus(''); setPage(1); setSelectedId(null); }}>{t(label)}</button>)}
      </nav>
      <label className="ins-status-filter">{t('狀態篩選')}<select value={status}
        onChange={event => { setStatus(event.target.value); setPage(1); }}>
        <option value="">{t('全部')}</option>
        {Object.entries(statusByType[type]).filter(([code]) => code !== 'draft').map(([code, label]) =>
          <option key={code} value={code}>{t(label)}</option>)}
      </select></label>
      <AssistUserSearch compact options={options} value={q} onSearch={value => { setQ(value); setPage(1); }}
        onSelect={user => setProfileUserId(user.id)} placeholder="搜尋姓名、電郵、電話、編號、車牌或備註" />
      <div className="nb-list">
        {list.isPending ? <p className="nb-muted">{t('載入車保資料…')}</p>
          : list.isError ? <div role="alert" className="nb-error">{t('載入失敗，請重試')}
            <button type="button" onClick={() => list.refetch()}>{t('重試')}</button></div>
            : !rows.length ? <p className="nb-muted">{t('沒有符合條件的紀錄')}</p>
              : rows.map(row => <button key={row.id} type="button"
                className={selectedId === row.id ? 'nb-case is-selected' : 'nb-case'}
                onClick={() => setSelectedId(row.id)}>
                <span><strong>{row.number || (row.region === 'hk' ? t('香港保單') : t('內地保單')) + ` #${row.id}`}</strong></span>
                <span className="nb-case-name">{[row.user?.nickname || row.user?.email || '—', row.plateNo || row.carLabel].filter(Boolean).join(' · ')}</span>
                <span className="nb-case-meta">{t(labelFor(type, row.status))}</span>
                <time>{formatFeedbackTime(row.lastActionAt, lang)}</time>
              </button>)}
      </div>
      <footer className="nb-page-controls"><span>{t('共 {count} 宗', { count: total })}</span>
        <button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{t('上一頁')}</button>
        <span>{page}/{lastPage}</span>
        <button type="button" disabled={page >= lastPage} onClick={() => setPage(value => value + 1)}>{t('下一頁')}</button>
      </footer>
    </aside>
    <main className="nb-main">
      {!detail.isError && detail.data?.user?.id && <button className="support-button customer-profile-launch" type="button"
        onClick={() => setProfileUserId(detail.data.user.id)}>{t('客戶檔案及備註')}</button>}
      {selectedId == null ? <div className="nb-welcome"><h2>{t('選擇紀錄')}</h2>
        <p>{t('從左側選擇一筆車保資料。')}</p></div>
        : detail.isPending ? <p className="nb-loading">{t('載入車保詳情…')}</p>
          : detail.isError ? <div role="alert" className="nb-error">{t('載入失敗，請重試')}
            <button type="button" onClick={() => detail.refetch()}>{t('重試')}</button></div>
            : <Detail key={`${type}-${selectedId}`} record={detail.data} options={options} reload={reload} lang={lang}/>}
    </main>
    {profileUserId && <CustomerDrawer key={profileUserId} userId={profileUserId} options={options} employees={[]}
      onClose={() => setProfileUserId(null)} />}
  </div>;
}

export default function AppInsurance({ session, embedded = false }) {
  const { t } = useT();
  if (!session?.access_token || !session?.user?.email) return <div role="alert">{t('未登入或沒有主站權限')}</div>;
  return <div className={embedded ? 'nb-container nb-embedded' : 'nb-container'}>
    <Workspace key={session.user.id || session.user.email} session={session}/>
  </div>;
}
