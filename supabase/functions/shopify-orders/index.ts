// shopify-orders: poll recent paid Shopify orders into BizFlow invoices.
//
// Safety boundaries:
// - Query only order metadata, totals, line items, variant IDs, and customer.id.
// - Do not request customer name/email/phone or billing/shipping addresses.
// - Inventory deduction is handled by shopify_sync_order_api() using shopify_variant_links.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_API_VERSION = "2025-01";
const PAGE_SIZE = 50;
const MAX_PAGES = 5;
const OVERLAP_MINUTES = 10;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  dryRun?: boolean;
  backfillMinutes?: number;
  maxPages?: number;
}

interface ShopifyMoney {
  amount?: string;
  currencyCode?: string;
}

interface ShopifyOrderNode {
  id: string;
  name: string;
  createdAt: string;
  processedAt?: string | null;
  updatedAt: string;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  currencyCode?: string | null;
  customer?: { id?: string | null } | null;
  totalPriceSet?: { shopMoney?: ShopifyMoney | null } | null;
  subtotalPriceSet?: { shopMoney?: ShopifyMoney | null } | null;
  lineItems?: {
    pageInfo?: { hasNextPage?: boolean };
    edges?: Array<{
      node: {
        id: string;
        title?: string | null;
        name?: string | null;
        quantity?: number | null;
        sku?: string | null;
        variant?: {
          id?: string | null;
          sku?: string | null;
          title?: string | null;
          product?: { id?: string | null; title?: string | null } | null;
        } | null;
        originalUnitPriceSet?: { shopMoney?: ShopifyMoney | null } | null;
        discountedUnitPriceSet?: { shopMoney?: ShopifyMoney | null } | null;
      };
    }>;
  } | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function bearerToken(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.headers.get("apikey") || "";
}

function requireServiceRole(req: Request): Response | null {
  if (!SERVICE_KEY) return json({ error: "Service key not configured" }, 500);
  if (bearerToken(req) !== SERVICE_KEY) return json({ error: "Unauthorized" }, 401);
  return null;
}

async function shopifyGraphQL(
  domain: string,
  token: string,
  apiVersion: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data?: unknown; errors?: unknown }> {
  const url = `https://${domain}/admin/api/${apiVersion}/graphql.json`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Shopify HTTP ${r.status}: ${text.slice(0, 300)}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Shopify non-JSON response: ${text.slice(0, 300)}`);
  }
  if (parsed.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(parsed.errors).slice(0, 300)}`);
  return parsed;
}

