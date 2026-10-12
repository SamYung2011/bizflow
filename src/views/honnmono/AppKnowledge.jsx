import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../i18n.jsx';
import { getArticle, getTopic, listArticles, listTopics } from '../../lib/knowledgeApi.js';
import TopicEditor from './knowledge/TopicEditor.jsx';
import ArticleEditor from './knowledge/ArticleEditor.jsx';
import ArticleList from './knowledge/ArticleList.jsx';
import './northbound/northbound.css';
import './offers/offers.css';
import './knowledge/knowledge.css';

function Workspace({ session }) {
  const { t } = useT(), cache = useQueryClient();
  const options = useMemo(() => ({ accessToken: session.access_token }), [session.access_token]);
  const [topicId, setTopicId] = useState(null), [newTopic, setNewTopic] = useState(false);
  const [articleId, setArticleId] = useState(null), [newArticle, setNewArticle] = useState(false);
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState({ q: '', enabled: '', page: 1 });
  const key = ['appKnowledge', session.user.email];
  const topics = useQuery({ queryKey: [...key, 'topics'], queryFn: ({ signal }) => listTopics({ ...options, signal }), staleTime: 10000 });
  const rows = topics.data || [];
  useEffect(() => { if (topicId == null && !newTopic && rows.length) setTopicId(rows[0].id); }, [topicId, newTopic, rows]);
  const topic = useQuery({ queryKey: [...key, 'topic', topicId], queryFn: ({ signal }) => getTopic(topicId, { ...options, signal }), enabled: topicId != null });
  const articles = useQuery({ queryKey: [...key, 'articles', topicId, filters],
    queryFn: ({ signal }) => listArticles({ topicId, ...filters, size: 30 }, { ...options, signal }), enabled: topicId != null });
  const article = useQuery({ queryKey: [...key, 'article', articleId], queryFn: ({ signal }) => getArticle(articleId, { ...options, signal }), enabled: articleId != null });
  const chooseTopic = id => { setTopicId(id); setNewTopic(false); setArticleId(null); setNewArticle(false);
    setFilters({ q: '', enabled: '', page: 1 }); setNotice(''); };
  const savedTopic = async saved => { setTopicId(saved.id); setNewTopic(false); setNotice(t('已儲存'));
    cache.setQueryData([...key, 'topic', saved.id], saved); await cache.invalidateQueries({ queryKey: key }); };
  const savedArticle = async saved => { setArticleId(saved.id); setNewArticle(false); setTopicId(saved.topicId);
    setNotice(t('已儲存')); cache.setQueryData([...key, 'article', saved.id], saved);
    // Invalidate lists and both details, including the previous topic when an article moves.
    await cache.invalidateQueries({ queryKey: key }); };
  const loadError = query => <div role="alert" className="nb-error">{t('載入失敗，請重試')}
    <button type="button" onClick={() => query.refetch()}>{t('重試')}</button></div>;
  return <div className="nb-workspace promo-workspace knowledge-workspace">
    <aside className="nb-sidebar">
      <header><span className="nb-eyebrow">Honnmono APP</span><h1>{t('APP 知識庫')}</h1><p>{t('編輯 App 助手的知識庫內容')}</p></header>
      <button type="button" className="promo-new" onClick={() => { setNewTopic(true); setTopicId(null); setArticleId(null); setNewArticle(false); setNotice(''); }}>{t('新增主題')}</button>
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
      {notice && <p role="status" className="knowledge-notice">{notice}</p>}
      {newArticle || articleId != null ? articleId != null && article.isPending ? <p className="nb-loading">{t('載入知識庫…')}</p> :
        articleId != null && article.isError ? loadError(article) : <ArticleEditor key={articleId || 'new'} record={articleId ? article.data : undefined}
          topics={rows} topicId={topicId} options={options} onSaved={savedArticle} onBack={() => { setArticleId(null); setNewArticle(false); }}/>
        : newTopic ? <TopicEditor key="new" options={options} onSaved={savedTopic}/> : topicId == null ? <div className="nb-welcome">
          <h2>{t('選擇主題')}</h2><p>{t('從左側選擇主題或新增主題。')}</p></div> : topic.isPending ? <p className="nb-loading">{t('載入知識庫…')}</p> :
          topic.isError ? loadError(topic) : <>
            <TopicEditor key={topicId} record={topic.data} options={options} onSaved={savedTopic}/>
            <ArticleList key={topicId} query={articles} filters={filters} onFilters={setFilters} onSelect={setArticleId}
              onNew={() => { setNewArticle(true); setArticleId(null); setNotice(''); }}/>
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
