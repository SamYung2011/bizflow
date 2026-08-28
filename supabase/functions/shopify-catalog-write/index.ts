import {
  corsHeaders,
  inspectShopifyCredentialHealth,
  jsonResponse,
  loadShopifyCredentials,
  requireBizflowAdmin,
  requireShopifyWriteReady,
  sanitizeError,
} from "../_shared/shopify-admin.ts";
import {
  buildAlignmentPlan,
  confirmCatalogBinding,
  executeCatalogWrite,
  linkShopifyVariantsFromAliases,
  mutateComponentLink,
  saveResourceMapping,
} from "./catalog.ts";
import {
  cleanupCatalogImage,
  ensureCatalogImageForWrite,
  prepareCatalogImageUpload,
  verifyCatalogImage,
} from "./image.ts";

type Payload = Record<string, unknown> & {
  action?: "health" | "alignment-plan" | "create" | "update" | "delete" |
    "confirm-binding" | "link-component" | "unlink-component" | "save-resource-mapping" |
    "link-from-aliases" | "prepare-image-upload" | "verify-image-upload" | "cleanup-image-upload";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { ok: false, error: "Method not allowed" }, 405);

  const auth = await requireBizflowAdmin(req);
  if (!auth.ok) return jsonResponse(req, { ok: false, error: auth.error }, auth.status);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { ok: false, error: "Invalid JSON" }, 400);
  }

  const health = await inspectShopifyCredentialHealth(auth.admin);
  if (body.action === "health") return jsonResponse(req, { ok: true, health });
  if (!health.connected || !health.readReady) {
    return jsonResponse(req, {
      ok: false,
      code: "SHOPIFY_READ_CREDENTIAL_NOT_READY",
      error: "Shopify read credential is not ready",
      health,
    }, 200);
  }

  const credentials = await loadShopifyCredentials(auth.admin);
  if (!credentials) return jsonResponse(req, { ok: false, code: "SHOPIFY_NOT_CONFIGURED", health }, 200);

  try {
    if (body.action === "alignment-plan") {
      const alignment = await buildAlignmentPlan(auth.admin, credentials);
      return jsonResponse(req, { ok: true, health, alignment });
    }
    if (body.action === "confirm-binding") {
      const result = await confirmCatalogBinding(auth.admin, credentials, auth.userId, body);
      return jsonResponse(req, { ...result, health });
    }
    if (body.action === "link-component" || body.action === "unlink-component") {
      const result = await mutateComponentLink(
        auth.admin,
        body.action === "link-component" ? "link" : "unlink",
        body,
      );
      return jsonResponse(req, { ...result, health });
    }
    if (body.action === "link-from-aliases") {
      const result = await linkShopifyVariantsFromAliases(auth.admin, credentials, body.confirm === true);
      return jsonResponse(req, { ...result, health });
    }
    if (body.action === "save-resource-mapping") {
      const result = await saveResourceMapping(auth.admin, auth.userId, body);
      return jsonResponse(req, { ...result, health });
    }
    if (body.action === "prepare-image-upload" || body.action === "verify-image-upload" ||
      body.action === "cleanup-image-upload") {
      // Image writes share the exact catalogue readiness gate: a user cannot
      // stockpile signed URLs while the Shopify write chain is unavailable.
      requireShopifyWriteReady(health);
      const result = body.action === "prepare-image-upload"
        ? await prepareCatalogImageUpload(auth.admin, body)
        : body.action === "verify-image-upload"
        ? { ok: true, image: await verifyCatalogImage(auth.admin, body.path || body.publicUrl) }
        : await cleanupCatalogImage(auth.admin, body.path || body.publicUrl);
      return jsonResponse(req, { ...result, health });
    }
    if (body.action === "create" || body.action === "update" || body.action === "delete") {
      // Credential readiness is a precondition, not a failed catalogue job. With the
      // current read-only token the UI stays explicitly disabled and no local data moves.
      requireShopifyWriteReady(health);
      if (body.action !== "delete") {
        await ensureCatalogImageForWrite(auth.admin, body.action, body);
      }
      const result = await executeCatalogWrite(auth.admin, credentials, auth.userId, body.action, body);
      return jsonResponse(req, { ...result, health }, result.ok === false ? 409 : 200);
    }
    return jsonResponse(req, { ok: false, error: "Unknown action" }, 400);
  } catch (error) {
    const code = (error as Error & { code?: string }).code ||
      (sanitizeError(error).includes("SHOPIFY_WRITE_CREDENTIAL_NOT_READY") ? "SHOPIFY_WRITE_CREDENTIAL_NOT_READY" : "SHOPIFY_CATALOG_WRITE_FAILED");
    const status = code === "SHOPIFY_WRITE_CREDENTIAL_NOT_READY" ? 200 :
      sanitizeError(error).includes("CONFLICT") ? 409 : 400;
    return jsonResponse(req, { ok: false, code, error: sanitizeError(error), health }, status);
  }
});
