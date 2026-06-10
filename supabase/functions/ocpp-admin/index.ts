// ocpp-admin: admin-only bridge from BizFlow to the internal chargecms read API.
//
// Phase 1 routes:
//   GET /ocpp-admin/stations
//   GET /ocpp-admin/stations/{id}
//   GET /ocpp-admin/public-piles
//   GET /ocpp-admin/private-piles
//   GET /ocpp-admin/alarms
//   GET /ocpp-admin/operators
//   GET /ocpp-admin/orders
//   GET /ocpp-admin/orders/{userId}/{orderId}
//   GET /ocpp-admin/command-logs
//   GET /ocpp-admin/charge-users
//   GET /ocpp-admin/charge-user-tags
//   GET /ocpp-admin/firmware
//   GET /ocpp-admin/finance/recharges
//   GET /ocpp-admin/finance/refunds
//   GET /ocpp-admin/finance/user-money-logs
//   GET /ocpp-admin/finance/operator-money-logs
//   GET /ocpp-admin/finance/platform-money-logs
//   GET /ocpp-admin/finance/withdrawals
//   GET /ocpp-admin/reports/charging
//   GET /ocpp-admin/share/charges
//   GET /ocpp-admin/share/prices/{shareId}
//   GET /ocpp-admin/share/income
//   GET /ocpp-admin/share/bookings
//   GET /ocpp-admin/ocpp/logs
//   GET /ocpp-admin/ocpp/logs/{id}
//
// Auth:
//   1. Validate caller JWT via Supabase auth/v1/user.
//   2. Use service_role to require employees.is_admin === true.
//   3. Forward to chargecms-readapi with X-Internal-Token.
//
// This function must not talk to MySQL and must not expose internal tokens.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const READAPI_BASE_URL = (Deno.env.get("CHARGECMS_READAPI_URL") ?? "http://172.18.0.1:8084").replace(/\/+$/, "");
const INTERNAL_TOKEN = Deno.env.get("OCPP_ADMIN_INTERNAL_TOKEN") ?? "";
const TOTAL_DEADLINE_MS = 15_000;
const READAPI_TIMEOUT_MS = 5_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

type GuardResult = { ok: true } | { ok: false; status: number; error: string };

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

function isAllowedUpstream(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    url.hostname === "172.18.0.1" &&
    url.port === "8084"
  );
}

function stripFunctionPrefix(pathname: string) {
  return pathname.replace(/^\/ocpp-admin(?=\/|$)/, "") || "/";
}

function bearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

function requireEnv() {
  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !READAPI_BASE_URL ||
    INTERNAL_TOKEN.length < 32
  ) {
    return false;
  }
  try {
    return isAllowedUpstream(new URL(READAPI_BASE_URL));
  } catch {
    return false;
  }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number, deadline?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  deadline?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyAdmin(req: Request, deadline: AbortSignal): Promise<GuardResult> {
  if (!requireEnv()) return { ok: false, status: 500, error: "Server misconfigured" };

  const jwt = bearerToken(req);
  if (!jwt) return { ok: false, status: 401, error: "Missing Bearer token" };

  let userId = "";
  try {
    const userRes = await fetchJson(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          authorization: `Bearer ${jwt}`,
          apikey: SUPABASE_ANON_KEY,
        },
      },
      5_000,
      deadline
    );
    if (!userRes.ok) return { ok: false, status: 401, error: "Invalid token" };
    const userBody = await userRes.json();
    userId = userBody?.id ?? "";
  } catch {
    return { ok: false, status: 401, error: "Invalid token" };
  }

  if (!userId) return { ok: false, status: 401, error: "Invalid token" };

  try {
    const employeeUrl = new URL(`${SUPABASE_URL}/rest/v1/employees`);
    employeeUrl.searchParams.set("user_id", `eq.${userId}`);
    employeeUrl.searchParams.set("select", "is_admin");
    employeeUrl.searchParams.set("limit", "1");

    const employeeRes = await fetchJson(
      employeeUrl.toString(),
      {
        headers: {
          authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
        },
      },
      5_000,
      deadline
    );
    if (!employeeRes.ok) return { ok: false, status: 500, error: "Admin lookup failed" };
    const rows = await employeeRes.json();
    if (rows?.[0]?.is_admin !== true) return { ok: false, status: 403, error: "Not authorized" };
    return { ok: true };
  } catch {
    return { ok: false, status: 500, error: "Admin lookup failed" };
  }
}

