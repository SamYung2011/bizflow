import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const SHOPIFY_API_VERSION = Deno.env.get("SHOPIFY_API_VERSION") || "2026-07";
export const SHOPIFY_EXPECTED_DOMAIN = "honnmonoshop.myshopify.com";
export const SHOPIFY_READ_SCOPES = ["read_orders", "read_products", "read_inventory", "read_locations"] as const;
export const SHOPIFY_WRITE_SCOPES = ["write_products", "write_inventory"] as const;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGINS = new Set([
  "https://bizflow.honnmono.top",
  "https://team.honnmono.top",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173",
]);

export interface ShopifyCredentials {
  domain: string;
  token: string;
  apiVersion: string;
  source: "edge_secret" | "database_fallback";
}

export interface ShopifyCredentialHealth {
  configured: boolean;
  connected: boolean;
  readReady: boolean;
  writeReady: boolean;
  domain: string;
  apiVersion: string;
  source: ShopifyCredentials["source"] | "none";
  shopName: string;
  currencyCode: string;
  grantedScopes: string[];
  missingReadScopes: string[];
  missingWriteScopes: string[];
  checkedAt: string;
  error?: string;
}

export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function bearerToken(req: Request): string {
  const value = req.headers.get("authorization") || "";
  return value.replace(/^Bearer\s+/i, "").trim();
}

export async function requireBizflowAdmin(req: Request, admin = serviceClient()) {
  const token = bearerToken(req);
  if (!token) return { ok: false as const, status: 401, error: "Authentication required" };
  const auth = await admin.auth.getUser(token);
  if (auth.error || !auth.data.user) return { ok: false as const, status: 401, error: "Invalid session" };
  const employee = await admin.from("employees")
    .select("id,is_admin,is_super_admin,bizflow_main_access")
    .eq("user_id", auth.data.user.id)
    .maybeSingle();
  if (employee.error) return { ok: false as const, status: 500, error: "Unable to verify administrator" };
  if (employee.data?.is_admin !== true && employee.data?.is_super_admin !== true) {
    return { ok: false as const, status: 403, error: "BizFlow administrator required" };
  }
  if (employee.data?.bizflow_main_access !== true) {
    return { ok: false as const, status: 403, error: "BizFlow main access required" };
  }
  return {
    ok: true as const,
    userId: auth.data.user.id,
    employeeId: employee.data.id as string,
    admin,
  };
}

function normalizeDomain(value: unknown): string {
  return String(value || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
}

export async function loadShopifyCredentials(admin = serviceClient()): Promise<ShopifyCredentials | null> {
  const envDomain = normalizeDomain(Deno.env.get("SHOPIFY_SHOP_DOMAIN"));
  const envToken = String(Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN") || "").trim();
  if (envDomain && envToken) {
    return { domain: envDomain, token: envToken, apiVersion: SHOPIFY_API_VERSION, source: "edge_secret" };
  }

  // Transitional read-only fallback. Remove after the env-secret cutover and DB-token cleanup.
  const settings = await admin.from("shopify_settings")
    .select("shop_domain,access_token")
    .eq("id", 1)
    .maybeSingle();
  if (settings.error) throw new Error("Unable to read Shopify configuration");
  const domain = normalizeDomain(settings.data?.shop_domain);
  const token = String(settings.data?.access_token || "").trim();
  if (!domain || !token) return null;
  return {
    domain,
    token,
    apiVersion: SHOPIFY_API_VERSION,
    source: "database_fallback",
  };
}

export async function shopifyGraphQL<T = Record<string, unknown>>(
  credentials: ShopifyCredentials,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  if (credentials.domain !== SHOPIFY_EXPECTED_DOMAIN) throw new Error("Unexpected Shopify shop domain");
  const response = await fetch(
    `https://${credentials.domain}/admin/api/${credentials.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": credentials.token,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const raw = await response.text();
  let parsed: { data?: T; errors?: Array<{ message?: string }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Shopify returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(`Shopify HTTP ${response.status}`);
  if (parsed.errors?.length) throw new Error(parsed.errors.map((error) => error.message || "GraphQL error").join("; "));
  if (!parsed.data) throw new Error("Shopify response contained no data");
  return parsed.data;
}

const HEALTH_QUERY = `
  query ShopifyCredentialHealth {
    shop { name myshopifyDomain currencyCode }
    currentAppInstallation { accessScopes { handle } }
  }
`;

export async function inspectShopifyCredentialHealth(admin = serviceClient()): Promise<ShopifyCredentialHealth> {
  const checkedAt = new Date().toISOString();
  let credentials: ShopifyCredentials | null = null;
  try {
    credentials = await loadShopifyCredentials(admin);
    if (!credentials) {
      return {
        configured: false, connected: false, readReady: false, writeReady: false,
        domain: "", apiVersion: SHOPIFY_API_VERSION, source: "none", shopName: "", currencyCode: "",
        grantedScopes: [], missingReadScopes: [...SHOPIFY_READ_SCOPES], missingWriteScopes: [...SHOPIFY_WRITE_SCOPES], checkedAt,
      };
    }
    if (credentials.domain !== SHOPIFY_EXPECTED_DOMAIN) throw new Error("Configured shop is not honnmonoshop.myshopify.com");
    const data = await shopifyGraphQL<{
      shop?: { name?: string; myshopifyDomain?: string; currencyCode?: string };
      currentAppInstallation?: { accessScopes?: Array<{ handle?: string }> };
    }>(credentials, HEALTH_QUERY);
    const grantedScopes = (data.currentAppInstallation?.accessScopes || []).map((scope) => String(scope.handle || "")).filter(Boolean).sort();
    const granted = new Set(grantedScopes);
    const missingReadScopes = SHOPIFY_READ_SCOPES.filter((scope) => !granted.has(scope));
    const missingWriteScopes = SHOPIFY_WRITE_SCOPES.filter((scope) => !granted.has(scope));
    return {
      configured: true,
      connected: true,
      readReady: missingReadScopes.length === 0,
      writeReady: missingWriteScopes.length === 0,
      domain: String(data.shop?.myshopifyDomain || credentials.domain),
      apiVersion: credentials.apiVersion,
      source: credentials.source,
      shopName: String(data.shop?.name || ""),
      currencyCode: String(data.shop?.currencyCode || ""),
      grantedScopes,
      missingReadScopes,
      missingWriteScopes,
      checkedAt,
    };
  } catch (error) {
    return {
      configured: Boolean(credentials), connected: false, readReady: false, writeReady: false,
      domain: credentials?.domain || "", apiVersion: credentials?.apiVersion || SHOPIFY_API_VERSION,
      source: credentials?.source || "none", shopName: "", currencyCode: "", grantedScopes: [],
      missingReadScopes: [...SHOPIFY_READ_SCOPES], missingWriteScopes: [...SHOPIFY_WRITE_SCOPES], checkedAt,
      error: String((error as Error)?.message || error).slice(0, 300),
    };
  }
}

export function requireShopifyWriteReady(health: ShopifyCredentialHealth): void {
  if (!health.writeReady) {
    const error = new Error("Shopify write credential is not ready") as Error & { code?: string };
    error.code = "SHOPIFY_WRITE_CREDENTIAL_NOT_READY";
    throw error;
  }
}

export function sanitizeError(error: unknown): string {
  return String((error as Error)?.message || error || "Unknown error")
    .replace(/shpat_[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 1000);
}
