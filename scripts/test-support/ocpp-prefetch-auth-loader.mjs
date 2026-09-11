import { load as baseLoad } from './page-prefetch-auth-loader.mjs';
export async function load(url, context, nextLoad) {
  const result = await baseLoad(url, context, nextLoad);
  if (!new URL(url).pathname.endsWith('/root-site/data/auth.js')) return result;
  return { ...result, source: result.source
    .replace('const client = {', 'const client = { supabaseUrl: "https://fixture.invalid", supabaseKey: "fixture-anon",')
    .replace('return sessionUserId ? { user: { id: sessionUserId } }', 'return sessionUserId ? { access_token: token, user: { id: sessionUserId } }')
    + '\nlet token = "fixture-token-one"; export function __setToken(value) { token = value; }\n' };
}
