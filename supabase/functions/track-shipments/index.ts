// Edge Function: track-shipments
//
// 职责：
//   1. 被 pg_cron 每 6 小时调用一次（也可以被 bizflow UI 「立即刷新」按钮手动调）
//   2. 查 invoices 中「有 tracking_number、未签收/未異常、距上次同步 ≥ 1h」的发票
//   3. 调顺丰开放平台 EXP_RECE_SEARCH_ROUTES 拉路由
//   4. 把事件 upsert 到 shipment_events
//   5. 更新 invoices.shipping_status / shipping_last_synced_at
//
// 顺丰开放平台 ISV 接口规格（2026-05-08 实测确认）：
//   - 沙箱 endpoint: https://sfapi-sbox.sf-express.com/std/service
//   - 生产 endpoint: https://sfapi.sf-express.com/std/service
//   - serviceCode: EXP_RECE_SEARCH_ROUTES
//   - 鉴权（简易MD5）: msgDigest = Base64(MD5(msgData + timestamp + checkword))，msgData 不做 URL 编码
//   - 公共参数（form-urlencoded body）: partnerID / requestID / serviceCode / timestamp / msgDigest / msgData
//   - 响应: apiResultCode='A1000' 成功，apiResultData 是字符串化 JSON，
//           解析后 {success: true, msgData: {routeResps: [{mailNo, routes: [...]}]}}
//
// 必需 env vars（已塞进 /mnt/data/bizflow/supabase/docker/.env，2026-05-08）:
//   - SF_ENV: 'prod' | 'sbx'（决定走哪个环境）
//   - SF_PARTNER_ID_SBX / SF_CHECKWORD_SBX / SF_API_BASE_SBX
//   - SF_PARTNER_ID_PROD / SF_CHECKWORD_PROD / SF_API_BASE_PROD
//
// 部署：
//   scp index.ts ecs-user@47.242.242.233:/tmp/sf-index.ts
//   ssh ecs-user@47.242.242.233 'sudo mkdir -p /mnt/data/bizflow/supabase/docker/volumes/functions/track-shipments && sudo mv /tmp/sf-index.ts $_/index.ts'
//   ssh ecs-user@47.242.242.233 'cd /mnt/data/bizflow/supabase/docker && sudo docker compose -f docker-compose.yml -f docker-compose.pg17.yml restart functions'

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import md5 from "npm:js-md5@0.8.3";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

// ─────────────────────────────────────────────────
// 顺丰开放平台 client（独立模块化，方便 HK / 大陆切换）
// ─────────────────────────────────────────────────

interface SfRoute {
  acceptTime: string;             // "2026-05-07 16:46:14"（裸字符串，香港时间 UTC+8）
  acceptAddress: string;          // "香港"
  remark: string;                 // 详细文案
  opCode: string;                 // 老的细分 opCode 30/50/80...（仅供 raw 留底）
  firstStatusCode?: string;       // 1=已揽收 / 2=运送中 / 3=派送中 / 4=已签收 / 5+=异常
  firstStatusName?: string;       // "已揽收" / "运送中" / "派送中" / "已签收"
  secondaryStatusCode?: string;   // 101 / 201 / 301 ...
  secondaryStatusName?: string;   // 中文细分状态
}

interface SfRouteResponse {
  mailNo: string;
  routes: SfRoute[];
}

function md5Base64(input: string): string {
  // Deno std crypto 加载 WASM 失败，改用纯 JS 的 npm:js-md5
  const hashBuffer = md5.arrayBuffer(input);
  return encodeBase64(new Uint8Array(hashBuffer));
}

function getSfConfig() {
  const env = (Deno.env.get("SF_ENV") ?? "prod").toLowerCase();
  const isSbx = env === "sbx" || env === "sandbox" || env === "sandbox";
  const suffix = isSbx ? "SBX" : "PROD";
  return {
    env: isSbx ? "sbx" : "prod",
    partnerID: Deno.env.get(`SF_PARTNER_ID_${suffix}`),
    checkword: Deno.env.get(`SF_CHECKWORD_${suffix}`),
    endpoint:
      Deno.env.get(`SF_API_BASE_${suffix}`) ??
      `https://sfapi${isSbx ? "-sbox" : ""}.sf-express.com/std/service`,
  };
}

