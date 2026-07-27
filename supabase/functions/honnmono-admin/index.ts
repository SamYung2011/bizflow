// honnmono-admin: admin-only JSON bridge from BizFlow to the Shenzhen App API.
//
// Routes:
//   GET  /honnmono-admin/feedback
//   GET  /honnmono-admin/feedback/{id}
//   POST /honnmono-admin/feedback/{id}/log-link
//
// Log bytes are intentionally outside this allowlist. The link-issuance route
// returns a short-lived, one-time Shenzhen URL that the browser downloads
// directly, so files up to 200 MB never traverse the HK Edge Function.

import {
  isAllowedHonnmonoApiBase,
  isAllowedHonnmonoUpstream,
  mapHonnmonoAdminPath,
  stripFunctionPrefix,
} from "./routing.mjs";


const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HONNMONO_ADMIN_API_URL = (
  Deno.env.get("HONNMONO_ADMIN_API_URL") ?? ""
).replace(/\/+$/, "");
const HONNMONO_ADMIN_INTERNAL_TOKEN =
  Deno.env.get("HONNMONO_ADMIN_INTERNAL_TOKEN") ?? "";
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_JSON_BYTES = 2_000_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type GuardResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function requireEnv() {
  return (
    Boolean(SUPABASE_URL) &&
    Boolean(SUPABASE_ANON_KEY) &&
    Boolean(SUPABASE_SERVICE_ROLE_KEY) &&
    HONNMONO_ADMIN_INTERNAL_TOKEN.length >= 32 &&
    isAllowedHonnmonoApiBase(HONNMONO_ADMIN_API_URL)
  );
}

// verifyAdmin is copied from the deployed ocpp-proxy guard so its
// Supabase JWT -> employees.is_admin and 401/403 semantics remain identical.
async function verifyAdmin(req: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, status: 500, error: "Server misconfigured" };
  }

  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, status: 401, error: "Missing Bearer token" };
  const jwt = m[1].trim();
  if (!jwt) return { ok: false, status: 401, error: "Missing Bearer token" };

  // 1) Resolve user via Supabase Auth REST
  let userId = "";
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        "Authorization": `Bearer ${jwt}`,
        "apikey": SUPABASE_ANON_KEY,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (r.status !== 200) return { ok: false, status: 401, error: "Invalid token" };
    const user = await r.json();
    userId = String(user?.id ?? "");
    if (!userId) return { ok: false, status: 401, error: "User not found" };
  } catch (_) {
    return { ok: false, status: 500, error: "Auth lookup failed" };
  }

  // 2) Look up employees.is_admin via service_role PostgREST query.
  //    user_id is a UUID, so URL-encode is fine; using eq.<uuid> form.
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/employees?user_id=eq.${encodeURIComponent(userId)}&select=is_admin&limit=1`,
      {
        headers: {
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (r.status !== 200) return { ok: false, status: 500, error: "Admin lookup failed" };
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, status: 403, error: "Not authorized" };
    if (rows[0]?.is_admin !== true) return { ok: false, status: 403, error: "Not authorized" };
    return { ok: true };
  } catch (_) {
    return { ok: false, status: 500, error: "Admin lookup failed" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (!requireEnv()) return json({ error: "Server misconfigured" }, 500);

  const guard: GuardResult = await verifyAdmin(req);
  if (!guard.ok) return json({ error: guard.error }, guard.status);

  const url = new URL(req.url);
  const subPath = stripFunctionPrefix(url.pathname);
  const upstreamPath = mapHonnmonoAdminPath(subPath, req.method);
  if (!upstreamPath) return json({ error: "Not found" }, 404);

  const upstreamUrl = new URL(`${HONNMONO_ADMIN_API_URL}${upstreamPath}`);
  for (const [key, value] of url.searchParams.entries()) {
    upstreamUrl.searchParams.append(key, value);
  }
  if (!isAllowedHonnmonoUpstream(upstreamUrl)) {
    return json({ error: "Server misconfigured" }, 500);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: { "X-Internal-Token": HONNMONO_ADMIN_INTERNAL_TOKEN },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (_) {
    return json({ error: "Feedback service timeout" }, 504);
  }

  const contentLength = Number(upstream.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
    return json({ error: "Feedback service response too large" }, 502);
  }

  const text = await upstream.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    return json({ error: "Feedback service response too large" }, 502);
  }

  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_) {
      return json({ error: "Feedback service invalid response" }, 502);
    }
  }
  if (upstream.status === 401 || upstream.status === 403) {
    return json({ error: "Feedback service unavailable" }, 502);
  }
  return json(body, upstream.status);
});
