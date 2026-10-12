import { callHonnmonoAdmin } from './honnmonoAdmin.js';
const prefix = '/knowledge';
const id = value => encodeURIComponent(value);
const query = values => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '' && value != null)).toString();
async function request(path, options, method = 'GET', body) {
  const payload = await callHonnmonoAdmin(`${prefix}${path}`, { ...options, method, ...(body === undefined ? {} : { body }) });
  if (payload?.code !== 0) throw new Error(payload?.des || 'Knowledge request failed');
  return payload.result;
}
export const listTopics = options => request('/topics', options);
export const createTopic = (body, options) => request('/topics', options, 'POST', body);
export const getTopic = (topicId, options) => request(`/topics/${id(topicId)}`, options);
export const updateTopic = (topicId, body, options) => request(`/topics/${id(topicId)}`, options, 'PATCH', body);
export const listArticles = (params, options) => request(`/articles?${query(params)}`, options);
export const createArticle = (body, options) => request('/articles', options, 'POST', body);
export const getArticle = (articleId, options) => request(`/articles/${id(articleId)}`, options);
export const updateArticle = (articleId, body, options) => request(`/articles/${id(articleId)}`, options, 'PATCH', body);
