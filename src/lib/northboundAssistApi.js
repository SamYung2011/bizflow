import { callHonnmonoAdmin } from './honnmonoAdmin.js';
import { uploadSignedAttachment } from './uploadSignedAttachment.js';
const path = id => `/northbound/assist/cases/${encodeURIComponent(id)}`;
async function request(url, options, body) {
  const response = await callHonnmonoAdmin(url, { ...options, ...(body === undefined ? {} : { method: 'POST', body }) });
  if (response?.code !== 0) throw new Error('Northbound assistance failed');
  return response.result;
}
export const createCase = (userId, body, options) => request(`/northbound/assist/users/${encodeURIComponent(userId)}/cases`, options, body);
export const listCases = (userId, options) => request(`/northbound/assist/users/${encodeURIComponent(userId)}/cases`, options);
export const getCase = (id, options) => request(path(id), options);
export const updateCase = (id, body, options) => request(`${path(id)}/update`, options, body);
export const addDocument = (id, body, options) => request(`${path(id)}/documents`, options, body);
export const removeDocument = (id, docId, options) => request(`${path(id)}/documents/${encodeURIComponent(docId)}/remove`, options, {});
export const submitCase = (id, options) => request(`${path(id)}/submit`, options, {});
export const submitRequest = (id, requestId, options) => request(`${path(id)}/doc-requests/${encodeURIComponent(requestId)}/submit`, options, {});
export const uploadDocument = (id, file, options) => uploadSignedAttachment(file,
  metadata => request(`${path(id)}/upload`, options, { filelist: [metadata] }), options);