const RECENT_ORDERS_QUERY = `
  query RecentOrders($cursor: String, $query: String!) {
    orders(first: 50, after: $cursor, query: $query, sortKey: UPDATED_AT, reverse: false) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          name
          createdAt
          processedAt
          updatedAt
          displayFinancialStatus
          displayFulfillmentStatus
          currencyCode
          customer { id }
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 100) {
            pageInfo { hasNextPage }
            edges {
              node {
                id
                title
                name
                quantity
                sku
                variant {
                  id
                  sku
                  title
                  product { id title }
                }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                discountedUnitPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
      }
    }
  }
`;

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function clampInt(n: unknown, fallback: number, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

function orderQuerySince(sinceIso: string): string {
  // PII-free query. Only paid orders should become paid BizFlow invoices.
  return `updated_at:>=${sinceIso} financial_status:paid`;
}

function normalizeLineItems(order: ShopifyOrderNode) {
  return (order.lineItems?.edges || []).map((edge) => {
    const n = edge.node;
    const variant = n.variant || {};
    const product = variant.product || {};
    return {
      id: n.id,
      title: n.title || "",
      name: n.name || n.title || product.title || "",
      quantity: Number(n.quantity || 0) || 0,
      sku: n.sku || variant.sku || null,
      shopify_variant_id: variant.id || null,
      shopify_product_id: product.id || null,
      variant_title: variant.title || null,
      product_title: product.title || null,
      original_unit_price: n.originalUnitPriceSet?.shopMoney?.amount || null,
      discounted_unit_price: n.discountedUnitPriceSet?.shopMoney?.amount || null,
      currency: n.discountedUnitPriceSet?.shopMoney?.currencyCode
        || n.originalUnitPriceSet?.shopMoney?.currencyCode
        || order.currencyCode
        || null,
    };
  });
}

function invoiceNumberFromOrderName(name: string): string {
  return String(name || "").replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const unauthorized = requireServiceRole(req);
  if (unauthorized) return unauthorized;

  let body: Payload = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const dryRun = body.dryRun === true;
  const maxPages = clampInt(body.maxPages, MAX_PAGES, 1, 20);
  const backfillMinutes = body.backfillMinutes == null
    ? null
    : clampInt(body.backfillMinutes, 0, 1, 60 * 24 * 30);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: settings, error: setErr } = await supabase
    .from("shopify_settings")
    .select("shop_domain, access_token, api_version")
    .eq("id", 1)
    .maybeSingle();
  if (setErr) return json({ error: `Read shopify_settings failed: ${setErr.message}` }, 500);

  const domain = settings?.shop_domain || "";
  const token = settings?.access_token || "";
  const apiVersion = settings?.api_version || DEFAULT_API_VERSION;
  if (!domain || !token) return json({ error: "Shopify not configured" }, 400);

  const runStartedAt = new Date();

  const { data: state, error: stateErr } = await supabase
    .from("shopify_order_sync_state")
    .select("id, started_at, last_polled_at")
    .eq("id", 1)
    .maybeSingle();
  if (stateErr) return json({ error: `Read sync state failed: ${stateErr.message}` }, 500);

  if (!state && backfillMinutes == null) {
    const { error: initErr } = await supabase
      .from("shopify_order_sync_state")
      .upsert({
        id: 1,
        started_at: runStartedAt.toISOString(),
        last_polled_at: runStartedAt.toISOString(),
        last_success_at: runStartedAt.toISOString(),
        last_error: null,
        updated_at: runStartedAt.toISOString(),
      });
    if (initErr) return json({ error: `Initialize sync state failed: ${initErr.message}` }, 500);
    return json({ ok: true, initialized: true, processed: 0, message: "Initialized from now; no history backfill." });
  }

  const sinceIso = backfillMinutes != null
    ? isoMinutesAgo(backfillMinutes)
    : new Date(
      new Date(state?.last_polled_at || runStartedAt.toISOString()).getTime() - OVERLAP_MINUTES * 60_000,
    ).toISOString();

  const processed: Array<{ shopify_order_id: string; invoice_number: string; result?: unknown; dryRun?: boolean }> = [];
  const failed: Array<{ shopify_order_id: string; invoice_number: string; error: string }> = [];
  const warnings: Array<{ shopify_order_id: string; invoice_number: string; warning: string }> = [];

  let cursor: string | null = null;
  let pageCount = 0;
  let fetched = 0;

  try {
    for (pageCount = 0; pageCount < maxPages; pageCount++) {
      const resp = await shopifyGraphQL(domain, token, apiVersion, RECENT_ORDERS_QUERY, {
        cursor,
        query: orderQuerySince(sinceIso),
      });
      const orders = (resp.data as {
        orders?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          edges?: Array<{ node: ShopifyOrderNode }>;
        };
      })?.orders;
      if (!orders?.edges) break;

      for (const edge of orders.edges) {
        const order = edge.node;
        fetched += 1;
        const invoiceNumber = invoiceNumberFromOrderName(order.name);
        const shopifyOrderId = order.id;

        try {
          if (!invoiceNumber) throw new Error(`Invalid order name: ${order.name}`);
          if (order.lineItems?.pageInfo?.hasNextPage) {
            warnings.push({
              shopify_order_id: shopifyOrderId,
              invoice_number: invoiceNumber,
              warning: "line_items_truncated_after_100",
            });
          }

          const items = normalizeLineItems(order);
          const total = Number(order.totalPriceSet?.shopMoney?.amount || 0);
          const notes = [
            `Shopify order ${order.name}`,
            `financial=${order.displayFinancialStatus || ""}`,
            `fulfillment=${order.displayFulfillmentStatus || ""}`,
          ].join(" | ");

          if (dryRun) {
            processed.push({
              shopify_order_id: shopifyOrderId,
              invoice_number: invoiceNumber,
              dryRun: true,
              customer_id_present: Boolean(order.customer?.id),
              line_items_count: items.length,
              line_items_with_variant_id_count: items.filter((item) => Boolean(item.shopify_variant_id)).length,
              total: Number.isFinite(total) ? total : 0,
              currency: order.totalPriceSet?.shopMoney?.currencyCode || order.currencyCode || null,
              first_variant_id_sample: items.find((item) => Boolean(item.shopify_variant_id))?.shopify_variant_id || null,
            });
            continue;
          }

          const { data, error } = await supabase.rpc("shopify_sync_order_api", {
            p_shopify_order_id: shopifyOrderId,
            p_shopify_customer_id: order.customer?.id || null,
            p_invoice_number: invoiceNumber,
            p_date: order.processedAt || order.createdAt || order.updatedAt,
            p_items: items,
            p_total: Number.isFinite(total) ? total : 0,
            p_notes: notes,
          });
          if (error) throw new Error(error.message);

          processed.push({ shopify_order_id: shopifyOrderId, invoice_number: invoiceNumber, result: data });
        } catch (e) {
          failed.push({
            shopify_order_id: shopifyOrderId,
            invoice_number: invoiceNumber || "",
            error: String((e as Error).message || e),
          });
        }
      }

      if (!orders.pageInfo?.hasNextPage) break;
      cursor = orders.pageInfo.endCursor || null;
      if (!cursor) break;
    }

    if (!dryRun) {
      // If any order failed, keep the old waterline so the next cron retries the same window.
      // Successful orders are safe to re-see because shopify_sync_order_api is idempotent.
      const nextLastPolledAt = failed.length
        ? (state?.last_polled_at || sinceIso)
        : runStartedAt.toISOString();
      const { error: updateErr } = await supabase
        .from("shopify_order_sync_state")
        .upsert({
          id: 1,
          started_at: state?.started_at || runStartedAt.toISOString(),
          last_polled_at: nextLastPolledAt,
          last_success_at: runStartedAt.toISOString(),
          last_error: failed.length ? `${failed.length} order(s) failed` : null,
          updated_at: new Date().toISOString(),
        });
      if (updateErr) throw new Error(`Update sync state failed: ${updateErr.message}`);
    }

    return json({
      ok: true,
      dryRun,
      since: sinceIso,
      fetched,
      processedCount: processed.length,
      failedCount: failed.length,
      warningCount: warnings.length,
      pages: pageCount + 1,
      processed,
      failed,
      warnings,
    });
  } catch (e) {
    const message = String((e as Error).message || e);
    if (!dryRun) {
      const safeLastPolledAt = state?.last_polled_at || sinceIso || runStartedAt.toISOString();
      await supabase
        .from("shopify_order_sync_state")
        .upsert({
          id: 1,
          started_at: state?.started_at || runStartedAt.toISOString(),
          last_polled_at: safeLastPolledAt,
          last_error: message.slice(0, 1000),
          updated_at: new Date().toISOString(),
        });
    }
    return json({ ok: false, error: message, since: sinceIso, processed, failed, warnings }, 500);
  }
});
