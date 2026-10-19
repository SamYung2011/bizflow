import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../i18n.jsx';
import { useAppEmbedVisible } from '../../../lib/appEmbedVisibility.js';
import { getUserProfile } from '../../../lib/supportApi.js';
import { formatFeedbackTime } from '../../../lib/honnmonoAdmin.js';
import CustomerHistory from './CustomerHistory.jsx';
import { STAGE_LABELS } from '../northbound/labels.js';
import { CLAIM_STATUS, ENQUIRY_STATUS, POLICY_STATUS } from '../insurance/labels.js';

const Line = ({ label, value }) => <div className="customer-line"><dt>{label}</dt><dd>{value || '—'}</dd></div>;
const Section = ({ title, children }) => <section className="customer-section"><h3>{title}</h3>{children}</section>;

export default function CustomerDrawer({ userId, options, employees, onClose, onSelect }) {
  const { t, lang } = useT(), visible = useAppEmbedVisible();
  const dialog = useRef(null);
  const query = useQuery({ queryKey: ['support', options.operatorEmail, 'profile', userId],
    queryFn: ({ signal }) => getUserProfile(userId, { ...options, signal }), enabled: visible && !!userId, gcTime: 0 });
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => previous?.isConnected && previous.focus();
  }, []);
  function keyDown(event) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const nodes = [...dialog.current.querySelectorAll('button:not(:disabled),a[href],input,select,[tabindex="0"]')];
    const target = event.shiftKey ? nodes.at(-1) : nodes[0];
    if (!nodes.includes(document.activeElement) || document.activeElement === (event.shiftKey ? nodes[0] : nodes.at(-1))) {
      event.preventDefault(); (target || dialog.current)?.focus();
    }
  }
  const data = query.data, time = value => value ? formatFeedbackTime(value, lang) : '—';
  const policies = data ? [data.insurance.policies.hk, data.insurance.policies.cn, ...data.insurance.policies.history].filter(Boolean) : [];
  return <div className="customer-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="customer-drawer" role="dialog" aria-modal="true" aria-label={t('客戶檔案')} ref={dialog} tabIndex={-1} onKeyDown={keyDown}>
      <header><div><span>{t('客戶檔案')}</span><h2>{data?.basic.nickname || data?.basic.email || t('使用者')}</h2></div>
        <button className="support-button" onClick={onClose}>{t('關閉')}</button></header>
      <div className="customer-content">
        {query.isPending ? <p>{t('載入中…')}</p> : query.isError ? <p role="alert">{t('載入失敗，請重試')} <button onClick={() => query.refetch()}>{t('重試')}</button></p> : <>
          <Section title={t('基本資料')}><dl>
            <Line label={t('使用者編號')} value={data.basic.id} /><Line label={t('使用者電郵')} value={data.basic.email} />
            <Line label={t('電話')} value={data.basic.phone} /><Line label={t('香港電話')} value={data.basic.phoneHk} />
            <Line label={t('內地電話')} value={data.basic.phoneCn} /><Line label={t('App 版本識別')} value={data.basic.appmodel} />
            <Line label={t('註冊時間')} value={time(data.basic.registeredAt)} />
          </dl></Section>
          <Section title={t('歷史對話')}><CustomerHistory key={userId} userId={userId} recent={data.conversations}
            options={options} employees={employees} onSelect={onSelect} /></Section>
          <Section title={t('車輛')}>{data.cars.map(car => <dl key={car.id}>
            <Line label={t('車牌')} value={`${car.plate || '—'}${car.isPrimary ? ` · ${t('主車')}` : ''}`} />
            <Line label={t('品牌與車款')} value={[car.brand, car.series, car.variant, car.year].filter(Boolean).join(' · ')} />
            <Line label={t('車身號碼')} value={car.vin} /><Line label={t('驗車日期')} value={time(car.checkTime)} />
            <Line label={t('牌照到期')} value={time(car.licenseExpireTime)} /><Line label={t('國際牌照到期')} value={time(car.intlPlateExpireTime)} />
          </dl>)}{!data.cars.length && <p>{t('暫無紀錄')}</p>}</Section>
          <Section title={t('手機與 App')}><dl>{[['lastLogin', '最近登入'], ['lastMessage', '最近發訊']].map(([key, label]) => {
            const row = data.appDevices[key];
            return <Line key={key} label={t(label)} value={row ? [time(row.at), row.deviceModel,
              [row.osName, row.osVersion].filter(Boolean).join(' '), row.appVersion && `${t('App 版本')} ${row.appVersion}`].filter(Boolean).join(' · ') : '—'} />;
          })}</dl></Section>
          <Section title={t('轉插')}>{data.adapters.map((row, index) => <dl key={index}>
            <Line label={t('IMEI')} value={row.imei} /><Line label={t('設備編號')} value={row.certid} /><Line label={t('綁定時間')} value={time(row.bindtime)} />
            <Line label={t('車身號碼')} value={row.vin} /><Line label={t('韌體版本')} value={row.fwversion} /><Line label={t('車款')} value={row.carModel} />
            <Line label={t('來源')} value={t(({ self: '自家轉插', flash: '閃充', lufengzhe: '路風者' })[row.origin] || '未知')} />
            <Line label={t('最近上線')} value={time(row.lastSeenAt)} />
          </dl>)}{!data.adapters.length && <p>{t('暫無紀錄')}</p>}</Section>
          <Section title={t('保險')}>{policies.map(row => <dl key={row.id}>
            <Line label={t('保單號碼')} value={row.policyNo} /><Line label={t('保險公司')} value={row.insurer} />
            <Line label={t('狀態')} value={t(POLICY_STATUS[row.status] || '未知')} /><Line label={t('有效至')} value={row.coverEnd} />
          </dl>)}{[['currentClaim', CLAIM_STATUS], ['currentEnquiry', ENQUIRY_STATUS]].map(([key, labels]) => {
            const row = data.insurance.overview?.[key]; return row && <dl key={key}><Line label={t('案號')} value={row.claimNo || row.enquiryNo || row.id} />
              <Line label={t('狀態')} value={t(labels[row.status] || '未知')} /></dl>;
          })}{!policies.length && !data.insurance.overview?.currentClaim && !data.insurance.overview?.currentEnquiry && <p>{t('暫無紀錄')}</p>}</Section>
          <Section title={t('港車北上')}>{data.northbound.cases.map(row => <dl key={row.id}>
            <Line label={t('案號')} value={row.caseNo} /><Line label={t('狀態')} value={t(STAGE_LABELS[row.status] || (row.status === 'draft' ? '草稿 · 尚未提交' : '已取消'))} />
          </dl>)}{!data.northbound.cases.length && <p>{t('暫無紀錄')}</p>}</Section>
        </>}
      </div>
    </aside>
  </div>;
}
