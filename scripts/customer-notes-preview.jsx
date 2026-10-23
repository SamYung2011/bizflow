// Local test fixture: real workspaces and the shared search/profile, fake transport only.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '../src/i18n.jsx';
import AppSupport from '../src/views/honnmono/AppSupport.jsx';
import AppNorthbound from '../src/views/honnmono/AppNorthbound.jsx';
import AppInsurance from '../src/views/honnmono/AppInsurance.jsx';
import { configureMock, updateUserProfile } from '../src/lib/supportMock.js';
if (!import.meta.env.DEV || import.meta.env.VITE_SUPPORT_MOCK !== '1' || import.meta.env.VITE_SUPABASE_URL !== 'https://fixture.invalid') throw new Error('Local mock only');
configureMock({ delay: 10, sendDelay: 10 });
window.fixtureConfigureMock = configureMock;
window.fixtureConcurrentNote = (revision) => updateUserProfile(99001, { note:'另一位同事更新', revision });
window.fixtureQueries=[];
window.fetch = async (input) => {
  const url=new URL(input); if(url.origin!=='https://fixture.invalid') throw new Error('External network forbidden');
  window.fixtureQueries.push(url.pathname+url.search);
  return new Response(JSON.stringify({code:0,result:{items:[],total:0,page:1,size:30}}),{headers:{'Content-Type':'application/json'}});
};
const session={access_token:'fixture-only',user:{id:'notes-staff',email:'staff@example.test'}};
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
function Preview(){ const [view,setView]=useState('support'); const Component={support:AppSupport,northbound:AppNorthbound,insurance:AppInsurance}[view];
 return <div style={{padding:20,fontFamily:'-apple-system,sans-serif',background:'#f3f5f9',minHeight:'100vh'}}>
  <nav style={{display:'flex',gap:16,marginBottom:16}}>{['support','northbound','insurance'].map(v=><button key={v} onClick={()=>setView(v)}>{v}</button>)}</nav>
  <Component session={session}/></div>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><I18nProvider><Preview/></I18nProvider></QueryClientProvider>);
