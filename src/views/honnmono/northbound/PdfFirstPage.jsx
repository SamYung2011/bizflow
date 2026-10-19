import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../../../i18n.jsx';

export default function PdfFirstPage({ blob, name }) {
  const { t } = useT(), canvas = useRef(null);
  const [state, setState] = useState('loading');
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    import('../../../lib/northboundPdfPreview.js')
      .then(({ renderFirstPage }) => renderFirstPage(blob, canvas.current, controller.signal))
      .then(() => { if (!controller.signal.aborted) setState('ready'); })
      .catch(() => { if (!controller.signal.aborted) setState('error'); });
    return () => controller.abort();
  }, [blob]);
  return <div className="nb-pdf-first-page" aria-busy={state === 'loading'}>
    <canvas ref={canvas} role="img" aria-label={name} hidden={state !== 'ready'} />
    {state !== 'ready' && <p role={state === 'error' ? 'alert' : 'status'}>{t(state === 'error' ? '無法讀取附件，請重試。' : '載入中…')}</p>}
  </div>;
}
