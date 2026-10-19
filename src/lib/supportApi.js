import { uploadSignedAttachment } from './uploadSignedAttachment.js';
import { callHonnmonoAdmin } from './honnmonoAdmin.js';
import { SUPPORT_LIMITS } from './supportConfig.js';

export const SUPPORT_MOCK = import.meta.env.VITE_SUPPORT_MOCK === '1';
const mock = SUPPORT_MOCK ? import('./supportMock.js') : null;

async function request(name, path, options, args, body) {
  if (mock) return (await mock)[name](...args, options);
  const payload = await callHonnmonoAdmin(`/support${path}`, {
    ...options, ...(body === undefined ? {} : { method: 'POST', body }),
  });
  if (payload?.code !== undefined) {
    if (payload.code !== 0) throw new Error(payload.des || `Support ${payload.code}`);
    return payload.result;
  }
  return payload;
}

const query = params => new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null)).toString();
export const listConversations = (params = {}, options = {}) =>
  request('listConversations', `/conversations?${query(params)}`, options, [params]);
export const getConversation = (id, options = {}) =>
  request('getConversation', `/conversations/${id}`, options, [id]);
export const listMessages = (id, params = {}, options = {}) =>
  request('listMessages', `/conversations/${id}/messages?${query(params)}`, options, [id, params]);
export const sendMessage = (id, body, options = {}) =>
  request('sendMessage', `/conversations/${id}/messages`, options, [id, body], body);
export const closeConversation = (id, options = {}) =>
  request('closeConversation', `/conversations/${id}/close`, options, [id], {});
export const updateConversation = (id, { category } = {}, options = {}) =>
  request('updateConversation', `/conversations/${id}/update`, options, [id, { category }], { category });

// Protected bytes become a local URL; callers revoke it when no longer displayed.
export async function fileUrl(attachment, options = {}) {
  if (mock) return (await mock).fileUrl(attachment, options);
  const blob = await callHonnmonoAdmin(`/support/files/${encodeURIComponent(attachment.cfid)}/${encodeURIComponent(attachment.name)}`, {
    ...options, responseType: 'blob',
  });
  return URL.createObjectURL(blob);
}

export async function uploadAttachment(id, file, options = {}) {
  const limits = options.limits || SUPPORT_LIMITS;
  if (file.size > limits.attachmentMaxMb * 1024 * 1024) throw new Error('attachment_too_large');
  if (mock) return (await mock).uploadAttachment(id, file, options);
  const signature = await request('uploadAttachment', '/upload', options, [], {
    conversationId: id, filelist: [{ filename: file.name, size: file.size, mime: file.type }],
  });
  return uploadSignedAttachment(file, () => Promise.resolve(signature), options);
}

export const searchUsers = (params = {}, options = {}) =>
  request('searchUsers', `/users?${query(params)}`, options, [params]);
export const getUserProfile = (id, options = {}) =>
  request('getUserProfile', `/users/${encodeURIComponent(id)}/profile`, options, [id]);
