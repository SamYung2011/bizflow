// shopify-settings: 安全管理 Shopify 集成的 access_token
// 模式照 wa-unlock：解锁密码复用 wa_settings.admin_password（同一个 admin 密码）
// access_token 列被 migration 059 column-level lock、前端拉不到、必须走这条
// 环境变量自动注入：SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  action: "unlock" | "save" | "test-connection";
  pwd?: string;
  shop_domain?: string;
  access_token?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function normalizeDomain(s: string): string {
  return s.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 验密码：复用 wa_settings.admin_password
  const { data: wa, error: waErr } = await supabase
    .from("wa_settings")
    .select("admin_password")
    .eq("id", 1)
    .maybeSingle();
  if (waErr) return json({ error: `Read wa_settings failed: ${waErr.message}` }, 500);
  const currentPwd = wa?.admin_password || "";
  if (!currentPwd) return json({ error: "Admin password not set", needsInitialPassword: true }, 401);
  if (!body.pwd || body.pwd !== currentPwd) return json({ error: "Wrong password" }, 401);

  // ── action: unlock ───────────────────────────────────────────────────────
  if (body.action === "unlock") {
    const { data, error } = await supabase
      .from("shopify_settings")
      .select("shop_domain, access_token, api_version, last_synced_at")
      .eq("id", 1)
      .maybeSingle();
    if (error) return json({ error: `Read failed: ${error.message}` }, 500);
    return json({
      ok: true,
      shop_domain: data?.shop_domain || "",
      access_token: data?.access_token || "",
      api_version: data?.api_version || "2025-01",
      last_synced_at: data?.last_synced_at || null,
    });
  }

  // ── action: save ─────────────────────────────────────────────────────────
  if (body.action === "save") {
    const patch: Record<string, string> = { updated_at: new Date().toISOString() };
    if (typeof body.shop_domain === "string") {
      patch.shop_domain = body.shop_domain.trim() ? normalizeDomain(body.shop_domain) : "";
    }
    if (typeof body.access_token === "string") {
      patch.access_token = body.access_token.trim();
    }
    if (Object.keys(patch).length === 1) return json({ error: "Nothing to update" }, 400);
    const { error: updErr } = await supabase
      .from("shopify_settings")
      .update(patch)
      .eq("id", 1);
    if (updErr) return json({ error: `Update failed: ${updErr.message}` }, 500);
    return json({ ok: true });
  }

  // ── action: test-connection ──────────────────────────────────────────────
  // 用前端传过来的 shop_domain + access_token 直接试一下；不传就读 DB 里的
  if (body.action === "test-connection") {
    let domain = (body.shop_domain || "").trim();
    let token = (body.access_token || "").trim();
    let version = "2025-01";
    if (!domain || !token) {
      const { data, error } = await supabase
        .from("shopify_settings")
        .select("shop_domain, access_token, api_version")
        .eq("id", 1)
        .maybeSingle();
      if (error) return json({ error: `Read failed: ${error.message}` }, 500);
      domain = domain || data?.shop_domain || "";
      token = token || data?.access_token || "";
      version = data?.api_version || version;
    }
    if (!domain) return json({ error: "Missing shop_domain" }, 400);
    if (!token) return json({ error: "Missing access_token" }, 400);

    const url = `https://${normalizeDomain(domain)}/admin/api/${version}/graphql.json`;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query: `{ shop { name myshopifyDomain currencyCode } }` }),
      });
      const text = await r.text();
      if (!r.ok) {
        return json({ ok: false, status: r.status, body: text.slice(0, 500) }, 200);
      }
      let parsed: { data?: { shop?: { name?: string; myshopifyDomain?: string; currencyCode?: string } }; errors?: unknown };
      try { parsed = JSON.parse(text); } catch { return json({ ok: false, status: r.status, body: text.slice(0, 500) }, 200); }
      if (parsed.errors) return json({ ok: false, errors: parsed.errors }, 200);
      return json({ ok: true, shop: parsed.data?.shop || null });
    } catch (e) {
      return json({ ok: false, error: String((e as Error).message || e) }, 200);
    }
  }

  return json({ error: "Unknown action" }, 400);
});
