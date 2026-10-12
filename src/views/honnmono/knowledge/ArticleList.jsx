import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { PAGE_SIZE } from './form.js';
import { formatFeedbackTime } from '../../../lib/honnmonoAdmin.js';

export default function ArticleList({ query, filters, onFilters, onSelect, onNew }) {
  const { t, lang } = useT();
  const [draft, setDraft] = useState(filters.q);
  const data = query.data || { items: [], total: 0 }, pages = Math.max(1, Math.ceil(data.total / (data.size || PAGE_SIZE)));
  return <section className="knowledge-article-list">
    <header><h2>{t('主題文章')}</h2><button type="button" className="promo-new" onClick={onNew}>{t('新增文章')}</button></header>
    <div className="knowledge-list-tools">
      <form className="nb-search" onSubmit={event => { event.preventDefault(); onFilters({ ...filters, q: draft.trim(), page: 1 }); }}>
        <input value={draft} onChange={event => setDraft(event.target.value)} maxLength={120}
          aria-label={t('搜尋文章')} placeholder={t('搜尋文章')}/><button type="submit">{t('搜尋')}</button>
      </form>
      <label className="promo-filter"><span>{t('狀態篩選')}</span><select value={filters.enabled}
        onChange={event => onFilters({ ...filters, enabled: event.target.value, page: 1 })}>
        <option value="">{t('全部')}</option><option value="true">{t('已上架')}</option><option value="false">{t('草稿')}</option>
      </select></label>
    </div>
    {query.isPending ? <p>{t('載入知識庫…')}</p> : query.isError ? <div role="alert" className="nb-error">
      {t('載入失敗，請重試')}<button type="button" onClick={() => query.refetch()}>{t('重試')}</button></div> :
      data.items.length ? <div className="knowledge-table-scroll"><table>
        <thead><tr>{['列表標題', '類型', '狀態', '更新時間', '更新人'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead>
        <tbody>{data.items.map(article => <tr key={article.id}>
          <td><button type="button" className="knowledge-article-link" onClick={() => onSelect(article.id)}>{article.listTitle['zh-Hant'] || article.title['zh-Hant']}</button></td>
          <td>{t(article.kind === 'workflow' ? '步驟' : '普通文章')}</td><td>{t(article.enabled ? '已上架' : '草稿')}</td>
          <td>{formatFeedbackTime(article.updatedAt, lang)}</td><td>{article.updatedBy || '—'}</td>
        </tr>)}</tbody>
      </table></div> : <p className="nb-muted">{t('沒有符合條件的文章')}</p>}
    <footer className="nb-page-controls"><span>{t('共 {count} 篇', { count: data.total })}</span>
      <button type="button" disabled={filters.page <= 1} onClick={() => onFilters({ ...filters, page: filters.page - 1 })}>{t('上一頁')}</button>
      <span>{filters.page}/{pages}</span><button type="button" disabled={filters.page >= pages}
        onClick={() => onFilters({ ...filters, page: filters.page + 1 })}>{t('下一頁')}</button>
    </footer>
  </section>;
}
