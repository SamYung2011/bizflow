// Edge Function: track-shipments
//
// 职责：
//   1. 被 pg_cron 每 6 小时调用一次（也可以被 bizflow UI 「立即刷新」按钮手动调）
//   2. 查 invoices 中「有 tracking_number、未签收/未異常、距上次同步 ≥ 1h」的发票
//   3. 调顺丰开放平台 EXP_RECE_SEARCH_ROUTES 拉路由
//   4. 把事件 upsert 到 shipment_events
//   5. 更新 invoices.shipping_status / shipping_last_synced_at
//
// 顺丰开放平台 ISV 接口规格参考（待老板拿到凭证后再 verify）：
//   - endpoint: https://bsp-oisp.sf-express.com/std/service
//   - serviceCode: EXP_RECE_SEARCH_ROUTES
//   - 鉴权: msgDigest = Base64(MD5(msgData + timestamp + checkword))
//   - 公共参数: partnerID / requestID / serviceCode / timestamp / msgDigest / msgData
//
// 老板需要提供（注册顺丰开放平台后）：
//   - SF_PARTNER_ID（合作伙伴编码）
//   - SF_CHECKWORD（校验码，用于 MD5 签名）
//   - SF_API_ENDPOINT（沙箱：sbox-bsp-oisp.sf-express.com / 生产：bsp-oisp.sf-express.com）
//
// 部署：
//   scp index.ts ecs-user@47.242.242.233:/mnt/data/bizflow/supabase/volumes/functions/track-shipments/
//   sudo docker compose restart functions

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

// ─────────────────────────────────────────────────
// 顺丰开放平台 client（独立模块化，方便 HK / 大陆切换）
// ─────────────────────────────────────────────────

interface SfRoute {
  acceptTime: string;       // "2026-05-06 10:00:00"
  acceptAddress: string;    // "深圳市福田区"
  remark: string;           // "已揽收"
  opCode: string;           // 顺丰状态码 30/50/80...
}

interface SfRouteResponse {
  mailNo: string;
  routes: SfRoute[];
}

async function md5Base64(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("MD5", buf);
  return encodeBase64(new Uint8Array(hash));
}

async function callSfRouteQuery(trackingNumber: string): Promise<SfRouteResponse | null> {
  const partnerID = Deno.env.get("SF_PARTNER_ID");
  const checkword = Deno.env.get("SF_CHECKWORD");
  const endpoint  = Deno.env.get("SF_API_ENDPOINT") ?? "https://bsp-oisp.sf-express.com/std/service";

  if (!partnerID || !checkword) {
    console.error("[SF] 凭证未配置：SF_PARTNER_ID / SF_CHECKWORD 必填");
    return null;
  }

  const msgData = JSON.stringify({
    trackingType: "1",                  // 1 = 按运单号查
    trackingNumber: [trackingNumber],
  });

  const timestamp = String(Date.now());
  const msgDigest = await md5Base64(msgData + timestamp + checkword);
  const requestID = crypto.randomUUID();

  const body = new URLSearchParams({
    partnerID,
    requestID,
    serviceCode: "EXP_RECE_SEARCH_ROUTES",
    timestamp,
    msgDigest,
    msgData,
  });

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const json = await resp.json();
    if (json.apiResultCode !== "A1000") {
      console.error(`[SF] API 返回错误：${json.apiResultCode} - ${json.apiErrorMsg}`);
      return null;
    }
    // apiResultData 是字符串化的 JSON，要二次解析
    const data = typeof json.apiResultData === "string"
      ? JSON.parse(json.apiResultData)
      : json.apiResultData;

    if (!data?.success) {
      console.error(`[SF] 业务返回错误：${data?.errorCode} - ${data?.errorMsg}`);
      return null;
    }
    return data.msgData?.routeResps?.[0] ?? null;
  } catch (e) {
    console.error(`[SF] 网络错误：${e.message}`);
    return null;
  }
}