async function callSfRouteQuery(trackingNumber: string): Promise<SfRouteResponse | null> {
  const { env, partnerID, checkword, endpoint } = getSfConfig();

  if (!partnerID || !checkword) {
    console.error(`[SF] 凭证未配置：SF_PARTNER_ID_${env.toUpperCase()} / SF_CHECKWORD_${env.toUpperCase()} 必填`);
    return null;
  }

  const msgData = JSON.stringify({
    trackingType: "1",                  // 1 = 按运单号查
    trackingNumber: [trackingNumber],
    methodType: "1",                    // 1 = 全部路由 / 2 = 仅最新
  });

  const timestamp = String(Date.now());
  const msgDigest = md5Base64(msgData + timestamp + checkword);
  const requestID = crypto.randomUUID();    // Deno 全局 crypto，randomUUID 不走 WASM

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
      console.error(`[SF][${env}] API 返回错误：${json.apiResultCode} - ${json.apiErrorMsg}`);
      return null;
    }
    // apiResultData 是字符串化的 JSON，要二次解析
    const data = typeof json.apiResultData === "string"
      ? JSON.parse(json.apiResultData)
      : json.apiResultData;

    if (!data?.success) {
      console.error(`[SF][${env}] 业务返回错误：${data?.errorCode} - ${data?.errorMsg}`);
      return null;
    }
    return data.msgData?.routeResps?.[0] ?? null;
  } catch (e) {
    console.error(`[SF][${env}] 网络错误：${(e as Error).message}`);
    return null;
  }
}

// firstStatusCode → bizflow shipping_status 映射
//   1 = 已揽收 / 2 = 运送中 / 3 = 派送中 / 4 = 已签收 / 5+ = 异常
function mapSfFirstStatus(firstStatusCode: string | undefined, fallbackOpCode: string): string {
  switch (firstStatusCode) {
    case "1": return "已發貨";
    case "2": return "在途";
    case "3": return "派送中";
    case "4": return "已簽收";
  }
  // 无 firstStatusCode 时按老 opCode 逻辑兜底
  if (fallbackOpCode === "80" || fallbackOpCode === "8000") return "已簽收";
  if (fallbackOpCode === "70" || fallbackOpCode === "7000") return "異常";
  if (["44", "50", "5000", "204"].includes(fallbackOpCode)) return "派送中";
  if (["30", "31", "36", "54"].includes(fallbackOpCode)) return "在途";
  return "已發貨";
}

// 顺丰 acceptTime "2026-05-07 16:46:14" 是裸字符串，按香港时间 UTC+8 解析为 ISO
function parseSfTime(s: string): string {
  return new Date(s.replace(" ", "T") + "+08:00").toISOString();
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
      (a, b) => parseSfTime(a.acceptTime).localeCompare(parseSfTime(b.acceptTime)),
    );

    // upsert 事件（acceptTime 转 ISO 带 +08:00，避免 PG 当 UTC 错 8 小时）
    const events = sorted.map(r => ({
      invoice_id: inv.id,
      event_at: parseSfTime(r.acceptTime),
      location: r.acceptAddress,
      description: r.secondaryStatusName ? `${r.secondaryStatusName}：${r.remark}` : r.remark,
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

    // 更新 invoice 状态（基于最新一条的 firstStatusCode）
    const latest = sorted[sorted.length - 1];
    const newStatus = mapSfFirstStatus(latest.firstStatusCode, latest.opCode);
    const updates: Record<string, unknown> = {
      shipping_status: newStatus,
      shipping_last_synced_at: new Date().toISOString(),
    };
    if (newStatus === "已簽收") updates.delivered_at = parseSfTime(latest.acceptTime);

    await supabase.from("invoices").update(updates).eq("id", inv.id);
    results.updated++;
  }

  return new Response(JSON.stringify({ ok: true, ...results }), {
    headers: { "Content-Type": "application/json" },
  });
});
