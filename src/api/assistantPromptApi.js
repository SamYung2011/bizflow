import { callHonnmonoAdmin } from '../lib/honnmonoAdmin.js';

async function request(path, options) {
  let payload;
  try { payload = await callHonnmonoAdmin('/assistant/prompts' + path, options); }
  catch (error) {
    // Show the backend's placeholder explanation unchanged, without the transport prefix.
    if (error.message.startsWith('HTTP 400: ')) throw new Error(error.message.slice(10));
    throw error;
  }
  if (payload?.code !== 0) throw new Error(payload?.des ?? payload?.msg ?? String(payload?.code ?? ''));
  return payload.result;
}

export function listPrompts(options) { return request('', options); }
export function savePrompt(key, content, options) {
  return request('/' + encodeURIComponent(key), { ...options, method: 'PATCH', body: { content } });
}
export function resetPrompt(key, options) {
  return request('/' + encodeURIComponent(key), { ...options, method: 'PATCH', body: { reset: true } });
}
