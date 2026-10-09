import { callHonnmonoAdmin } from './honnmonoAdmin.js';

const prefix = '/promo';
const id = value => encodeURIComponent(value);
const query = values => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '' && value != null)).toString();

async function request(path, options, method = 'GET', body) {
  const payload = await callHonnmonoAdmin(`${prefix}${path}`, { ...options, method,
    ...(body === undefined ? {} : { body }) });
  if (payload?.code !== 0) throw new Error(payload?.des || 'Promo request failed');
  return payload.result;
}

export const listOffers = (params, options) => request(`/offers?${query(params)}`, options);
export const createOffer = (body, options) => request('/offers', options, 'POST', body);
export const getOffer = (offerId, options) => request(`/offers/${id(offerId)}`, options);
export const updateOffer = (offerId, body, options) => request(`/offers/${id(offerId)}`, options, 'PATCH', body);
export const listCoupons = (params, options) => request(`/coupons?${query(params)}`, options);
export const getCoupon = (couponId, options) => request(`/coupons/${id(couponId)}`, options);
export const useCoupon = (couponId, body, options) => request(`/coupons/${id(couponId)}/use`, options, 'POST', body);
export const voidCoupon = (couponId, body, options) => request(`/coupons/${id(couponId)}/void`, options, 'POST', body);
