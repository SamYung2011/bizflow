import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../i18n.jsx';
import { useAppEmbedVisible } from '../../lib/appEmbedVisibility.js';
import { formatFeedbackTime } from '../../lib/honnmonoAdmin.js';
import { getProvider, saveProvider, resetProvider } from '../../api/assistantProviderApi.js';
import { usePromptLeave } from './usePromptLeave.js';

const draftFor = record => ({ baseUrl: record.custom.baseUrl ? record.baseUrl : '', model: record.custom.model ? record.model : '', apiKey: '' });

export function ProviderEditor({ record, options, onSaved }) {
  const { t, lang } = useT();
  const [draft, setDraft] = useState(() => draftFor(record));
  const [keyEdited, setKeyEdited] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const baseline = draftFor(record);
  const dirty = draft.baseUrl !== baseline.baseUrl || draft.model !== baseline.model || keyEdited;
  const hasSettings = Boolean(record.updatedAt);
  const discard = () => { setDraft(draftFor(record)); setKeyEdited(false); };
  usePromptLeave(dirty, busy, discard);
  const change = (field, value) => {
    setDraft(previous => ({ ...previous, [field]: value })); setSaved(false);
    if (field === 'apiKey') setKeyEdited(true);
  };
  const submit = async reset => {
    setError(''); setSaved(false);
    if (reset && !hasSettings) { discard(); return; }
    setBusy(true);
    try {
      const body = { baseUrl: draft.baseUrl, model: draft.model, ...(keyEdited ? { apiKey: draft.apiKey } : {}) };
      const value = await (reset ? resetProvider(options) : saveProvider(body, options));
      setDraft(draftFor(value)); setKeyEdited(false); onSaved(value); setSaved(true);
    } catch (problem) { setError(problem.message || t('操作失敗，請重試')); }
    finally { setBusy(false); }
  };
  const keyPlaceholder = record.custom.apiKey ? t('已設定 {hint}', { hint: record.apiKeyHint })
    : record.defaults.apiKeyHint ? t('預設 key {hint}', { hint: record.defaults.apiKeyHint }) : t('未設定 key');
  const host = new URL(record.baseUrl).host;
  return <>
    <div className="provider-fields">
      <label className="nb-field">{t('接口地址')}<input type="text" value={draft.baseUrl} disabled={busy} placeholder={t('預設：{value}', { value: record.defaults.baseUrl })} onChange={event => change('baseUrl', event.target.value)}/></label>
      <label className="nb-field">{t('模型')}<input type="text" value={draft.model} disabled={busy} placeholder={t('預設：{value}', { value: record.defaults.model })} onChange={event => change('model', event.target.value)}/></label>
      <label className="nb-field">{t('API Key')}<input type="password" autoComplete="new-password" value={draft.apiKey} disabled={busy} placeholder={keyPlaceholder} onChange={event => change('apiKey', event.target.value)}/></label>
    </div>
    <div className="nb-row-actions prompt-actions">
      <button type="button" className="nb-primary" disabled={busy || !dirty} onClick={() => submit(false)}>{t(busy ? '儲存中…' : '儲存')}</button>
      <button type="button" disabled={busy || (!dirty && !hasSettings)} onClick={() => submit(true)}>{t('恢復預設')}</button>
    </div>
    {error && <p role="alert" className="nb-error">{error}</p>}
    {saved && <p role="status" className="nb-success">{t('已儲存')}</p>}
    <p className="nb-muted">{t('目前生效：{model} · {host} · key {hint}', { model: record.model, host, hint: record.apiKeyHint || t('未設定') })}</p>
    <p className="nb-muted">{record.updatedAt ? t('最後修改：{name} · {time}', { name: record.updatedBy, time: formatFeedbackTime(Date.parse(record.updatedAt), lang) }) : t('尚未修改')}</p>
  </>;
}

export default function ProviderCard({ options, email }) {
  const { t } = useT(), cache = useQueryClient(), visible = useAppEmbedVisible();
  const queryKey = ['appProvider', email];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => getProvider({ ...options, signal }), enabled: visible,
    staleTime: Infinity, refetchOnWindowFocus: false });
  return <section className="nb-card provider-card" aria-label={t('模型設定')}>
    <h2>{t('模型設定')}</h2>
    {query.isPending ? <p className="nb-muted">{t('載入中…')}</p> : query.isError ? <p role="alert" className="nb-error">{query.error.message}</p>
      : <ProviderEditor record={query.data} options={options} onSaved={value => cache.setQueryData(queryKey, value)}/>}
  </section>;
}
