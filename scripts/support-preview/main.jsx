import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider, useT } from '../../src/i18n.jsx';
import AppSupport from '../../src/views/honnmono/AppSupport.jsx';
import { SUPPORT_MOCK } from '../../src/lib/supportApi.js';
import { configureMock, receiveMockMessage } from '../../src/lib/supportMock.js';

if (!import.meta.env.DEV || !SUPPORT_MOCK) throw new Error('Preview requires VITE_SUPPORT_MOCK=1 in Vite dev mode');
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const session = { access_token: 'local-preview-only', user: { id: 'preview-staff', email: 'mia@example.test' } };
function Preview() {
  const { lang, setLang } = useT();
  const [slow, setSlow] = useState(false), [narrow, setNarrow] = useState(false);
  return <div style={{ background: '#f3f5f9', minHeight: '100dvh', fontFamily: '-apple-system, sans-serif', padding: '0 24px 20px' }}>
    <header style={{ height: 65, display: 'flex', alignItems: 'center', gap: 22, color: '#68728b', fontSize: 12 }}>
      <strong style={{ color: '#334777', fontSize: 21, marginRight: 12 }}>bizflow<span style={{ color: '#486ee8' }}>.</span></strong><span>Honnmono / APP Support</span>
      <span style={{ marginLeft: 'auto', fontSize: 10 }}>LOCAL MOCK PREVIEW</span>
      <select aria-label="Language" value={lang} onChange={event => setLang(event.target.value)}><option value="zh">繁體中文</option><option value="en">English</option><option value="fr">Français</option></select>
    </header>
    <div style={{ maxWidth: narrow ? 390 : 1600, margin: '0 auto' }}><AppSupport session={session} isAdmin employees={[{ email: session.user.email, name: 'Mia Wong' }]} /></div>
    <footer style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 2px', fontSize: 10, color: '#8994a8' }}>
      <span>Preview controls</span><button onClick={() => configureMock({ failNext: true })}>Fail next send</button>
      <button onClick={() => { setSlow(!slow); configureMock({ delay: slow ? 450 : 8000, sendDelay: slow ? 1800 : 8000 }); }}>{slow ? 'Normal speed' : 'Slow responses'}</button>
      <button onClick={() => receiveMockMessage(3)}>Incoming → Daniel</button><button onClick={() => setNarrow(!narrow)}>Narrow / desktop</button>
      <span>Use /fail in a reply to fail once, then retry the same message.</span>
    </footer>
  </div>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><I18nProvider><Preview /></I18nProvider></QueryClientProvider>);
