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
  shopify_qty?: number; // 多对一时这个 bizflow product 在 Shopify variant 中算几件，默认 1
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
  // M:N 关联：写 shopify_variant_links 表
  //   - 同一 (variant_id, bizflow_product_id) 对：UPSERT（再次 link 更新 qty）
  //   - 不同 variant 用同一 bizflow product：允许（套餐组件复用）
  //   - 不同 bizflow product 用同一 variant：允许（套餐多组件）
  if (body.action === "link") {
    if (!body.bizflow_product_id) return json({ error: "Missing bizflow_product_id" }, 400);
    if (!body.shopify_variant_id) return json({ error: "Missing shopify_variant_id" }, 400);
    const row = {
      shopify_variant_id: body.shopify_variant_id,
      bizflow_product_id: body.bizflow_product_id,
      shopify_product_id: body.shopify_product_id || null,
      shopify_sku: body.shopify_sku || null,
      qty: typeof body.shopify_qty === "number" && body.shopify_qty > 0 ? body.shopify_qty : 1,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("shopify_variant_links")
      .upsert(row, { onConflict: "shopify_variant_id,bizflow_product_id" });
    if (error) return json({ error: `Link failed: ${error.message}` }, 500);
    return json({ ok: true });
  }

  // ── action: unlink ───────────────────────────────────────────────────────
  // 删一行 (variant, product) 关联。需要二元定位
  if (body.action === "unlink") {
    if (!body.bizflow_product_id) return json({ error: "Missing bizflow_product_id" }, 400);
    if (!body.shopify_variant_id) return json({ error: "Missing shopify_variant_id" }, 400);
    const { error } = await supabase
      .from("shopify_variant_links")
      .delete()
      .eq("bizflow_product_id", body.bizflow_product_id)
      .eq("shopify_variant_id", body.shopify_variant_id);
    if (error) return json({ error: `Unlink failed: ${error.message}` }, 500);
    return json({ ok: true });
  }

  // ── action: link-from-aliases ────────────────────────────────────────────
  // 通过 line_item_aliases 表倒推：
  //   alias.alias_name 来自历史订单 line item title，跟 Shopify variant 当前 displayName 匹配
  //   alias.products 可以是单品（1 行）或套装（多行）→ 每行都 link 到同一个 Shopify variant，带 qty
  // skip alias（押金/租務/Final Payment）跳过
  if (body.action === "link-from-aliases") {
    const confirm = body.confirm === true;
    try {
      const [shopifyProducts, aliasResp, prodResp, linksResp] = await Promise.all([
        fetchAllProducts(domain, token),
        supabase.from("line_item_aliases").select("id, alias_name, skip, products, verified"),
        supabase.from("products").select("id, name, internal_code"),
        supabase.from("shopify_variant_links").select("shopify_variant_id, bizflow_product_id"),
      ]);
      if (aliasResp.error) throw new Error(`Read aliases failed: ${aliasResp.error.message}`);
      if (prodResp.error) throw new Error(`Read products failed: ${prodResp.error.message}`);
      if (linksResp.error) throw new Error(`Read links failed: ${linksResp.error.message}`);

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

      // 已 link 的 (bizflow_product_id, shopify_variant_id) 对（从 M:N 关联表查）
      const linkedPairs = new Set<string>();
      for (const link of linksResp.data || []) {
        linkedPairs.add(`${link.bizflow_product_id}|${link.shopify_variant_id}`);
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
        shopify_qty?: number;
        is_bundle?: boolean;
      }
      const plan: AliasLinkRow[] = [];

      for (const a of aliasResp.data || []) {
        const aliasName = String(a.alias_name);
        const base: AliasLinkRow = { action: "skip", alias_name: aliasName };
        if (a.skip === true) { plan.push({ ...base, reason: "alias.skip=true（押金/租務/Final Payment）" }); continue; }
        const ps = Array.isArray(a.products) ? a.products : [];
        if (ps.length === 0) { plan.push({ ...base, reason: "alias.products 空" }); continue; }

        // 匹配 Shopify variant by alias_name 文本
        const k = normalize(aliasName);
        const matches = variantByName.get(k) || [];
        if (matches.length === 0) {
          plan.push({ ...base, reason: "Shopify 找不到匹配的 variant title" });
          continue;
        }
        if (matches.length > 1) {
          plan.push({ ...base, reason: `匹配到 ${matches.length} 個 Shopify variant（ambiguous，跳過）` });
          continue;
        }
        const m = matches[0];
        const isDefault = m.v.title === "Default Title";
        const displayName = isDefault ? m.p.title : `${m.p.title} - ${m.v.title}`;
        const isBundle = ps.length > 1;

        // alias.products 可以多行（套装）→ 每个 component 一条 link，shopify_qty = component.qty
        for (const comp of ps) {
          const pid = String(comp.product_id || "");
          if (!pid) continue;
          const biz = bizById.get(pid);
          if (!biz) {
            plan.push({ ...base, reason: `bizflow product ${pid.slice(0, 8)} 已刪除`, shopify_display_name: displayName });
            continue;
          }
          const pairKey = `${pid}|${m.v.id}`;
          if (linkedPairs.has(pairKey)) {
            plan.push({ ...base, bizflow_id: pid, bizflow_name: String(biz.name || ""), bizflow_internal_code: String(biz.internal_code || ""), shopify_display_name: displayName, reason: "已關聯（跳過）", is_bundle: isBundle });
            continue;
          }
          plan.push({
            action: "link",
            alias_name: aliasName,
            bizflow_id: pid,
            bizflow_name: String(biz.name || ""),
            bizflow_internal_code: String(biz.internal_code || ""),
            shopify_product_id: m.p.id,
            shopify_variant_id: m.v.id,
            shopify_display_name: displayName,
            shopify_sku: m.v.sku || null,
            shopify_qty: Number(comp.qty) > 0 ? Number(comp.qty) : 1,
            is_bundle: isBundle,
          });
          linkedPairs.add(pairKey);
        }
      }

      const stats = {
        link: plan.filter(x => x.action === "link").length,
        skip: plan.filter(x => x.action === "skip").length,
        total: plan.length,
      };

      if (!confirm) return json({ ok: true, dryRun: true, stats, plan });

      // 实际写：INSERT 到 shopify_variant_links（UPSERT 重复对）
      const results = { linked: 0, errors: [] as string[] };
      for (const row of plan) {
        if (row.action !== "link") continue;
        const linkRow = {
          shopify_variant_id: row.shopify_variant_id,
          bizflow_product_id: row.bizflow_id,
          shopify_product_id: row.shopify_product_id || null,
          shopify_sku: row.shopify_sku || null,
          qty: row.shopify_qty || 1,
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase
          .from("shopify_variant_links")
          .upsert(linkRow, { onConflict: "shopify_variant_id,bizflow_product_id" });
        if (error) { results.errors.push(`link ${row.bizflow_id} ← ${row.shopify_variant_id}: ${error.message}`); continue; }
        results.linked++;
      }
      return json({ ok: true, dryRun: false, stats, results });
    } catch (e) {
      return json({ ok: false, error: String((e as Error).message || e) }, 200);
    }
  }

  // ── action: sync ─────────────────────────────────────────────────────────
  // 已废弃：M:N 关联模型下「用 Shopify name/price 覆盖 bizflow product」语义不通
  // （一个 bizflow product 出现在多个 Shopify variant 里时该用哪个 variant 的字段覆盖？）
  // 新方向：sync 走库存方向 = Shopify variant 库存按 qty 拆到 bizflow component products
  // 库存逻辑使用者还在想，暂时停用
  if (body.action === "sync") {
    return json({ error: "sync action 已停用（M:N 模型下需重新設計）。link 完先用，sync 邏輯之後再加" }, 501);
  }
  // 旧 sync 实现保留在 git 历史里以备查（commit 947cefa 前）
  if (body.action === "sync_old_disabled") {
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
