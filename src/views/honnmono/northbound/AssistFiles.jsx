import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { prepareImage } from '../../../lib/prepareImage.js';
import * as api from '../../../lib/northboundAssistApi.js';
import { KINDS } from './labels.js';

export default function AssistFiles({ record, options, run, busy, onPreview, onSubmit }) {
  const { t } = useT();
  const [requestId, setRequestId] = useState(record.pendingRequests?.[0]?.requestId || '');
  const pending = record.pendingRequests?.find(row => row.requestId === requestId);
  const kinds = record.status === 'draft' ? KINDS : KINDS.filter(([kind]) => pending?.kinds.includes(kind));
  async function upload(kind, files) {
    await run(async () => {
      for (const file of files) {
        const prepared = await prepareImage(file);
        const stored = await api.uploadDocument(record.id, prepared, options);
        await api.addDocument(record.id, { cfid: stored.cfid, kind, clientRequestId: crypto.randomUUID(),
          ...(record.status === 'draft' ? {} : { requestId }) }, options);
      }
      return api.getCase(record.id, options);
    });
  }
  return <section className="nb-card"><h3>{t('上傳與預覽')}</h3>
    {record.status !== 'draft' && <label className="nb-field">{t('待補件')}<select value={requestId} disabled={busy} onChange={event => setRequestId(event.target.value)}>
      {(record.pendingRequests || []).map(row => <option key={row.requestId} value={row.requestId}>{row.requestId} · {row.note}</option>)}
    </select></label>}
    <div className="assist-upload-grid">{kinds.map(([kind,label]) => <div className="assist-upload-kind" key={kind}>
      <label><strong>{t(label)}</strong><input aria-label={t(label)} type="file" accept="image/*,.pdf" multiple disabled={busy}
        onChange={event => { const files = [...event.target.files]; event.target.value = ''; if (files.length) upload(kind, files); }} /></label>
      {(record.documents || []).filter(doc => doc.kind === kind && doc.status !== 'removed' && (record.status === 'draft' || doc.requestId === requestId)).map(doc =>
        <div className="assist-file" key={doc.id}><span>{doc.name}</span><button type="button" disabled={busy} aria-label={t('移除文件：{name}', { name: doc.name })}
          onClick={() => run(async () => { await api.removeDocument(record.id, doc.id, options); return api.getCase(record.id, options); })}>{t('移除')}</button></div>)}
    </div>)}</div>
    <div className="assist-actions"><button type="button" disabled={busy} onClick={onPreview}>{t('預覽申請')}</button>
      {record.status !== 'draft' && <button className="nb-primary" type="button" disabled={busy || !pending} onClick={() => onSubmit(requestId)}>{t('代提交補件')}</button>}
    </div>
  </section>;
}
