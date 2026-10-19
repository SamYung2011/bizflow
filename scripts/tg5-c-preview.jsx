import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '../src/i18n.jsx';
import AppSupport from '../src/views/honnmono/AppSupport.jsx';
import AppNorthbound from '../src/views/honnmono/AppNorthbound.jsx';
import { configureMock } from '../src/lib/supportMock.js';
import { installAssistFixture } from './tg5-assist-fixture.js';
if (!import.meta.env.DEV || import.meta.env.VITE_SUPPORT_MOCK!=='1' || import.meta.env.VITE_SUPABASE_URL!=='https://fixture.invalid') throw new Error('Local mock preview only');
configureMock({delay:20,sendDelay:20}); installAssistFixture();
const session={access_token:'local-only',user:{id:'fixture-staff',email:'mia@example.test'}};
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
const view=new URLSearchParams(location.search).get('view');
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><I18nProvider>
  <div style={{background:'#f3f5f9',minHeight:'100dvh',padding:'28px',fontFamily:'-apple-system,sans-serif'}}>
    <div style={{color:'#334777',fontSize:24,fontWeight:700,paddingBottom:20}}>bizflow<span style={{color:'#486ee8'}}>.</span></div>
    {view==='assist'?<AppNorthbound session={session}/>:<AppSupport session={session} employees={[{email:'mia@example.test',name:'Mia Wong'}]}/>}
  </div>
</I18nProvider></QueryClientProvider>);
