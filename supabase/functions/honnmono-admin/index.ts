// honnmono-admin: admin-only JSON bridge from BizFlow to the Shenzhen App API.
//
// Routes:
//   GET  /honnmono-admin/feedback
//   GET  /honnmono-admin/feedback/{id}
//   POST /honnmono-admin/feedback/{id}/log-link
//   GET  /honnmono-admin/device/binding?imei={15 digits}
//   POST /honnmono-admin/device/unbind
//   GET  /honnmono-admin/ota/package
//   POST /honnmono-admin/ota/package
//   GET  /honnmono-admin/devices/{flash|dc-pro}
//   GET  /honnmono-admin/devices/{kind}/{certid}/sessions
//   GET  /honnmono-admin/devices/flash/{certid}/uploads/{id}
//   POST /honnmono-admin/devices/flash/{certid}/actions
//   POST /honnmono-admin/devices/flash/{certid}/unbind
//   GET  /honnmono-admin/ota/legacy-packages
//   POST /honnmono-admin/ota/legacy-packages/{slot}
//   GET  /honnmono-admin/sim/lookup?iccid={19-20}|msisdn={<=13 digits}
//   GET  /honnmono-admin/sim/cards?page&size&q
//   POST /honnmono-admin/sim/cards
//   POST /honnmono-admin/sim/cards/import
//   POST /honnmono-admin/sim/refresh
//
// Budgets: every upstream call gets 10 s and a 16 KB request body, except the
// device unbind (90 s), the SIM lookup and refresh (60 s each: Shenzhen chains
// five or six OneLink calls per lookup), and the SIM bulk import (64 KB: 500
// pasted lines run to roughly 22 KB).
//
// Log bytes are intentionally outside this allowlist. The link-issuance route
// returns a short-lived, one-time Shenzhen URL that the browser downloads
// directly, so files up to 200 MB never traverse the HK Edge Function.

import {
  MAX_REQUEST_JSON_BYTES,
  UPSTREAM_TIMEOUT_MS,
  isAllowedFlashAdminBase,
  isAllowedHonnmonoApiBase,
  isAllowedHonnmonoUpstream,
  isAllowedOtaAdminBase,
  mapHonnmonoAdminPath,
  mapFlashAdminPath,
  mapOtaAdminPath,
  maxRequestBytesFor,
  stripFunctionPrefix,
  upstreamTimeoutFor,
  validateOtaAdminBody,
} from "./routing.mjs";


const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HONNMONO_ADMIN_API_URL = (
  Deno.env.get("HONNMONO_ADMIN_API_URL") ?? ""
).replace(/\/+$/, "");
const HONNMONO_ADMIN_INTERNAL_TOKEN =
  Deno.env.get("HONNMONO_ADMIN_INTERNAL_TOKEN") ?? "";
const OTA_ADMIN_URL = (Deno.env.get("OTA_ADMIN_URL") ?? "").replace(/\/+$/, "");
const OTA_ADMIN_TOKEN = Deno.env.get("OTA_ADMIN_TOKEN") ?? "";
const FLASH_ADMIN_URL = (Deno.env.get("FLASH_ADMIN_URL") ?? "").replace(/\/+$/, "");
const FLASH_ADMIN_TOKEN = Deno.env.get("FLASH_ADMIN_TOKEN") ?? "";
const MAX_JSON_BYTES = 2_000_000;
const MAX_OTA_JSON_BYTES = 2_900_000;
const MAX_OTA_REQUEST_JSON_BYTES = 2_800_000;
// UPSTREAM_TIMEOUT_MS / MAX_REQUEST_JSON_BYTES are the defaults; the per-route
// exceptions (device unbind, SIM lookup/refresh, SIM bulk import) live in
// routing.mjs behind upstreamTimeoutFor() / maxRequestBytesFor() so the
// budgets stay testable from Node.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type GuardResult =
  | { ok: true; operatorEmail: string }
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

function requireAuthEnv() {
  return (
    Boolean(SUPABASE_URL) &&
    Boolean(SUPABASE_ANON_KEY) &&
    Boolean(SUPABASE_SERVICE_ROLE_KEY)
  );
}

function requireEnv() {
  return (
    requireAuthEnv() &&
    HONNMONO_ADMIN_INTERNAL_TOKEN.length >= 32 &&
    isAllowedHonnmonoApiBase(HONNMONO_ADMIN_API_URL)
  );
}