function mapPath(pathname: string) {
  if (pathname === "/stations") return "/api/stations";
  if (/^\/stations\/[1-9]\d*$/.test(pathname)) return `/api${pathname}`;
  if (pathname === "/public-piles") return "/api/public-piles";
  if (pathname === "/private-piles") return "/api/private-piles";
  if (pathname === "/alarms") return "/api/alarms";
  if (pathname === "/operators") return "/api/operators";
  if (pathname === "/orders") return "/api/orders";
  if (/^\/orders\/\d+\/\d+$/.test(pathname)) return `/api${pathname}`;
  if (pathname === "/command-logs") return "/api/command-logs";
  if (pathname === "/charge-users") return "/api/charge-users";
  if (pathname === "/charge-user-tags") return "/api/charge-user-tags";
  if (pathname === "/firmware") return "/api/firmware";
  if (pathname === "/finance/recharges") return "/api/finance/recharges";
  if (pathname === "/finance/refunds") return "/api/finance/refunds";
  if (pathname === "/finance/user-money-logs") return "/api/finance/user-money-logs";
  if (pathname === "/finance/operator-money-logs") return "/api/finance/operator-money-logs";
  if (pathname === "/finance/platform-money-logs") return "/api/finance/platform-money-logs";
  if (pathname === "/finance/withdrawals") return "/api/finance/withdrawals";
  if (pathname === "/reports/charging") return "/api/reports/charging";
  if (pathname === "/share/charges") return "/api/share/charges";
  if (/^\/share\/prices\/[1-9]\d*$/.test(pathname)) return `/api${pathname}`;
  if (pathname === "/share/income") return "/api/share/income";
  if (pathname === "/share/bookings") return "/api/share/bookings";
  if (pathname === "/piles") return "/api/piles";
  if (pathname === "/ocpp/logs") return "/api/ocpp/logs";
  if (/^\/ocpp\/logs\/[1-9]\d*$/.test(pathname)) return `/api${pathname}`;
  return "";
}

Deno.serve(async (req) => {
  const deadline = AbortSignal.timeout(TOTAL_DEADLINE_MS);

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const guard = await verifyAdmin(req, deadline);
  if (!guard.ok) return json({ error: guard.error }, guard.status);

  const url = new URL(req.url);
  const path = stripFunctionPrefix(url.pathname);
  const upstreamPath = mapPath(path);
  if (!upstreamPath) return json({ error: "Not found" }, 404);

  const upstreamUrl = new URL(`${READAPI_BASE_URL}${upstreamPath}`);
  for (const [key, value] of url.searchParams.entries()) {
    upstreamUrl.searchParams.append(key, value);
  }
  if (!isAllowedUpstream(upstreamUrl)) return json({ error: "Server misconfigured" }, 500);

  let upstream: Response;
  let text: string;
  try {
    const readApiController = new AbortController();
    const readApiTimeout = setTimeout(() => readApiController.abort(), READAPI_TIMEOUT_MS);
    deadline.addEventListener("abort", () => readApiController.abort(), { once: true });
    upstream = await fetch(upstreamUrl, {
      headers: { "X-Internal-Token": INTERNAL_TOKEN },
      signal: readApiController.signal,
    }).finally(() => clearTimeout(readApiTimeout));
    text = await upstream.text();
  } catch {
    return json({ error: "Read service timeout" }, 504);
  }

  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "Read service invalid response" }, 502);
    }
  }
  if (upstream.status === 403 || upstream.status === 404) return json({ error: "Read service unavailable" }, 502);
  return json(body, upstream.status);
});
