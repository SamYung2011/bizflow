// Supabase Edge Function: forms-buy
// 接收 Framer 購物表單 webhook → 寫 customers + invoices
//
// 部署：
//   - 在 Supabase Dashboard → Edge Functions → New Function → 命名 "forms-buy"
//   - 粘貼此檔案內容
//   - 把 "Verify JWT with legacy secret" 開關**關掉**（不然 Framer 沒帶 JWT 會 401）
//   - Deploy
//   - 拿到 URL: https://qxcmimgqsrwkrhqhzpga.supabase.co/functions/v1/forms-buy
//   - 把 Framer webhook URL 改成這個
//
// SUPABASE_SERVICE_ROLE_KEY 已自動注入，無需配置
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  // CORS preflight（Framer 跨域可能需要）
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  // Framer webhook 的字段名（大小寫不敏感 + 兼容多種寫法）
  const lowerPayload: Record<string, unknown> = {};
  for (const k in payload) lowerPayload[k.toLowerCase().trim()] = payload[k];
  const get = (...keys: string[]): string => {
    for (const k of keys) {
      const v = lowerPayload[k.toLowerCase().trim()];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };

  const name      = get("Name", "中文名", "name");
  const email     = get("Email", "email");
  const hkPhone   = get("HK Number", "Hong Kong Number", "HK Phone", "香港電話", "phone");
  const cnPhone   = get("CN Number", "China Number", "內地電話", "phone_mainland");
  const carMake   = get("Car Brands", "Car Brand", "Car Make", "你的汽車品牌", "car_make");
  const carModel  = get("Model", "Car Model", "型號", "car_model");
  const address   = get("Address", "地址", "address");
  const referral  = get("Referral", "推薦人", "referral");
  const promoCode = get("Promo Code", "PromoCode", "promo_code", "promo");

  // 產品最多 3 個槽位
  const productNames = [
    get("Products", "Product", "產品"),
    get("Products 2", "Product 2"),
    get("Products 3", "Product 3"),
  ].filter(Boolean);

  if (!name && !email && !hkPhone && !cnPhone) {
    return json({ error: "name/email/phone all empty - skip" }, 400);
  }

  const sb = createClient(SUPA_URL, SERVICE_KEY);

  // —— v11：打分制 reuse + 严格一致沉默合并 + 差异走 PENDING_MERGE ——
  // 垃圾 email 过滤
  const isSuspiciousEmail = (e: string): boolean => {
    if (!e) return true;
    const lower = e.toLowerCase().trim();
    if (!lower.includes("@")) return true;                // v11: 没 @ 直接拦
    const blk = ["123@gmail.com","test@test.com","1@1.com","a@a.com","123@qq.com","321@abc.com","123@abc.com"];
    if (blk.includes(lower)) return true;
    const [local, domain] = lower.split("@");
    if (!domain || !domain.includes(".")) return true;    // v11: domain 缺 TLD
    if ((local || "").length <= 2) return true;
    if (/^\d+$/.test(local) && local.length <= 4) return true;
    return false;
  };
  const emailValid = email && !isSuspiciousEmail(email);

  const nameMatches = (a: string, b: string): boolean => {
    const na = (a || "").toLowerCase().replace(/\s+/g, "");
    const nb = (b || "").toLowerCase().replace(/\s+/g, "");
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
  };

  // 拉候选客户（按 email 或 phone 精确撞）
  const candidates: Record<string, unknown>[] = [];
  if (emailValid) {
    const { data } = await sb.from("customers").select("*").eq("email", email);
    if (data) candidates.push(...data);
  }
  if (hkPhone) {
    const { data } = await sb.from("customers").select("*").eq("phone", hkPhone);
    if (data) candidates.push(...data);
  }
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const id = String(c.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // 打分：name+2 / email+2 / phone+1 / address+1，score ≥ 3 算匹配
  let best: (Record<string, unknown> & { _score: number }) | null = null;
  for (const c of unique) {
    let s = 0;
    if (name && nameMatches(name, String(c.name || ""))) s += 2;
    if (emailValid && c.email && email.toLowerCase() === String(c.email).toLowerCase()) s += 2;
    if (hkPhone && c.phone && hkPhone === String(c.phone)) s += 1;
    if (address && c.address && address === String(c.address)) s += 1;
    if (s >= 3 && (!best || s > best._score)) best = { ...c, _score: s };
  }

  // 严格一致：表单填了值的字段都跟老客户对应字段精确相等（老客户空算不一致）
  const strictSame = best && ((): boolean => {
    const pairs: [string, string][] = [
      ["name", name],
      ["phone", hkPhone],
      ["phone_mainland", cnPhone],
      ["email", emailValid ? email : ""],
      ["address", address],
      ["car_make", carMake],
      ["car_model", carModel],
      ["referral", referral],
    ];
    for (const [key, formVal] of pairs) {
      if (!formVal) continue;
      const oldVal = String(best![key] || "").trim();
      if (oldVal.toLowerCase() !== formVal.toLowerCase()) return false;
    }
    return true;
  })();

  let customerId: string;
  let pendingMergeCid = "";

  if (best && strictSame) {
    // 完全一致 → 沉默 reuse
    customerId = String(best.id);
  } else {
    // 新建独立 customer，不动老客户主档
    const { data: newCust, error: ce } = await sb
      .from("customers")
      .insert({
        name: name || "(表單未填名)",
        email: emailValid ? email : null,
        phone: hkPhone || null,
        phone_mainland: cnPhone || null,
        car_make: carMake || null,
        car_model: carModel || null,
        address: address || null,
        referral: referral || null,
        type: "Lead",
      })
      .select("id")
      .single();
    if (ce) return json({ error: "customer insert failed", detail: ce.message }, 500);
    customerId = newCust.id;
    // score ≥ 3 但有差异 → 标记待合并，让运营手动处理
    if (best) pendingMergeCid = String(best.id);
  }

  // —— 2. 按產品名解析價格 + warranty_months snapshot ——
  // 解析優先級：
  //   2a. line_item_aliases 命中：用 alias.products[0].product_id 拉 active 產品（跟 Shopify sync 一致）
  //   2b. fallback：products 表 normalize 模糊匹配 + 排除 _archived
  //   2c. 多條同名 active：優先 "推廣/限時/優惠"，否則 matches[0]
  type Item = { name: string; qty: number; price: number; warranty_months?: number };
  let items: Item[] = [];
  if (productNames.length > 0) {
    const { data: products } = await sb.from("products").select("id, name, price, warranty_months, category");
    const { data: aliases } = await sb.from("line_item_aliases").select("alias_name, skip, products");
    const productById = new Map((products || []).map((p: any) => [p.id, p]));
    const normalize = (s: string) => (s || "").toLowerCase().replace(/[\s\-]+/g, "");
    const aliasByNorm = new Map<string, any>();
    for (const a of aliases || []) {
      if (!a.alias_name) continue;
      aliasByNorm.set(normalize(a.alias_name), a);
    }
    items = productNames.map((pname) => {
      const target = normalize(pname);
      let p: any = null;

      // 2a. alias 優先
      const alias = aliasByNorm.get(target);
      if (alias && !alias.skip && Array.isArray(alias.products) && alias.products.length > 0) {
        const aliasMap = alias.products[0];
        if (aliasMap?.product_id) p = productById.get(aliasMap.product_id);
      }

      // 2b. fallback：products 表 normalize 匹配，排除 _archived
      if (!p) {
        const matches = (products || []).filter((x: any) =>
          x.name && normalize(x.name) === target && x.category !== "_archived"
        );
        if (matches.length === 1) p = matches[0];
        else if (matches.length > 1) p = matches.find((x: any) => /推廣|限時|優惠/.test(x.name)) || matches[0];
      }

      const item: Item = {
        name: pname,
        qty: 1,
        price: p?.price ? Number(p.price) : 0,
      };
      if (p?.warranty_months) item.warranty_months = Number(p.warranty_months);
      return item;
    });
  }
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);

  // —— 3. 順序號 invoice_number = 當前最大 + 1 ————————————————
  // 只喺五位數內（< 100000）取 max：發票表混入過 Shopify 訂單號等 9 位大號，
  // 唔限範圍會被頂飛，framer 發票號滾雪球變長（2026-06-27 修）。
  const { data: maxRow } = await sb
    .from("invoices")
    .select("invoice_number")
    .not("invoice_number", "is", null)
    .lt("invoice_number", 100000)
    .order("invoice_number", { ascending: false })
    .limit(1);
  const nextInvNum = (maxRow?.[0]?.invoice_number || 0) + 1;

  // —— 4. 創建 invoice ————————————————————————————————————
  const { data: inv, error: ie } = await sb
    .from("invoices")
    .insert({
      customer_id: customerId,
      date: new Date().toISOString().slice(0, 10),
      items,
      total,
      status: "Unpaid",
      invoice_number: nextInvNum,
      notes: (() => {
        const hk = new Date(Date.now() + 8 * 60 * 60 * 1000);
        const pad = (n: number) => String(n).padStart(2, "0");
        const hkStr = `${hk.getUTCFullYear()}-${pad(hk.getUTCMonth() + 1)}-${pad(hk.getUTCDate())} ${pad(hk.getUTCHours())}:${pad(hk.getUTCMinutes())}`;
        const base = "__FORMS_BUY__ Framer 表單意向 " + hkStr + (promoCode ? " | Promo Code: " + promoCode : "");
        return pendingMergeCid ? base + " __PENDING_MERGE__:" + pendingMergeCid : base;
      })(),
      extended_warranty: false,
    })
    .select("id")
    .single();
  if (ie) {
    return json({
      error: "invoice insert failed",
      detail: ie.message,
      customer_id: customerId,
    }, 500);
  }

  return json({
    ok: true,
    customer_id: customerId,
    invoice_id: inv.id,
    invoice_number: nextInvNum,
    items_count: items.length,
    total,
  });
});


function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
