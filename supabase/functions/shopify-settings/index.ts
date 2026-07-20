// Shopify integration status only. Credentials live in Edge secrets and are never returned.

import {
  corsHeaders,
  inspectShopifyCredentialHealth,
  jsonResponse,
  requireBizflowAdmin,
} from "../_shared/shopify-admin.ts";

interface Payload {
  action?: "status" | "test-connection" | "unlock" | "save";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { ok: false, error: "Method not allowed" }, 405);

  const auth = await requireBizflowAdmin(req);
  if (!auth.ok) return jsonResponse(req, { ok: false, error: auth.error }, auth.status);

  let body: Payload = {};
  try { body = await req.json(); } catch { /* status remains safe without a body */ }
  const health = await inspectShopifyCredentialHealth(auth.admin);

  if (body.action === "save") {
    return jsonResponse(req, {
      ok: false,
      code: "SHOPIFY_CREDENTIALS_SERVER_MANAGED",
      error: "Shopify credentials are managed through Edge secrets",
      health,
    }, 410);
  }

  // Keep legacy callers non-breaking, but never disclose the token. `unlock` now
  // means unlock the status panel, not unlock a plaintext credential editor.
  if ([undefined, "status", "test-connection", "unlock"].includes(body.action)) {
    return jsonResponse(req, {
      ok: true,
      configured: health.configured,
      shop_domain: health.domain,
      api_version: health.apiVersion,
      access_token: "",
      credential_source: health.source,
      health,
    });
  }

  return jsonResponse(req, { ok: false, error: "Unknown action" }, 400);
});
