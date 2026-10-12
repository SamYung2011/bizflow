import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';

const sourceKeys = ['sourceName', 'sourceDesc', 'scope'];
export default function MultiLangFields({ fields, value, onChange, children, onCopyLanguage }) {
  const { t } = useT();
  const [language, setLanguage] = useState('zh-Hant');
  const copy = () => {
    const next = { ...value };
    for (const field of fields) next[field.key] = { ...value[field.key], [language]: value[field.key]?.['zh-Hant'] || '' };
    onChange(next);
    onCopyLanguage?.(language);
  };
  const renderFields = (items, extraClass = '') => <div className={`promo-fields ${extraClass}`}>
    {items.map(field => <label key={field.key} className={`promo-field ${field.multiline ? 'promo-span' : ''}`}>
      <span>{t(field.label)}{language === 'zh-Hant' && field.required ? ' *' : ''}</span>
      {field.multiline ? <textarea rows={field.key === 'body' ? 10 : 3} maxLength={field.max}
        value={value[field.key]?.[language] || ''} onChange={event => onChange({ ...value,
          [field.key]: { ...value[field.key], [language]: event.target.value } })}/>
        : <input maxLength={field.max} value={value[field.key]?.[language] || ''}
          onChange={event => onChange({ ...value, [field.key]: { ...value[field.key], [language]: event.target.value } })}/>}
    </label>)}
  </div>;
  return <div className="knowledge-languages">
    <div role="tablist" aria-label={t('內容語言')} className="knowledge-language-tabs">
      {[['zh-Hant', '繁體'], ['zh-Hans', '簡體'], ['en', 'English']].map(([key, label]) =>
        <button key={key} type="button" role="tab" aria-selected={language === key}
          onClick={() => setLanguage(key)}>{t(label)}</button>)}
    </div>
    {language !== 'zh-Hant' && <div className="knowledge-fallback">
      <p>{t('留空時 App 自動顯示繁體（簡體會自動轉換）')}</p>
      <button type="button" onClick={copy}>{t('複製繁體內容')}</button>
    </div>}
    {renderFields(fields.filter(field => !sourceKeys.includes(field.key)))}
    {children?.(language)}
    {renderFields(fields.filter(field => sourceKeys.includes(field.key)), 'knowledge-source-fields')}
  </div>;
}
