export const SUPPORT_UPLOAD_BYTES = 20 * 1024 * 1024;
const JSON_BYTES = 4 * 1024 * 1024;

export function supportUpstreamPath(path, method) {
  if (!['GET', 'POST', 'DELETE'].includes(method) || !path.startsWith('/support/')) return '';
  const parts = path.slice('/support/'.length).split('/');
  try {
    if (parts.some(part => !part || /[\\/]/.test(decodeURIComponent(part)) || ['.', '..'].includes(decodeURIComponent(part)))) return '';
  } catch { return ''; }
  if (/^\/support\/upload\/[A-Za-z0-9_-]{1,64}$/.test(path)) {
    return method === 'POST' ? `/internal/cloud-storage/upload/${parts[1]}` : '';
  }
  return `/internal/admin${path}`;
}

export function isSupportUpstream(path) {
  return path.startsWith('/internal/admin/support/') || /^\/internal\/cloud-storage\/upload\/[A-Za-z0-9_-]{1,64}$/.test(path);
}

async function readLimited(stream, limit) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(), chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new RangeError('Body too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

// Called only after index.ts has verified JWT, main-site permissions and upstream URL.
export async function forwardSupport(req, upstreamUrl, { token, operatorEmail, cors }) {
  const reply = (body, status = 200) => Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });
  const upload = upstreamUrl.pathname.startsWith('/internal/cloud-storage/upload/');
  const file = upstreamUrl.pathname.startsWith('/internal/admin/support/files/');
  let body;
  if (['POST', 'DELETE'].includes(req.method)) {
    try { body = await readLimited(req.body, upload ? SUPPORT_UPLOAD_BYTES : JSON_BYTES); }
    catch (error) { if (error instanceof RangeError) return reply({ error: error.message }, 413); throw error; }
    if (!upload && body.length) {
      try {
        const value = JSON.parse(new TextDecoder().decode(body));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError();
      } catch { return reply({ error: 'Invalid JSON body' }, 400); }
    }
  }
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method, redirect: 'error', body: body?.length ? body : undefined,
      headers: { 'X-Internal-Token': token, 'X-Operator-Email': operatorEmail,
        ...(body?.length ? { 'Content-Type': upload ? req.headers.get('content-type') || 'application/octet-stream' : 'application/json' } : {}) },
      signal: AbortSignal.timeout(upload || file ? 60000 : 10000),
    });
  } catch { return reply({ error: 'Honnmono support service timeout' }, 504); }
  if ([401, 403].includes(upstream.status)) return reply({ error: 'Honnmono support service unavailable' }, 502);
  let bytes;
  try { bytes = await readLimited(upstream.body, file ? SUPPORT_UPLOAD_BYTES : JSON_BYTES); }
  catch (error) { if (error instanceof RangeError) return reply({ error: error.message }, 502); throw error; }
  if (file && upstream.ok) {
    return new Response(bytes, { status: upstream.status, headers: { ...cors,
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('content-disposition') || 'attachment',
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return reply({ error: 'Invalid support response' }, 502); }
  if (upstreamUrl.pathname === '/internal/admin/support/upload' && upstream.ok) {
    for (const item of payload.result?.filelist || []) {
      item.cfinfo.url = `/functions/v1/honnmono-admin/support/upload/${encodeURIComponent(item.cfid)}`;
    }
  }
  return reply(payload, upstream.status);
}