// 顺丰 opCode → bizflow 状态映射（不全的 fallback 到「在途」）
function mapSfOpCodeToStatus(opCode: string, allRoutes: SfRoute[]): string {
  // 拿最新一条
  const codes = allRoutes.map(r => r.opCode);
  if (codes.includes("80") || codes.includes("8000")) return "已簽收";
  if (codes.includes("70") || codes.includes("7000")) return "異常";   // 派送失败 / 異常
  if (codes.includes("44") || codes.includes("50") || codes.includes("5000")) return "派送中";
  if (codes.includes("30") || codes.includes("36")) return "在途";
  if (codes.includes("54") || codes.includes("204")) return "在途";
  return "已發貨";
}

// ─────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // 支持单条手动刷新：POST { invoice_id: "1521" }
  let onlyInvoiceId: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.invoice_id != null) onlyInvoiceId = String(body.invoice_id);
    } catch { /* ignore */ }
  }

  // 拉取候选 invoices
  let q = supabase
    .from("invoices")
    .select("id, tracking_number, shipping_status, shipping_last_synced_at")
    .not("tracking_number", "is", null);

  if (onlyInvoiceId) {
    q = q.eq("id", onlyInvoiceId);
  } else {
    q = q.not("shipping_status", "in", "(已簽收,異常)");
    // 至少 1 小时同步过一次的跳过（防 cron 抖动重复打 API）
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    q = q.or(`shipping_last_synced_at.is.null,shipping_last_synced_at.lt.${oneHourAgo}`);
    q = q.limit(50);  // 单次 cron 最多处理 50 条，防 API 配额炸
  }

  const { data: invoices, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  const results = { processed: 0, updated: 0, errors: 0, skipped: 0 };

  for (const inv of invoices ?? []) {
    results.processed++;

    const route = await callSfRouteQuery(inv.tracking_number!);
    if (!route) {
      // API 失败但不一定是異常单——只更新 last_synced_at，不动 status
      await supabase
        .from("invoices")
        .update({ shipping_last_synced_at: new Date().toISOString() })
        .eq("id", inv.id);
      results.errors++;
      continue;
    }

    if (!route.routes || route.routes.length === 0) {
      // 单号查无结果（刚发出顺丰还没揽收 / 单号错）
      results.skipped++;
      await supabase
        .from("invoices")
        .update({ shipping_last_synced_at: new Date().toISOString() })
        .eq("id", inv.id);
      continue;
    }

    // 按 acceptTime 升序排（最早的在前面）
    const sorted = [...route.routes].sort(
      (a, b) => new Date(a.acceptTime).getTime() - new Date(b.acceptTime).getTime(),
    );

    // upsert 事件
    const events = sorted.map(r => ({
      invoice_id: inv.id,
      event_at: r.acceptTime,
      location: r.acceptAddress,
      description: r.remark,
      op_code: r.opCode,
      raw: r,
    }));
    const { error: insErr } = await supabase
      .from("shipment_events")
      .upsert(events, { onConflict: "invoice_id,event_at,op_code", ignoreDuplicates: true });
    if (insErr) {
      console.error(`[invoice ${inv.id}] insert events failed:`, insErr.message);
      results.errors++;
      continue;
    }

    // 更新 invoice 状态
    const latest = sorted[sorted.length - 1];
    const newStatus = mapSfOpCodeToStatus(latest.opCode, sorted);
    const updates: Record<string, unknown> = {
      shipping_status: newStatus,
      shipping_last_synced_at: new Date().toISOString(),
    };
    if (newStatus === "已簽收") updates.delivered_at = latest.acceptTime;

    await supabase.from("invoices").update(updates).eq("id", inv.id);
    results.updated++;
  }

  return new Response(JSON.stringify({ ok: true, ...results }), {
    headers: { "Content-Type": "application/json" },
  });
});
