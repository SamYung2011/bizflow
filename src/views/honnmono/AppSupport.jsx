import React, { useMemo, useState } from 'react';
import { useT } from '../../i18n.jsx';
import { SUPPORT_LIMITS } from '../../lib/supportConfig.js';
import { useSupportList, useSupportThread } from './support/useSupportData.js';
import ConversationList from './support/ConversationList.jsx';
import ConversationHeader from './support/ConversationHeader.jsx';
import MessageThread from './support/MessageThread.jsx';
import Composer from './support/Composer.jsx';
import SupportIcon from './support/SupportIcon.jsx';
import SupportSkeleton from './support/SupportSkeleton.jsx';
import './support/support.css';

function Workspace({ session, employees }) {
  const { t } = useT();
  const [selectedId, setSelectedId] = useState(null);
  const [filters, setFilters] = useState({ state: 'waiting', category: '', search: '' });
  const options = useMemo(() => ({ accessToken: session.access_token, operatorEmail: session.user.email }), [session.access_token, session.user.email]);
  const list = useSupportList(options, filters);
  const data = useSupportThread(selectedId, options);
  const conversation = data.detail.data;
  return <div className={`support-workspace ${selectedId ? 'has-conversation' : ''}`}>
    <ConversationList query={list} filters={filters} setFilters={setFilters} selectedId={selectedId} onSelect={setSelectedId} />
    <section className="support-main" aria-label={t('客服工作台')}>
      {!selectedId ? <div className="support-welcome"><div className="support-welcome-icon"><SupportIcon name="chat" size={38} /></div>
        <span className="support-eyebrow">{t('Honnmono 使用者服務')}</span><h2>{t('每一個問題，都有回應')}</h2><p>{t('選擇左側會話，開始協助使用者。')}</p>
        <div className="support-welcome-note"><span className="support-online-dot" />{t('所有對話與附件集中在此')}</div>
      </div> : data.detail.isPending ? <SupportSkeleton /> : data.detail.isError ? <div className="support-error" role="alert">
        {t('載入失敗，請重試')} <button onClick={() => data.detail.refetch()}>{t('重試')}</button><button onClick={() => setSelectedId(null)}>{t('返回會話列表')}</button>
      </div> : <>
        <ConversationHeader key={selectedId} conversation={conversation} employees={employees} onChange={data.change} onBack={() => setSelectedId(null)} />
        <MessageThread key={`thread-${selectedId}`} conversation={conversation} data={data} employees={employees} options={options} />
        <Composer key={`composer-${selectedId}`} closed={conversation.status === 'closed'} limits={conversation.limits || SUPPORT_LIMITS} onSend={data.send} />
      </>}
    </section>
  </div>;
}

export default function AppSupport({ session, isAdmin, employees = [] }) {
  const { t } = useT();
  if (!isAdmin || !session?.access_token || !session?.user?.email) return <div role="alert">{t('未登入或沒有管理員權限')}</div>;
  return <div className="support-container"><Workspace key={session.user.id || session.user.email} session={session} employees={employees} /></div>;
}
