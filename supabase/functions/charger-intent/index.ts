// Supabase Edge Function: charger-intent
// 接收 Framer「充電樁購買意向」表單 webhook → 寫 customers + charger_leads
//
// 部署：
//   - 在 Supabase Dashboard → Edge Functions → New Function → 命名 "charger-intent"
//   - 粘貼此檔案內容
//   - 把 "Verify JWT with legacy secret" 開關**關掉**（不然 Framer 沒帶 JWT 會 401）
//   - Deploy
//   - 拿到 URL: https://qxcmimgqsrwkrhqhzpga.supabase.co/functions/v1/charger-intent
//   - 把 Framer「充電樁意向」表單的 webhook URL 改成這個
//
// ⚠️ 字段映射：下方 get(...) 的別名是按通用猜的，等煊煊給實際 Framer 字段名後對齊
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

  const name         = get("name", "Name", "聯繫人", "中文名");
  const email        = get("Email", "email");
  const hkPhone      = get("HK Number", "Hong Kong Number", "HK Phone", "香港電話", "phone");
  const cnPhone      = get("CN Number", "China Number", "內地電話", "phone_mainland");
  const product      = get("products", "Products", "Product", "請選擇產品", "產品");                        // 主充電樁下拉（Type2 EV Smart Charger）
  const installSvc   = get("products 2", "products2", "install_service", "Install Service", "安裝服務", "請選擇安裝服務"); // 安裝服務（真實字段名 = products 2）
  const carMake      = get("Car brands", "Car Brands", "Car Brand", "你的汽車品牌", "car_make");
  const carModel     = get("Model", "Car Model", "型號", "car_model");
  const address      = get("Address", "地址", "address");
  const referral     = get("Promo Code", "PromoCode", "promo_code", "Referral", "推薦人");                  // 表單字段名實為 Promo Code，內容是推薦人

  // 7 個產品複選（Boolean）→ 收集勾選的產品名（以字段名為準）
  const isChecked = (key: string): boolean => {
    const v = lowerPayload[key.toLowerCase().trim()];
    if (v == null || v === false) return false;
    if (v === true) return true;
    const s = String(v).toLowerCase().trim();
    return s !== "" && s !== "false" && s !== "no" && s !== "0" && s !== "off";
  };
  const PRODUCT_CHECKBOXES = ["DC Adaptor", "AC Adaptor", "Type2 V2L", "Every Charge 4 in 1", "Type2 Charging Cord", "Type2 Wall Charger", "Type2 Portable"];
  const selectedProducts = PRODUCT_CHECKBOXES.filter((p) => isChecked(p));

  // 最小要求：name/email/phone 至少一個非空
  if (!name && !email && !hkPhone && !cnPhone) {
    return json({ error: "name/email/phone all empty - skip" }, 400);
  }

  const sb = createClient(SUPA_URL, SERVICE_KEY);

  // —— 客戶匹配（與 forms-buy 同套：打分制 reuse + 嚴格一致沉默合併 + 差異走 PENDING_MERGE）——
  const isSuspiciousEmail = (e: string): boolean => {
    if (!e) return true;
    const lower = e.toLowerCase().trim();
    if (!lower.includes("@")) return true;
    const blk = ["123@gmail.com", "test@test.com", "1@1.com", "a@a.com", "123@qq.com", "321@abc.com", "123@abc.com"];
    if (blk.includes(lower)) return true;
    const [local, domain] = lower.split("@");
    if (!domain || !domain.includes(".")) return true;
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

  // 拉候選客戶（按 email 或 phone 精確撞）
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

  // 嚴格一致：表單填了值的字段都跟老客戶對應字段精確相等（老客戶空算不一致）
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
    // 新建獨立 customer，不動老客戶主檔
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
    // score ≥ 3 但有差異 → 標記待合併，讓運營手動處理
    if (best) pendingMergeCid = String(best.id);
  }

  // —— 寫 charger_leads（意向單，狀態 interested）——
  const { data: lead, error: le } = await sb
    .from("charger_leads")
    .insert({
      customer_id: customerId,
      name: name || null,
      phone: hkPhone || null,
      phone_mainland: cnPhone || null,
      email: emailValid ? email : null,
      charger_model: product || null,
      selected_products: selectedProducts,
      install_service: installSvc || null,
      car_make: carMake || null,
      car_model: carModel || null,
      address: address || null,
      referral: referral || null,
      status: "interested",
      source_channel: "framer",
      pending_merge_cid: pendingMergeCid || null,
    })
    .select("id")
    .single();
  if (le) {
    return json({ error: "charger_lead insert failed", detail: le.message, customer_id: customerId }, 500);
  }

  return json({
    ok: true,
    customer_id: customerId,
    lead_id: lead.id,
    pending_merge: pendingMergeCid || null,
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
