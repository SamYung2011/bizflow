import { SUPPORT_LIMITS } from './supportConfig.js';

export async function uploadSignedAttachment(file, sign, options = {}) {
  const limits = options.limits || SUPPORT_LIMITS;
  if (file.size > limits.attachmentMaxMb * 1024 * 1024) throw new Error('attachment_too_large');
  const signature = await sign({ filename: file.name, size: file.size, mime: file.type });
  const signed = signature.filelist[0];
  // Existing cloud-storage upload consumes raw bytes (not a multipart envelope).
  const apiBase = import.meta.env.VITE_SUPABASE_URL;
  const uploadUrl = new URL(signed.cfinfo.url, apiBase);
  const isBridge = uploadUrl.origin === new URL(apiBase).origin && uploadUrl.pathname.startsWith('/functions/v1/honnmono-admin/support/upload/');
  const uploaded = await fetch(uploadUrl.href, {
    method: signed.cfinfo.method || 'POST', body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream',
      ...(isBridge ? { Authorization: `Bearer ${options.accessToken}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } : {}) }, signal: options.signal,
  });
  if (!uploaded.ok) throw new Error(`Upload HTTP ${uploaded.status}`);
  const result = await uploaded.json();
  if (result.code !== 0) throw new Error(result.des || 'Upload failed');
  return { cfid: signed.cfid, url: signed.url, thumbUrl: signed.thumbUrl,
    name: file.name, size: file.size, mime: file.type };
}
