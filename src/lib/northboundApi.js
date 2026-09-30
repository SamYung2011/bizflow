import { callHonnmonoAdmin } from './honnmonoAdmin.js';

const prefix = '/northbound';
const query = values => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '' && value != null)).toString();

async function request(path, options, body) {
  const payload = await callHonnmonoAdmin(`${prefix}${path}`, {
    ...options, ...(body === undefined ? {} : { method: 'POST', body }),
  });
  if (payload?.code !== 0) throw new Error('Northbound request failed');
  return payload.result;
}

export const listCases = (params, options) => request(`/cases?${query(params)}`, options);
export const getCase = (id, options) => request(`/cases/${encodeURIComponent(id)}`, options);
export const changeStage = (id, body, options) => request(`/cases/${encodeURIComponent(id)}/stage`, options, body);
export const requestDocuments = (id, body, options) => request(`/cases/${encodeURIComponent(id)}/doc-requests`, options, body);
export const reviewDocument = (id, docId, body, options) =>
  request(`/cases/${encodeURIComponent(id)}/documents/${encodeURIComponent(docId)}/review`, options, body);
export const addNotice = (id, body, options) => request(`/cases/${encodeURIComponent(id)}/notice`, options, body);
export const updateFlags = (id, body, options) => request(`/cases/${encodeURIComponent(id)}/flags`, options, body);

// Fetch protected bytes through the same bridge; never expose Shenzhen URLs in the page.
export const fileBlob = (item, options) => callHonnmonoAdmin(
  `/northbound/files/${encodeURIComponent(item.cfid)}/${encodeURIComponent(item.name || 'file')}`,
  { ...options, responseType: 'blob' },
);
