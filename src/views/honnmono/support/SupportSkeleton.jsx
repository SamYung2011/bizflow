import React from 'react';
import { useT } from '../../../i18n.jsx';

export default function SupportSkeleton({ list = false }) {
  const { t } = useT();
  return <div className={`support-skeleton ${list ? 'is-list' : ''}`} role="status" aria-label={t('載入客服會話…')}>
    {Array.from({ length: list ? 6 : 5 }, (_, index) => <div key={index} className="support-skeleton-row">
      {list && <i className="support-skeleton-avatar" />}
      <div><i /><i /></div>
    </div>)}
  </div>;
}