// verifyAdmin is copied from the deployed ocpp-proxy guard so its
// Supabase JWT -> employees.is_admin and 401/403 semantics remain identical.
async function verifyAdmin(req: Request): Promise<GuardResult> {
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
  let operatorEmail = "";
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
    operatorEmail = String(user?.email ?? "")
      .trim()
      .replace(/[\r\n]/g, "")
      .slice(0, 255);
    if (!operatorEmail) {
      return { ok: false, status: 401, error: "User email not found" };
    }
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
    return { ok: true, operatorEmail };
  } catch (_) {
    return { ok: false, status: 500, error: "Admin lookup failed" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const subPath = stripFunctionPrefix(url.pathname);
  const isLegacyPackageWrite =
    req.method === "POST" &&
    /^\/ota\/legacy-packages\/(150001|150002|150003|150004)$/.test(subPath);
  const isFlashAdminRequest =
    req.method === "POST" &&
    /^\/devices\/flash\/[A-Za-z0-9_-]{1,64}\/unbind\/?$/.test(subPath);
  const isOtaRequest =
    subPath === "/ota/package" ||
    (subPath.startsWith("/devices/flash") && !isFlashAdminRequest) ||
    isLegacyPackageWrite;
  const needsHonnmonoEnv =
    (!isOtaRequest && !isFlashAdminRequest) || isLegacyPackageWrite;
  if (
    !requireAuthEnv() ||
    (needsHonnmonoEnv && !requireEnv())
  ) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const guard: GuardResult = await verifyAdmin(req);
  if (!guard.ok) return json({ error: guard.error }, guard.status);

  if (isFlashAdminRequest) {
    const flashPath = mapFlashAdminPath(subPath, req.method);
    if (!flashPath) return json({ error: "Not found" }, 404);
    if (
      FLASH_ADMIN_TOKEN.length < 32 ||
      !isAllowedFlashAdminBase(FLASH_ADMIN_URL)
    ) {
      return json({ error: "Flash admin service unavailable" }, 503);
    }

    const requestLength = Number(req.headers.get("content-length") ?? "0");
    if (
      Number.isFinite(requestLength) &&
      requestLength > MAX_REQUEST_JSON_BYTES
    ) {
      return json({ error: "Request body too large" }, 413);
    }
    const flashBody = await req.text();
    if (
      new TextEncoder().encode(flashBody).byteLength > MAX_REQUEST_JSON_BYTES
    ) {
      return json({ error: "Request body too large" }, 413);
    }
    try {
      const parsed = JSON.parse(flashBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "Invalid JSON body" }, 400);
      }
    } catch (_) {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const flashUrl = new URL(flashPath, `${FLASH_ADMIN_URL}/`);
    let flashUpstream: Response;
    try {
      flashUpstream = await fetch(flashUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": FLASH_ADMIN_TOKEN,
          "X-Operator-Email": guard.operatorEmail,
        },
        body: flashBody,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (_) {
      return json({ error: "Flash admin service timeout" }, 504);
    }

    const flashText = await flashUpstream.text();
    if (new TextEncoder().encode(flashText).byteLength > MAX_JSON_BYTES) {
      return json({ error: "Flash admin service response too large" }, 502);
    }
    let flashResponse: unknown = null;
    try {
      flashResponse = flashText ? JSON.parse(flashText) : null;
    } catch (_) {
      return json({ error: "Flash admin service invalid response" }, 502);
    }
    if (flashUpstream.status === 401 || flashUpstream.status === 403) {
      return json({ error: "Flash admin service unavailable" }, 502);
    }
    return json(flashResponse, flashUpstream.status);
  }

  if (isOtaRequest) {
    const otaPath = mapOtaAdminPath(subPath, req.method);
    if (!otaPath) return json({ error: "Not found" }, 404);
    if (
      !OTA_ADMIN_URL ||
      !OTA_ADMIN_TOKEN ||
      !isAllowedOtaAdminBase(OTA_ADMIN_URL)
    ) {
      return json({ error: "OTA admin service unavailable" }, 503);
    }

    let otaBody: string | undefined;
    if (req.method === "POST") {
      const requestLength = Number(req.headers.get("content-length") ?? "0");
      if (
        Number.isFinite(requestLength) &&
        requestLength > MAX_OTA_REQUEST_JSON_BYTES
      ) {
        return json({ error: "Request body too large" }, 413);
      }
      otaBody = await req.text();
      if (
        new TextEncoder().encode(otaBody).byteLength >
        MAX_OTA_REQUEST_JSON_BYTES
      ) {
        return json({ error: "Request body too large" }, 413);
      }
      try {
        otaBody = validateOtaAdminBody(otaBody);
      } catch (_) {
        return json({ error: "Invalid JSON body" }, 400);
      }
    }

    const otaUpstreamUrl = new URL(otaPath, `${OTA_ADMIN_URL}/`);
    for (const [key, value] of url.searchParams.entries()) {
      otaUpstreamUrl.searchParams.append(key, value);
    }
    let otaUpstream: Response;
    try {
      otaUpstream = await fetch(otaUpstreamUrl, {
        method: req.method,
        headers: {
          "X-Internal-Token": OTA_ADMIN_TOKEN,
          "X-Operator-Email": guard.operatorEmail,
          ...(otaBody ? { "Content-Type": "application/json" } : {}),
        },
        body: otaBody || undefined,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (_) {
      return json({ error: "OTA admin service timeout" }, 504);
    }

    const otaText = await otaUpstream.text();
    if (new TextEncoder().encode(otaText).byteLength > MAX_OTA_JSON_BYTES) {
      return json({ error: "OTA admin service response too large" }, 502);
    }
    if (isLegacyPackageWrite) {
      let storedPackage: Record<string, unknown>;
      try {
        storedPackage = JSON.parse(otaText);
      } catch (_) {
        return json({ error: "OTA admin service invalid response" }, 502);
      }
      if (!otaUpstream.ok) {
        return json(storedPackage, otaUpstream.status);
      }
      const packageUrl = String(storedPackage?.url ?? "");
      const packageMd5 = String(storedPackage?.md5 ?? "");
      const shenzhenPath = mapHonnmonoAdminPath(subPath, req.method);
      if (!shenzhenPath) return json({ error: "Not found" }, 404);
      const shenzhenUrl = new URL(
        `${HONNMONO_ADMIN_API_URL}${shenzhenPath}`,
      );
      if (!isAllowedHonnmonoUpstream(shenzhenUrl)) {
        return json({ error: "Server misconfigured" }, 500);
      }
      let metadataResponse: Response;
      try {
        metadataResponse = await fetch(shenzhenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Token": HONNMONO_ADMIN_INTERNAL_TOKEN,
            "X-Operator-Email": guard.operatorEmail,
          },
          body: JSON.stringify({ url: packageUrl, md5: packageMd5 }),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      } catch (_) {
        return json(
          { error: "Honnmono metadata update timeout", storage: storedPackage },
          504,
        );
      }
      const metadataText = await metadataResponse.text();
      let metadataBody: unknown;
      try {
        metadataBody = metadataText ? JSON.parse(metadataText) : null;
      } catch (_) {
        return json(
          { error: "Honnmono metadata update invalid response", storage: storedPackage },
          502,
        );
      }
      if (!metadataResponse.ok) {
        return json(
          {
            error: "Honnmono metadata update failed",
            storage: storedPackage,
            metadata: metadataBody,
          },
          metadataResponse.status,
        );
      }
      return json({ storage: storedPackage, metadata: metadataBody });
    }
    return new Response(otaText, {
      status: otaUpstream.status,
      headers: {
        ...CORS_HEADERS,
        "Content-Type":
          otaUpstream.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  const upstreamPath = mapHonnmonoAdminPath(subPath, req.method);
  if (!upstreamPath) return json({ error: "Not found" }, 404);

  const upstreamUrl = new URL(`${HONNMONO_ADMIN_API_URL}${upstreamPath}`);
  for (const [key, value] of url.searchParams.entries()) {
    upstreamUrl.searchParams.append(key, value);
  }
  if (!isAllowedHonnmonoUpstream(upstreamUrl)) {
    return json({ error: "Server misconfigured" }, 500);
  }

  let upstreamBody: string | undefined;
  if (req.method === "POST") {
    const maxRequestBytes = maxRequestBytesFor(upstreamPath);
    const requestLength = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(requestLength) && requestLength > maxRequestBytes) {
      return json({ error: "Request body too large" }, 413);
    }
    upstreamBody = await req.text();
    if (
      new TextEncoder().encode(upstreamBody).byteLength > maxRequestBytes
    ) {
      return json({ error: "Request body too large" }, 413);
    }
    if (upstreamBody) {
      try {
        const parsed = JSON.parse(upstreamBody);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return json({ error: "Invalid JSON body" }, 400);
        }
      } catch (_) {
        return json({ error: "Invalid JSON body" }, 400);
      }
    }
  }

  let upstream: Response;
  const upstreamTimeoutMs = upstreamTimeoutFor(upstreamPath);
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        "X-Internal-Token": HONNMONO_ADMIN_INTERNAL_TOKEN,
        "X-Operator-Email": guard.operatorEmail,
        ...(upstreamBody ? { "Content-Type": "application/json" } : {}),
      },
      body: upstreamBody || undefined,
      signal: AbortSignal.timeout(upstreamTimeoutMs),
    });
  } catch (_) {
    return json({ error: "Honnmono admin service timeout" }, 504);
  }

  const contentLength = Number(upstream.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
    return json({ error: "Honnmono admin service response too large" }, 502);
  }

  const text = await upstream.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    return json({ error: "Honnmono admin service response too large" }, 502);
  }

  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_) {
      return json({ error: "Honnmono admin service invalid response" }, 502);
    }
  }
  if (upstream.status === 401 || upstream.status === 403) {
    return json({ error: "Honnmono admin service unavailable" }, 502);
  }
  return json(body, upstream.status);
});
