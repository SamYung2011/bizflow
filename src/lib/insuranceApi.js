import { callHonnmonoAdmin } from './honnmonoAdmin.js';

const prefix = '/insurance';
const query = values => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '' && value != null)).toString();

async function request(path, options, body) {
  const payload = await callHonnmonoAdmin(`${prefix}${path}`, {
    ...options, ...(body === undefined ? {} : { method: 'POST', body }),
  });
  if (payload?.code !== 0) throw new Error('Insurance request failed');
  return payload.result;
}

const id = value => encodeURIComponent(value);
export const listItems = (params, options) => request(`/items?${query(params)}`, options);
export const getPolicy = (policyId, options) => request(`/policies/${id(policyId)}`, options);
export const extractPolicy = (policyId, body, options) => request(`/policies/${id(policyId)}/extract`, options, body);
export const getClaim = (claimId, options) => request(`/claims/${id(claimId)}`, options);
export const changeClaimStage = (claimId, body, options) => request(`/claims/${id(claimId)}/stage`, options, body);
export const requestClaimDocuments = (claimId, body, options) => request(`/claims/${id(claimId)}/doc-requests`, options, body);
export const reviewClaimDocument = (claimId, documentId, body, options) =>
  request(`/claims/${id(claimId)}/documents/${id(documentId)}/review`, options, body);
export const addClaimNotice = (claimId, body, options) => request(`/claims/${id(claimId)}/notice`, options, body);
export const getEnquiry = (enquiryId, options) => request(`/enquiries/${id(enquiryId)}`, options);
export const changeEnquiryStage = (enquiryId, body, options) => request(`/enquiries/${id(enquiryId)}/stage`, options, body);
export const fileBlob = (item, options) => callHonnmonoAdmin(
  `${prefix}/files/${id(item.cfid)}/${id(item.name || 'file')}`,
  { ...options, responseType: 'blob' },
);
