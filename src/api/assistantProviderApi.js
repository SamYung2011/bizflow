import { callHonnmonoAdmin } from '../lib/honnmonoAdmin.js';

async function request(options) {
  let payload;
  try { payload = await callHonnmonoAdmin('/assistant/provider', options); }
  catch (error) {
    if (error.message.startsWith('HTTP 400: ')) throw new Error(error.message.slice(10));
    throw error;
  }
  if (payload?.code !== 0) throw new Error(payload?.des ?? payload?.msg ?? String(payload?.code ?? ''));
  return payload.result;
}

export function getProvider(options) { return request(options); }
export function saveProvider(body, options) { return request({ ...options, method: 'PATCH', body }); }
export function resetProvider(options) { return saveProvider({ reset: true }, options); }
