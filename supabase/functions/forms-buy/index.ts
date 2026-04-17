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

  // —— 1. 客戶去重：先按 email，再按 hkPhone，找到就 reuse ——————————
  let customerId: string | null = null;
  if (email) {
    const { data } = await sb.from("customers").select("id").eq("email", email).limit(1);
    if (data?.[0]) customerId = data[0].id;
  }
  if (!customerId && hkPhone) {
    const { data } = await sb.from("customers").select("id").eq("phone", hkPhone).limit(1);
    if (data?.[0]) customerId = data[0].id;
  }

  // 找不到就新增
  if (!customerId) {
    const { data: newCust, error: ce } = await sb
      .from("customers")
      .insert({
        name: name || "(表單未填名)",
        email: email || null,
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
    if (ce) {
      return json({ error: "customer insert failed", detail: ce.message }, 500);
    }
    customerId = newCust.id;
  } else {
    // —— 找到了現有客戶：用表單新填的數據補全空字段（不覆蓋已有值）——
    const { data: existing } = await sb
      .from("customers")
      .select("name, email, phone, phone_mainland, car_make, car_model, address, referral")
      .eq("id", customerId)
      .single();
    if (existing) {
      const patch: Record<string, string> = {};
      const isEmpty = (v: unknown) => v == null || String(v).trim() === "";
      if (isEmpty(existing.name) && name) patch.name = name;
      if (isEmpty(existing.email) && email) patch.email = email;
      if (isEmpty(existing.phone) && hkPhone) patch.phone = hkPhone;
      if (isEmpty(existing.phone_mainland) && cnPhone) patch.phone_mainland = cnPhone;
      if (isEmpty(existing.car_make) && carMake) patch.car_make = carMake;
      if (isEmpty(existing.car_model) && carModel) patch.car_model = carModel;
      if (isEmpty(existing.address) && address) patch.address = address;
      if (isEmpty(existing.referral) && referral) patch.referral = referral;
      if (Object.keys(patch).length > 0) {
        await sb.from("customers").update(patch).eq("id", customerId);
      }
    }
  }

  // —— 2. 按產品名查 products 表回填價格（小寫 + 去空格/橫線模糊匹配） ——
  type Item = { name: string; qty: number; price: number };
  let items: Item[] = [];
  if (productNames.length > 0) {
    // 拉全 products 表（30-50 條，量很小）
    const { data: products } = await sb.from("products").select("name, price");
    const normalize = (s: string) => (s || "").toLowerCase().replace(/[\s\-]+/g, "");
    items = productNames.map((pname) => {
      const target = normalize(pname);
      const matches = (products || []).filter((x: { name: string }) => x.name && normalize(x.name) === target);
      let p = matches[0];
      if (matches.length > 1) {
        // 同名多条时优先 "推廣"/"限時" 促銷版
        p = matches.find((x: { name: string }) => /推廣|限時|優惠/.test(x.name)) || matches[0];
      }
      return {
        name: pname,
        qty: 1,
        price: p?.price ? Number(p.price) : 0,
      };
    });
  }
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);

  // —— 3. 順序號 invoice_number = 當前最大 + 1 ————————————————
  const { data: maxRow } = await sb
    .from("invoices")
    .select("invoice_number")
    .not("invoice_number", "is", null)
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
        return "__FORMS_BUY__ Framer 表單意向 " + hkStr + (promoCode ? " | Promo Code: " + promoCode : "");
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
