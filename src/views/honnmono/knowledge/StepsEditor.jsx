import React from 'react';
import { useT } from '../../../i18n.jsx';

export default function StepsEditor({ steps, onChange, required }) {
  const { t } = useT();
  const move = (index, offset) => { const next = [...steps]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange(next); };
  const set = (index, key, value) => onChange(steps.map((step, at) => at === index ? { ...step, [key]: value } : step));
  return <div className="knowledge-steps">
    <h3>{t('步驟')}{required ? ' *' : ''}</h3>
    {steps.map((step, index) => <fieldset key={index}>
      <legend>{t('步驟 {count}', { count: index + 1 })}</legend>
      <label className="promo-field"><span>{t('步驟標題')}{required ? ' *' : ''}</span><input maxLength={120} value={step.title}
        onChange={event => set(index, 'title', event.target.value)}/></label>
      <label className="promo-field"><span>{t('步驟內容')}{required ? ' *' : ''}</span><textarea rows="3" maxLength={2000} value={step.text}
        onChange={event => set(index, 'text', event.target.value)}/></label>
      <div className="knowledge-step-actions">
        <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>{t('上移')}</button>
        <button type="button" disabled={index === steps.length - 1} onClick={() => move(index, 1)}>{t('下移')}</button>
        <button type="button" onClick={() => onChange(steps.filter((_, at) => at !== index))}>{t('刪除步驟')}</button>
      </div>
    </fieldset>)}
    <button type="button" disabled={steps.length >= 30} onClick={() => onChange([...steps, { title: '', text: '' }])}>{t('新增步驟')}</button>
  </div>;
}
