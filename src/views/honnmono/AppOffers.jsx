import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../i18n.jsx';
import { formatFeedbackTime } from '../../lib/honnmonoAdmin.js';
import { getCoupon, getOffer, listCoupons, listOffers } from '../../lib/promoApi.js';
import CouponDetail from './offers/CouponDetail.jsx';
import OfferEditor from './offers/OfferEditor.jsx';
import './northbound/northbound.css';
import './offers/offers.css';

const PAGE_SIZE = 30;
const OFFER_STATUS = { draft: '草稿', published: '上架中', ended: '已結束' };
const COUPON_STATUS = { available: '可使用', used: '已使用', expired: '已過期' };

function Workspace({ session }) {
  const { t, lang } = useT();
  const options = useMemo(() => ({ accessToken: session.access_token }), [session.access_token]);
  const [type, setType] = useState('offers');
  const [status, setStatus] = useState('');
  const [offerFilter, setOfferFilter] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [newOffer, setNewOffer] = useState(false);
  const list = useQuery({ queryKey: ['appOffers', session.user.email, type, status, offerFilter, q, page],
    queryFn: ({ signal }) => type === 'offers'
      ? listOffers({ status, q, page, size: PAGE_SIZE }, { ...options, signal })
      : listCoupons({ status, offerId: offerFilter, q, page, size: PAGE_SIZE }, { ...options, signal }),
    refetchInterval: 10000, staleTime: 0 });
  const detail = useQuery({ queryKey: ['appOffers', session.user.email, type, selectedId],
    queryFn: ({ signal }) => type === 'offers' ? getOffer(selectedId, { ...options, signal }) :
      getCoupon(selectedId, { ...options, signal }),
    enabled: selectedId != null && !newOffer, refetchInterval: 10000, staleTime: 0 });
  const allOffers = useQuery({ queryKey: ['appOffers', session.user.email, 'offerChoices'],
    queryFn: ({ signal }) => listOffers({ page: 1, size: 100 }, { ...options, signal }),
    staleTime: 10000 });
  const rows = list.data?.items || [];
  const total = list.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const categories = [...new Set((allOffers.data?.items || []).map(row => row.category).filter(Boolean))];
  const changeType = next => { setType(next); setStatus(''); setQ(''); setSearchDraft('');
    setPage(1); setSelectedId(null); setNewOffer(false); };
  const reload = async result => { if (result?.id) { setSelectedId(result.id); setNewOffer(false); }
    await Promise.all([list.refetch(), detail.refetch(), allOffers.refetch()]); };
  return <div className="nb-workspace promo-workspace">
    <aside className="nb-sidebar">
      <header><span className="nb-eyebrow">Honnmono APP</span><h1>{t('APP 優惠')}</h1>
        <p>{t('管理優惠及使用者優惠券')}</p></header>
      <nav className="nb-filters promo-tabs" aria-label={t('優惠類型')}>
        <button type="button" aria-selected={type === 'offers'} onClick={() => changeType('offers')}>{t('優惠')}</button>
        <button type="button" aria-selected={type === 'coupons'} onClick={() => changeType('coupons')}>{t('優惠券')}</button>
      </nav>
      {type === 'offers' && <button className="promo-new" type="button" onClick={() => {
        setNewOffer(true); setSelectedId(null); }}>{t('新增優惠')}</button>}
      <label className="promo-filter"><span>{t('狀態篩選')}</span><select value={status} onChange={event => {
        setStatus(event.target.value); setPage(1); }}>
        <option value="">{t('全部')}</option>
        {Object.entries(type === 'offers' ? OFFER_STATUS : COUPON_STATUS).map(([value, label]) =>
          <option key={value} value={value}>{t(label)}</option>)}
      </select></label>
      {type === 'coupons' && <label className="promo-filter"><span>{t('優惠篩選')}</span>
        <select value={offerFilter} onChange={event => { setOfferFilter(event.target.value); setPage(1); }}>
          <option value="">{t('全部優惠')}</option>
          {(allOffers.data?.items || []).map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
        </select></label>}
      <form className="nb-search" onSubmit={event => { event.preventDefault(); setQ(searchDraft.trim()); setPage(1); }}>
        <input value={searchDraft} onChange={event => setSearchDraft(event.target.value)}
          aria-label={t(type === 'offers' ? '搜尋優惠或類別' : '搜尋券號或使用者')}
          placeholder={t(type === 'offers' ? '搜尋優惠或類別' : '搜尋券號或使用者')}/>
        <button type="submit">{t('搜尋')}</button>
      </form>
      <div className="nb-list">
        {list.isPending ? <p className="nb-muted">{t('載入優惠資料…')}</p> :
          list.isError ? <div role="alert" className="nb-error">{t('載入失敗，請重試')}
            <button type="button" onClick={() => list.refetch()}>{t('重試')}</button></div> :
            rows.length === 0 ? <p className="nb-muted">{t('沒有符合條件的紀錄')}</p> : rows.map(row =>
              <button key={row.id} type="button" className={selectedId === row.id ? 'nb-case is-selected' : 'nb-case'}
                onClick={() => { setSelectedId(row.id); setNewOffer(false); }}>
                <span><strong>{type === 'offers' ? row.title : row.code}</strong></span>
                <span className="nb-case-name">{type === 'offers' ? row.category :
                  `${row.user?.nickname || row.user?.email || '—'} · ${row.offerTitle}`}</span>
                <span className="nb-case-meta">{t(type === 'offers' ? OFFER_STATUS[row.status] || row.status :
                  COUPON_STATUS[row.status] || row.status)}</span>
                {type === 'offers' ? <small>{t('已領 {claimed}／{total}', { claimed: row.claimedCount,
                  total: row.totalQuota == null ? '∞' : row.totalQuota })}</small> :
                  <time>{formatFeedbackTime(row.validUntil, lang)}</time>}
              </button>)}
      </div>
      <footer className="nb-page-controls"><span>{t('共 {count} 宗', { count: total })}</span>
        <button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{t('上一頁')}</button>
        <span>{page}/{pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>{t('下一頁')}</button>
      </footer>
    </aside>
    <main className="nb-main">
      {newOffer ? <OfferEditor options={options} categories={categories} onSaved={reload}/> :
        selectedId == null ? <div className="nb-welcome"><h2>{t('選擇紀錄')}</h2>
          <p>{t('從左側選擇優惠或優惠券。')}</p></div> :
          detail.isPending ? <p className="nb-loading">{t('載入優惠資料…')}</p> :
            detail.isError ? <div role="alert" className="nb-error">{t('載入失敗，請重試')}
              <button type="button" onClick={() => detail.refetch()}>{t('重試')}</button></div> :
              type === 'offers' ? <OfferEditor key={selectedId} record={detail.data} options={options}
                categories={categories} onSaved={reload}/> :
                <CouponDetail key={selectedId} record={detail.data} options={options} onChanged={reload}/>}
    </main>
  </div>;
}

export default function AppOffers({ session, embedded = false }) {
  const { t } = useT();
  if (!session?.access_token || !session?.user?.email) return <div role="alert">{t('未登入或沒有主站權限')}</div>;
  return <div className={embedded ? 'nb-container nb-embedded' : 'nb-container'}>
    <Workspace key={session.user.id || session.user.email} session={session}/>
  </div>;
}
