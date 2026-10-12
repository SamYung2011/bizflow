import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { sourceFields } from './form.js';
import StepsEditor from './StepsEditor.jsx';

const sourceKeys = sourceFields.map(field => field.key);
export default function MultiLangFields({ fields, value, onChange }) {
  const { t } = useT();
  const [language, setLanguage] = useState('zh-Hant');
  const copy = () => {
    const next = { ...value };
    for (const field of fields) next[field.key] = { ...value[field.key],
      [language]: structuredClone(value[field.key]?.['zh-Hant'] || (field.kind === 'steps' ? [] : '')) };
    onChange(next);
  };
  const update = (key, next) => onChange({ ...value, [key]: { ...value[key], [language]: next } });
  const renderFields = (items, extraClass = '') => <div className={`promo-fields ${extraClass}`}>
    {items.map(field => field.kind === 'steps' ? <div className="promo-span" key={field.key}>
      <StepsEditor steps={value[field.key]?.[language] || []} required={language === 'zh-Hant' && !!field.required}
        onChange={steps => update(field.key, steps)}/>
    </div> : <label key={field.key} className={`promo-field ${field.multiline ? 'promo-span' : ''}`}>
      <span>{t(field.label)}{language === 'zh-Hant' && field.required ? ' *' : ''}</span>
      {field.multiline ? <textarea rows={field.rows || 3} maxLength={field.max}
        value={value[field.key]?.[language] || ''} onChange={event => update(field.key, event.target.value)}/>
        : <input maxLength={field.max} value={value[field.key]?.[language] || ''}
          onChange={event => update(field.key, event.target.value)}/>}
    </label>)}
  </div>;
  return <div className="knowledge-languages">
    <div role="tablist" aria-label={t('內容語言')} className="knowledge-language-tabs">
      {[['zh-Hant', '繁體'], ['zh-Hans', '簡體'], ['en', 'English']].map(([key, label]) =>
        <button key={key} type="button" role="tab" aria-selected={language === key}
          onClick={() => setLanguage(key)}>{t(label)}</button>)}
    </div>
    {language !== 'zh-Hant' && <div className="knowledge-fallback">
      <p>{t(language === 'zh-Hans' ? '留空時 App 自動由繁體轉成簡體' : '留空時 App 自動顯示繁體（簡體會自動轉換）')}</p>
      {language === 'en' && <button type="button" onClick={copy}>{t('複製繁體內容')}</button>}
    </div>}
    {renderFields(fields.filter(field => !sourceKeys.includes(field.key)))}
    {renderFields(fields.filter(field => sourceKeys.includes(field.key)), 'knowledge-source-fields')}
  </div>;
}
