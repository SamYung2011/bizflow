import { useAppEmbedVisible } from '../../lib/appEmbedVisibility.js';
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../i18n.jsx';
import { getArticle, getTopic, listArticles, listTopics } from '../../lib/knowledgeApi.js';
import SaveNotice from './knowledge/SaveNotice.jsx';
import TopicEditor from './knowledge/TopicEditor.jsx';
import ArticleEditor from './knowledge/ArticleEditor.jsx';
import ArticleList from './knowledge/ArticleList.jsx';
import './northbound/northbound.css';
import { PAGE_SIZE } from './knowledge/form.js';
import './offers/offers.css';
import './knowledge/knowledge.css';

function Workspace({ session }) {
  const visible = useAppEmbedVisible();
  const { t } = useT(), cache = useQueryClient();
  const options = useMemo(() => ({ accessToken: session.access_token }), [session.access_token]);
  const [topicId, setTopicId] = useState(null), [newTopic, setNewTopic] = useState(false);
  const [articleId, setArticleId] = useState(null), [newArticle, setNewArticle] = useState(false);
  const [noticeState, setNoticeState] = useState({ text: '', sequence: 0 });
  const setMessage = text => setNoticeState(current => ({ text, sequence: current.sequence + 1 }));
  const [filters, setFilters] = useState({ q: '', enabled: '', page: 1 });
  const key = ['appKnowledge', session.user.email];
  const topics = useQuery({ queryKey: [...key, 'topics'], queryFn: ({ signal }) => listTopics({ ...options, signal }), staleTime: 10000, enabled: visible });
  const rows = topics.data || [];
  useEffect(() => { if (topicId == null && !newTopic && rows.length) setTopicId(rows[0].id); }, [topicId, newTopic, rows]);
  const topic = useQuery({ queryKey: [...key, 'topic', topicId], queryFn: ({ signal }) => getTopic(topicId, { ...options, signal }), enabled: visible && topicId != null });
  const articles = useQuery({ queryKey: [...key, 'articles', topicId, filters],
    queryFn: ({ signal }) => listArticles({ topicId, ...filters, size: PAGE_SIZE }, { ...options, signal }), enabled: visible && topicId != null });
  const article = useQuery({ queryKey: [...key, 'article', articleId], queryFn: ({ signal }) => getArticle(articleId, { ...options, signal }), enabled: visible && articleId != null });
  const chooseTopic = id => { setTopicId(id); setNewTopic(false); setArticleId(null); setNewArticle(false);
    setFilters({ q: '', enabled: '', page: 1 }); setMessage(''); };
  const savedTopic = async saved => { setTopicId(saved.id); setNewTopic(false);
    cache.setQueryData([...key, 'topic', saved.id], saved); await cache.invalidateQueries({ queryKey: key }); };
  const savedArticle = async saved => { setArticleId(saved.id); setNewArticle(false); setTopicId(saved.topicId);
    if (saved.topicId !== topicId) setFilters({ q: '', enabled: '', page: 1 });
    cache.setQueryData([...key, 'article', saved.id], saved);
    // Invalidate lists and both details, including the previous topic when an article moves.
    await cache.invalidateQueries({ queryKey: key }); };
  const loadError = query => <div role="alert" className="nb-error">{t('載入失敗，請重試')}
    <button type="button" onClick={() => query.refetch()}>{t('重試')}</button></div>;
  const notice = <SaveNotice message={noticeState.text} sequence={noticeState.sequence} />;
  return <div className="nb-workspace knowledge-workspace">
    <aside className="nb-sidebar">
      <header><span className="nb-eyebrow">Honnmono APP</span><h1>{t('APP 知識庫')}</h1><p>{t('編輯 App 助手的知識庫內容')}</p></header>
      <button type="button" className="promo-new" onClick={() => { setNewTopic(true); setTopicId(null); setArticleId(null); setNewArticle(false); setMessage(''); }}>{t('新增主題')}</button>
      <div className="nb-list">
        {topics.isPending ? <p className="nb-muted">{t('載入知識庫…')}</p> : topics.isError ? loadError(topics) :
          rows.length === 0 ? <p className="nb-muted">{t('尚未有主題')}</p> : rows.map(row => <button key={row.id} type="button"
            className={`nb-case ${topicId === row.id ? 'is-selected' : ''} ${row.enabled ? '' : 'is-disabled'}`} onClick={() => chooseTopic(row.id)}>
            <strong>{row.title['zh-Hant']}</strong><span className="nb-case-name">{row.subtitle['zh-Hant']}</span>
            <small>{t('已啟用文章 {enabled}／{total}', { enabled: row.enabledArticleCount, total: row.articleCount })}</small>
            {!row.enabled && <span className="nb-case-meta">{t('已停用')}</span>}
          </button>)}
      </div>
    </aside>
    <main className="nb-main">
      {newArticle || articleId != null ? articleId != null && article.isPending ? <p className="nb-loading">{t('載入知識庫…')}</p> :
        articleId != null && article.isError ? loadError(article) : <ArticleEditor key={articleId || 'new'} record={articleId ? article.data : undefined}
          topics={rows} topicId={topicId} options={options} onSaved={savedArticle} onStatus={setMessage} notice={notice} onBack={() => { setArticleId(null); setNewArticle(false); setMessage(''); }}/>
        : newTopic ? <TopicEditor key="new" options={options} onSaved={savedTopic} onStatus={setMessage} notice={notice}/> : topicId == null ? <div className="nb-welcome">
          <h2>{t('選擇主題')}</h2><p>{t('從左側選擇主題或新增主題。')}</p></div> : topic.isPending ? <p className="nb-loading">{t('載入知識庫…')}</p> :
          topic.isError ? loadError(topic) : <>
            <TopicEditor key={`topic-${topicId}`} record={topic.data} options={options} onSaved={savedTopic} onStatus={setMessage} notice={notice}/>
            <ArticleList key={`articles-${topicId}`} query={articles} filters={filters} onFilters={setFilters} onSelect={setArticleId}
              onNew={() => { setNewArticle(true); setArticleId(null); setMessage(''); }}/>
          </>}
    </main>
  </div>;
}

export default function AppKnowledge({ session, embedded = false }) {
  const { t } = useT();
  if (!session?.access_token || !session?.user?.email) return <div role="alert">{t('未登入或沒有主站權限')}</div>;
  return <div className={embedded ? 'nb-container nb-embedded' : 'nb-container'}>
    <Workspace key={session.user.id || session.user.email} session={session}/>
  </div>;
}
