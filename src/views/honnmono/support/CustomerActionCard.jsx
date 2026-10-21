import React from 'react';
import { useT } from '../../../i18n.jsx';
import './charge-report.css';

const KINDS = { northbound: '港車北上申請', claim: '出險個案', enquiry: '車保報價資料', policy: '保單' };
const ACTIONS = { submitted: '已提交', supplemented: '已補交資料', updated: '已更新', cancelled: '已取消', uploaded: '已上傳' };

export function isCustomerAction(message) {
  const card = message.supportAction;
  return message.msgType === 'customer_action' && message.senderRole === 'user'
    && card?.version === 1 && Object.hasOwn(KINDS, card.kind) && Object.hasOwn(ACTIONS, card.action)
    && typeof card.reference === 'string' && Number.isFinite(card.occurredAt) && Number.isFinite(new Date(card.occurredAt).getTime());
}

export default function CustomerActionCard({ action }) {
  const { t, lang } = useT();
  return <section className="support-charge-report support-customer-action" aria-label={t('客戶操作')}>
    <span className="support-operation-label">{t('客戶操作')}</span>
    <h3>{t(KINDS[action.kind])} · {t(ACTIONS[action.action])}</h3>
    <dl><div><dt>{t('業務編號')}</dt><dd>{action.reference}</dd></div>
      <div><dt>{t('操作時間')}</dt><dd>{new Intl.DateTimeFormat(lang === 'zh' ? 'zh-HK' : lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Hong_Kong' }).format(action.occurredAt)}</dd></div></dl>
    {Array.isArray(action.staffAdvice) && action.staffAdvice.length > 0 && <div className="support-charge-advice">
      <h4>{t('客服處理建議')}</h4><ul>{action.staffAdvice.filter(item => typeof item === 'string').map((item, index) => <li key={index}>{t(item)}</li>)}</ul>
    </div>}
  </section>;
}
