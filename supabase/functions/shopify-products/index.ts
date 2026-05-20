// shopify-products: 从 Shopify Admin API 拉商品 + 后续 sync 到 bizflow
// 密码模式同 shopify-settings（复用 wa_settings.admin_password）
// Action 列表：
//   list   - 分页拉全量 active products + variants，返回数组（read-only，不改 DB）
//   sync   - 预留：按 shopify_variant_id / SKU 匹配 bizflow products、写回字段、新品自动建 + needs_review
//
// 单向：Shopify → bizflow（source of truth）。日后做反向写回时这里加 action 即可。

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2025-01";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  action: "list" | "sync" | "link" | "unlink" | "link-from-aliases";
  pwd?: string;
  confirm?: boolean;
  // link / unlink 参数
  bizflow_product_id?: string;
  shopify_product_id?: string;
  shopify_variant_id?: string;
  shopify_sku?: string | null;
}

// normalize 用于 alias_name 跟 Shopify variant displayName 文本匹配
function normalize(s: string | null | undefined): string {
  return String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

interface ShopifyVariant {
  id: string;
  sku: string | null;
  title: string;
  price: string | null;
  inventoryQuantity: number | null;
}

interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  totalInventory: number | null;
  variants: ShopifyVariant[];
  featuredImage: string | null;
  updatedAt: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function shopifyGraphQL(domain: string, token: string, query: string, variables: Record<string, unknown>): Promise<{ data?: unknown; errors?: unknown }> {
  const url = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Shopify HTTP ${r.status}: ${text.slice(0, 300)}`);
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`Shopify non-JSON response: ${text.slice(0, 300)}`); }
  if (parsed.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(parsed.errors).slice(0, 300)}`);
  return parsed;
}

const PRODUCTS_QUERY = `
  query ($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          status
          productType
          vendor
          tags
          totalInventory
          updatedAt
          featuredImage { url }
          variants(first: 50) {
            edges {
              node {
                id
                sku
                title
                price
                inventoryQuantity
              }
            }
          }
        }
      }
    }
  }
`;

