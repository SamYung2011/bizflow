import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../i18n.jsx';
import { useAppEmbedVisible } from '../lib/appEmbedVisibility.js';
import { formatFeedbackTime } from '../lib/honnmonoAdmin.js';
import { listPrompts, resetPrompt, savePrompt } from '../api/assistantPromptApi.js';
import { PROMPT_LEAVE_EVENT, requestPromptLeave } from '../../root-site/bizflow/app-prompt-leave.js';
import './honnmono/northbound/northbound.css';
import './prompts/prompts.css';

const GROUPS = [['answer', '回答提示'], ['memory', '記憶提示'], ['handoff', '轉人工提示'], ['tool', '工具說明']];

export function PromptEditor({ record, options, onSaved, onBusyChange = () => {} }) {
  const { t, lang } = useT();
  const [content, setContent] = useState(record.content), [busy, setBusy] = useState(false);
  const [baseline, setBaseline] = useState(record.content);
  const [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const dirty = content !== baseline;
  useEffect(() => {
    if (!dirty && !busy) return;
    const leaving = event => {
      if (busy) { event.preventDefault(); return; }
      if (!window.confirm(t('有未儲存修改，放棄並離開？'))) event.preventDefault();
      else setContent(baseline);
    };
    const unloading = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener(PROMPT_LEAVE_EVENT, leaving);
    window.addEventListener('beforeunload', unloading);
    return () => { window.removeEventListener(PROMPT_LEAVE_EVENT, leaving); window.removeEventListener('beforeunload', unloading); };
  }, [dirty, busy, baseline, t]);
  const submit = async reset => {
    setError(''); setSaved(false);
    if (reset && !record.isCustom) { setContent(baseline); return; }
    setBusy(true); onBusyChange(true);
    try {
      const value = await (reset ? resetPrompt(record.key, options) : savePrompt(record.key, content, options));
      setBaseline(value.content); setContent(value.content); onSaved(value); setSaved(true);
    } catch (problem) { setError(problem.message || t('操作失敗，請重試')); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <section className="prompt-editor">
    <h2>{t(record.label)}</h2><p>{t(record.description)}</p>
    {record.placeholders.length > 0 && <p className="nb-muted">{t('這些記號不能刪：{markers}', { markers: record.placeholders.join(' · ') })}</p>}
    <textarea aria-label={t('提示詞內容')} value={content} disabled={busy} spellCheck={false} onChange={event => { setContent(event.target.value); setSaved(false); }}/>
    <div className="nb-row-actions prompt-actions">
      <button type="button" className="nb-primary" disabled={!dirty || busy} onClick={() => submit(false)}>{t(busy ? '儲存中…' : '儲存')}</button>
      <button type="button" disabled={busy || (!record.isCustom && !dirty)} onClick={() => submit(true)}>{t('恢復預設')}</button>
    </div>
    {error && <p role="alert" className="nb-error">{error}</p>}
    {saved && <p role="status" className="nb-success">{t('已儲存')}</p>}
    <p className="nb-muted">{record.updatedAt ? t('最後修改：{name} · {time}', {
      name: record.updatedBy, time: formatFeedbackTime(Date.parse(record.updatedAt), lang),
    }) : t('尚未修改')}</p>
  </section>;
}

function Workspace({ session }) {
  const { t } = useT(), cache = useQueryClient(), visible = useAppEmbedVisible();
  const options = useMemo(() => ({ accessToken: session.access_token }), [session.access_token]);
  const queryKey = ['appPrompts', session.user.email];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => listPrompts({ ...options, signal }), enabled: visible,
    staleTime: Infinity, refetchOnWindowFocus: false });
  const rows = query.data || [], [selected, setSelected] = useState(null), [busy, setBusy] = useState(false);
  const record = rows.find(row => row.key === selected) || rows[0];
  const choose = key => {
    if (key === record?.key) return;
    if (requestPromptLeave()) setSelected(key);
  };
  const saved = row => cache.setQueryData(queryKey, previous => previous.map(item => item.key === row.key ? row : item));
  return <div className="nb-workspace prompt-workspace">
    <aside className="nb-sidebar">
      <header><span className="nb-eyebrow">Honnmono APP</span><h1>{t('APP 提示詞')}</h1><p>{t('編輯 App 助手的提示詞')}</p></header>
      <div className="nb-list">
        {GROUPS.map(([kind, label]) => <section className="prompt-group" key={kind}>
          <h2>{t(label)}</h2>
          {rows.filter(row => row.kind === kind).map(row => <button key={row.key} type="button" className={`nb-case ${record?.key === row.key ? 'is-selected' : ''}`}
            aria-pressed={record?.key === row.key} disabled={busy} onClick={() => choose(row.key)}>
            <strong>{t(row.label)}</strong>{row.isCustom && <small>{t('已自訂')}</small>}
          </button>)}
        </section>)}
      </div>
    </aside>
    <main className="nb-main">
      {query.isPending ? <p className="nb-loading">{t('載入提示詞…')}</p> : query.isError ? <div role="alert" className="nb-error">
        {query.error.message || t('載入失敗，請重試')}<button type="button" onClick={() => query.refetch()}>{t('重試')}</button>
      </div> : record && <PromptEditor key={record.key} record={record} options={options} onSaved={saved} onBusyChange={setBusy}/>}
    </main>
  </div>;
}

export default function AppPrompts({ session, isAdmin = false, embedded = false }) {
  const { t } = useT();
  if (!isAdmin || !session?.access_token || !session?.user?.email) return <div role="alert">{t('僅管理員可編輯提示詞')}</div>;
  return <div className={embedded ? 'nb-container nb-embedded' : 'nb-container'}><Workspace session={session}/></div>;
}
