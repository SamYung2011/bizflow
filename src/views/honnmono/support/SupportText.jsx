import React from 'react';
import { useT } from '../../../i18n.jsx';
import { splitSupportText } from './chargeReport.js';
import './charge-report.css';

export default function SupportText({ text }) {
  const { t } = useT();
  const parts = splitSupportText(text, t);
  return <><div className="support-message-text">{parts.text}</div>{parts.details && <details className="support-technical-details">
    <summary>{t('技術資料')}</summary><div>{parts.details}</div>
  </details>}</>;
}