async function fetchAllProducts(domain: string, token: string): Promise<ShopifyProduct[]> {
  const out: ShopifyProduct[] = [];
  let cursor: string | null = null;
  // 防御性上限：最多 100 页 × 100 product = 10000
  for (let page = 0; page < 100; page++) {
    const resp = await shopifyGraphQL(domain, token, PRODUCTS_QUERY, { cursor });
    const data = (resp.data as { products?: { edges?: Array<{ node: Record<string, unknown> }>; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } })?.products;
    if (!data?.edges) break;
    for (const edge of data.edges) {
      const n = edge.node as Record<string, unknown>;
      out.push({
        id: n.id as string,
        title: n.title as string,
        handle: n.handle as string,
        status: n.status as string,
        productType: (n.productType as string) || null,
        vendor: (n.vendor as string) || null,
        tags: (n.tags as string[]) || [],
        totalInventory: (n.totalInventory as number) ?? null,
        updatedAt: n.updatedAt as string,
        featuredImage: (n.featuredImage as { url?: string } | null)?.url || null,
        variants: ((n.variants as { edges?: Array<{ node: Record<string, unknown> }> })?.edges || []).map(e => {
          const v = e.node;
          return {
            id: v.id as string,
            sku: (v.sku as string) || null,
            title: v.title as string,
            price: (v.price as string) || null,
            inventoryQuantity: (v.inventoryQuantity as number) ?? null,
          };
        }),
      });
    }
    if (!data.pageInfo?.hasNextPage) break;
    cursor = data.pageInfo.endCursor || null;
    if (!cursor) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Payload;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // list 是只读、不动 DB → 不需要 pwd
  // 其他 action（link/unlink/sync/link-from-aliases）动 products 表 → 走密码验
  if (body.action !== "list") {
    const { data: wa, error: waErr } = await supabase
      .from("wa_settings")
      .select("admin_password")
      .eq("id", 1)
      .maybeSingle();
    if (waErr) return json({ error: `Read wa_settings failed: ${waErr.message}` }, 500);
    const currentPwd = wa?.admin_password || "";
    if (!currentPwd) return json({ error: "Admin password not set" }, 401);
    if (!body.pwd || body.pwd !== currentPwd) return json({ error: "Wrong password" }, 401);
  }

  // 拿 Shopify 凭证
  const { data: settings, error: setErr } = await supabase
    .from("shopify_settings")
    .select("shop_domain, access_token")
    .eq("id", 1)
    .maybeSingle();
  if (setErr) return json({ error: `Read shopify_settings failed: ${setErr.message}` }, 500);
  const domain = settings?.shop_domain || "";
  const token = settings?.access_token || "";
  if (!domain || !token) return json({ error: "Shopify not configured" }, 400);

  // ── action: list ─────────────────────────────────────────────────────────
  if (body.action === "list") {
    try {
      const products = await fetchAllProducts(domain, token);
      const variantTotal = products.reduce((s, p) => s + p.variants.length, 0);
      return json({ ok: true, products, count: products.length, variantCount: variantTotal });
    } catch (e) {
      return json({ ok: false, error: String((e as Error).message || e) }, 200);
    }
  }

  // ── action: link ─────────────────────────────────────────────────────────
  // 手动关联：把 Shopify variant 链接到指定 bizflow product，写 shopify_* 字段
  if (body.action === "link") {
    if (!body.bizflow_product_id) return json({ error: "Missing bizflow_product_id" }, 400);
    if (!body.shopify_variant_id) return json({ error: "Missing shopify_variant_id" }, 400);
    // 防止同一 variant 关联到多个 bizflow product
    const { data: existing, error: chkErr } = await supabase
      .from("products")
      .select("id, name, internal_code")
      .eq("shopify_variant_id", body.shopify_variant_id)
      .neq("id", body.bizflow_product_id);
    if (chkErr) return json({ error: `Check failed: ${chkErr.message}` }, 500);
    if (existing && existing.length > 0) {
      return json({ error: `Variant 已關聯到其他商品：${existing[0].name} (${existing[0].internal_code})`, conflicts: existing }, 409);
    }
    const patch = {
      shopify_product_id: body.shopify_product_id || null,
      shopify_variant_id: body.shopify_variant_id,
      shopify_sku: body.shopify_sku || null,
    };
    const { error } = await supabase.from("products").update(patch).eq("id", body.bizflow_product_id);
    if (error) return json({ error: `Link failed: ${error.message}` }, 500);
    return json({ ok: true });
  }

  // ── action: unlink ───────────────────────────────────────────────────────
  if (body.action === "unlink") {
    if (!body.bizflow_product_id) return json({ error: "Missing bizflow_product_id" }, 400);
    const { error } = await supabase.from("products").update({
      shopify_product_id: null,
      shopify_variant_id: null,
      shopify_sku: null,
    }).eq("id", body.bizflow_product_id);
    if (error) return json({ error: `Unlink failed: ${error.message}` }, 500);
    return json({ ok: true });
  }

  // ── action: link-from-aliases ────────────────────────────────────────────
  // 通过 line_item_aliases 表倒推：
  //   alias.alias_name 来自历史订单 line item title，应该跟 Shopify variant 当前 displayName 高度匹配
  //   → 把 alias 关联的 bizflow product 跟 Shopify variant.id 自动 link
  // 只处理单品 alias（skip=false + products.length===1），套装/押金/Final Payment 跳过
  if (body.action === "link-from-aliases") {
    const confirm = body.confirm === true;
    try {
      const [shopifyProducts, aliasResp, prodResp] = await Promise.all([
        fetchAllProducts(domain, token),
        supabase.from("line_item_aliases").select("id, alias_name, skip, products, verified"),
        supabase.from("products").select("id, name, internal_code, shopify_variant_id"),
      ]);
      if (aliasResp.error) throw new Error(`Read aliases failed: ${aliasResp.error.message}`);
      if (prodResp.error) throw new Error(`Read products failed: ${prodResp.error.message}`);

      // Shopify variants 索引：normalize(displayName) → variant
      // displayName 形如 "product.title - variant.title"（非 Default Title）或 "product.title"
      // 同一 normalize key 可能对多 variant（虽然罕见）→ 记录 list 判断 ambiguous
      const variantByName = new Map<string, Array<{ p: ShopifyProduct; v: ShopifyVariant }>>();
      for (const p of shopifyProducts) {
        for (const v of p.variants) {
          const isDefault = v.title === "Default Title";
          const displayName = isDefault ? p.title : `${p.title} - ${v.title}`;
          const k1 = normalize(displayName);
          const k2 = normalize(p.title);
          for (const k of [k1, k2]) {
            if (!variantByName.has(k)) variantByName.set(k, []);
            variantByName.get(k)!.push({ p, v });
          }
        }
      }

      const bizById = new Map<string, Record<string, unknown>>();
      for (const p of prodResp.data || []) bizById.set(String(p.id), p);

      // 已被 link 的 bizflow product / Shopify variant
      const alreadyLinkedBizflow = new Set<string>();
      const alreadyLinkedVariant = new Set<string>();
      for (const p of prodResp.data || []) {
        if (p.shopify_variant_id) {
          alreadyLinkedBizflow.add(String(p.id));
          alreadyLinkedVariant.add(String(p.shopify_variant_id));
        }
      }

      interface AliasLinkRow {
        action: "link" | "skip";
        reason?: string;
        alias_name: string;
        bizflow_id?: string;
        bizflow_name?: string;
        bizflow_internal_code?: string;
        shopify_product_id?: string;
        shopify_variant_id?: string;
        shopify_display_name?: string;
        shopify_sku?: string | null;
      }
      const plan: AliasLinkRow[] = [];

      for (const a of aliasResp.data || []) {
        const base: AliasLinkRow = { action: "skip", alias_name: String(a.alias_name) };
        if (a.skip === true) { plan.push({ ...base, reason: "alias.skip=true（押金/租務/Final Payment）" }); continue; }
        const ps = Array.isArray(a.products) ? a.products : [];
        if (ps.length === 0) { plan.push({ ...base, reason: "alias.products 空" }); continue; }
        if (ps.length > 1) { plan.push({ ...base, reason: "套裝（多 product），不自動關聯" }); continue; }
        const pid = String(ps[0].product_id || "");
        if (!pid) { plan.push({ ...base, reason: "alias product_id 空" }); continue; }
        const biz = bizById.get(pid);
        if (!biz) { plan.push({ ...base, reason: "bizflow product 已刪除" }); continue; }
        if (alreadyLinkedBizflow.has(pid)) { plan.push({ ...base, bizflow_id: pid, bizflow_name: String(biz.name || ""), reason: "bizflow product 已關聯其他 variant" }); continue; }

        const k = normalize(a.alias_name);
        const matches = variantByName.get(k) || [];
        // 过滤掉已被其他 bizflow product 占用的 variant
        const usable = matches.filter(m => !alreadyLinkedVariant.has(m.v.id));
        if (usable.length === 0) {
          plan.push({ ...base, bizflow_id: pid, bizflow_name: String(biz.name || ""), bizflow_internal_code: String(biz.internal_code || ""), reason: matches.length > 0 ? "Shopify variant 已被其他 bizflow product 關聯" : "Shopify 找不到匹配的 variant title" });
          continue;
        }
        if (usable.length > 1) {
          plan.push({ ...base, bizflow_id: pid, bizflow_name: String(biz.name || ""), bizflow_internal_code: String(biz.internal_code || ""), reason: `匹配到 ${usable.length} 個 Shopify variant（ambiguous，跳過）` });
          continue;
        }
        const m = usable[0];
        const isDefault = m.v.title === "Default Title";
        plan.push({
          action: "link",
          alias_name: String(a.alias_name),
          bizflow_id: pid,
          bizflow_name: String(biz.name || ""),
          bizflow_internal_code: String(biz.internal_code || ""),
          shopify_product_id: m.p.id,
          shopify_variant_id: m.v.id,
          shopify_display_name: isDefault ? m.p.title : `${m.p.title} - ${m.v.title}`,
          shopify_sku: m.v.sku || null,
        });
        // 防止后续 alias 重复 link 同一对
        alreadyLinkedBizflow.add(pid);
        alreadyLinkedVariant.add(m.v.id);
      }

      const stats = {
        link: plan.filter(x => x.action === "link").length,
        skip: plan.filter(x => x.action === "skip").length,
        total: plan.length,
      };

      if (!confirm) return json({ ok: true, dryRun: true, stats, plan });

      // 实际写
      const results = { linked: 0, errors: [] as string[] };
      for (const row of plan) {
        if (row.action !== "link") continue;
        const patch = {
          shopify_product_id: row.shopify_product_id,
          shopify_variant_id: row.shopify_variant_id,
          shopify_sku: row.shopify_sku,
        };
        const { error } = await supabase.from("products").update(patch).eq("id", row.bizflow_id);
        if (error) { results.errors.push(`link ${row.bizflow_id} ← ${row.shopify_variant_id}: ${error.message}`); continue; }
        results.linked++;
      }
      return json({ ok: true, dryRun: false, stats, results });
    } catch (e) {
      return json({ ok: false, error: String((e as Error).message || e) }, 200);
    }
  }

  // ── action: sync ─────────────────────────────────────────────────────────
  // 单向 Shopify → bizflow。按 SKU 匹配现有 bizflow products；
  //   命中 → UPDATE name/price/image_url/shopify_* 字段；
  //   没命中 → INSERT 新 product + needs_review=true 等使用者审；
  //   variant 无 SKU → 跳过（让使用者去 Shopify 补完再 sync）
  // 不动 inventory_stock（库存逻辑使用者还在想）
  // confirm=false 走 dry-run 只返回计划、不写 DB
  if (body.action === "sync") {
    const confirm = body.confirm === true;
    try {
      const shopifyProducts = await fetchAllProducts(domain, token);

      // 拉现有 bizflow products（含 archived，避免重复建）
      const { data: bizProducts, error: bizErr } = await supabase
        .from("products")
        .select("id, name, internal_code, shopify_sku, shopify_variant_id, price, image_url, category, status");
      if (bizErr) throw new Error(`Read bizflow products failed: ${bizErr.message}`);

      // 三种匹配策略，按优先级：
      // 1. shopify_variant_id 完全匹配（手动 link 建立的关联）
      // 2. shopify_sku 完全匹配（之前 sync 写过的）
      // 3. internal_code 跟 Shopify variant.sku 文本匹配（兜底）
      // 都没匹配 → 标 unlinked（不再自动建，让使用者手动 link）
      const bizByVariantId = new Map<string, Record<string, unknown>>();
      const bizByShopifySku = new Map<string, Record<string, unknown>>();
      const bizByInternalCode = new Map<string, Record<string, unknown>>();
      for (const p of bizProducts || []) {
        if (p.shopify_variant_id) bizByVariantId.set(String(p.shopify_variant_id), p);
        if (p.shopify_sku) bizByShopifySku.set(String(p.shopify_sku).trim().toLowerCase(), p);
        if (p.internal_code) bizByInternalCode.set(String(p.internal_code).trim().toLowerCase(), p);
      }

      interface PlanRow {
        action: "update" | "unlinked" | "skip";
        reason?: string;
        matchedBy?: "variant_id" | "shopify_sku" | "internal_code";
        shopify_product_id: string;
        shopify_variant_id: string;
        shopify_sku: string | null;
        title: string;
        price: string | null;
        image_url: string | null;
        bizflow_id?: string;
        bizflow_current_name?: string;
      }
      const plan: PlanRow[] = [];

      for (const p of shopifyProducts) {
        for (const v of p.variants) {
          const isDefault = v.title === "Default Title";
          const displayName = isDefault ? p.title : `${p.title} - ${v.title}`;
          const sku = (v.sku || "").trim();
          const base: PlanRow = {
            action: "skip",
            shopify_product_id: p.id,
            shopify_variant_id: v.id,
            shopify_sku: sku || null,
            title: displayName,
            price: v.price,
            image_url: p.featuredImage,
          };
          // 1. variant_id 匹配（最强）
          const byVariant = bizByVariantId.get(v.id);
          if (byVariant) {
            plan.push({ ...base, action: "update", matchedBy: "variant_id", bizflow_id: String(byVariant.id), bizflow_current_name: String(byVariant.name || "") });
            continue;
          }
          if (sku) {
            // 2. shopify_sku 匹配
            const bySkuField = bizByShopifySku.get(sku.toLowerCase());
            if (bySkuField) {
              plan.push({ ...base, action: "update", matchedBy: "shopify_sku", bizflow_id: String(bySkuField.id), bizflow_current_name: String(bySkuField.name || "") });
              continue;
            }
            // 3. internal_code 匹配（兜底）
            const byCode = bizByInternalCode.get(sku.toLowerCase());
            if (byCode) {
              plan.push({ ...base, action: "update", matchedBy: "internal_code", bizflow_id: String(byCode.id), bizflow_current_name: String(byCode.name || "") });
              continue;
            }
          }
          // 都没匹配 → unlinked（不再自动建）
          plan.push({ ...base, action: "unlinked", reason: sku ? "no bizflow match for SKU" : "no SKU + no link" });
        }
      }

      const stats = {
        update: plan.filter(x => x.action === "update").length,
        unlinked: plan.filter(x => x.action === "unlinked").length,
        skip: plan.filter(x => x.action === "skip").length,
        total: plan.length,
      };

      if (!confirm) {
        // dry-run：只返回 plan + 统计
        return json({ ok: true, dryRun: true, stats, plan });
      }

      // 实际写：只更新已关联的 bizflow product，不再自动建
      const results = { updated: 0, unlinked: 0, skipped: 0, errors: [] as string[] };
      for (const row of plan) {
        try {
          if (row.action === "update" && row.bizflow_id) {
            const patch: Record<string, unknown> = {
              name: row.title,
              price: row.price ? Number(row.price) : null,
              image_url: row.image_url,
              shopify_product_id: row.shopify_product_id,
              shopify_variant_id: row.shopify_variant_id,
              shopify_sku: row.shopify_sku,
            };
            const { error } = await supabase.from("products").update(patch).eq("id", row.bizflow_id);
            if (error) { results.errors.push(`update ${row.bizflow_id}: ${error.message}`); continue; }
            results.updated++;
          } else if (row.action === "unlinked") {
            results.unlinked++;
          } else {
            results.skipped++;
          }
        } catch (e) {
          results.errors.push(String((e as Error).message || e));
        }
      }

      // 标记 last_synced_at
      await supabase.from("shopify_settings").update({ last_synced_at: new Date().toISOString() }).eq("id", 1);

      return json({ ok: true, dryRun: false, stats, results });
    } catch (e) {
      return json({ ok: false, error: String((e as Error).message || e) }, 200);
    }
  }

  return json({ error: "Unknown action" }, 400);
});
