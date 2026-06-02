// wa-meta-webhook: 接 Meta Cloud API 推送的客户来信 + 状态回执
// GET  → Meta webhook 订阅验证（返回 hub.challenge 如果 verify token 对得上 wa_settings.meta_webhook_verify_token）
// POST → 解析 entry[].changes[].value.messages[]，翻译成 wa-message 的 MessagePayload，转发给 wa-message edge function
//        让它走 wa-message 的 channel='meta' 流程：记录历史 / 入 pending / 秒触发 wa-ai-trigger
// 环境变量自动注入：SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// 同步寫 wa_logs。wa-meta-webhook 本身所有日誌都是 Meta 通道事件，前綴一律 [Meta API]，channel='meta'
async function cloudLog(
  sb: ReturnType<typeof createClient>,
  category: string,
  message: string,
) {
  try { await sb.from("wa_logs").insert({ category, message: "[Meta API] " + message, channel: "meta" }); } catch (_) { /* swallow */ }
}

// HMAC-SHA256 验证 Meta webhook 签名
async function verifyMetaSignature(body: string, signatureHeader: string, appSecret: string): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = signatureHeader.slice(7);

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  // constant-time compare
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// 把 Meta message 转成 wa-message 的 MessagePayload，转发过去
async function forwardToWaMessage(
  msg: Record<string, unknown>,
  contacts: Array<Record<string, unknown>>,
  _metadata: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const from = String(msg.from || "");
  const wamid = String(msg.id || "");
  const type = String(msg.type || "");

  if (!from || !wamid) return { ok: false, error: "missing from/id" };

  const contact = contacts.find(c => String(c.wa_id) === from);
  const name = (contact?.profile as Record<string, unknown>)?.name as string || from;

  let content = "";
  let location: { lat: number; lng: number; placeName?: string; address?: string } | null = null;

  if (type === "text") {
    content = (msg.text as Record<string, unknown>)?.body as string || "";
  } else if (type === "location") {
    const loc = msg.location as Record<string, unknown>;
    const lat = Number(loc.latitude);
    const lng = Number(loc.longitude);
    if (!isNaN(lat) && !isNaN(lng)) {
      location = {
        lat, lng,
        placeName: loc.name as string | undefined,
        address: loc.address as string | undefined,
      };
    }
    content = `[位置]${loc.name ? " " + loc.name : ""}`;
  } else if (type === "image") {
    const img = msg.image as Record<string, unknown>;
    content = "[图片]" + (img.caption ? " " + img.caption : "");
  } else if (type === "audio") {
    content = "[语音]";
  } else if (type === "video") {
    const vid = msg.video as Record<string, unknown>;
    content = "[视频]" + (vid.caption ? " " + vid.caption : "");
  } else if (type === "document") {
    const doc = msg.document as Record<string, unknown>;
    content = "[文档]" + (doc.filename ? " " + doc.filename : "");
  } else if (type === "interactive") {
    // 按钮点击 / 列表选择
    const inter = msg.interactive as Record<string, unknown>;
    const btn = inter.button_reply as Record<string, unknown> | undefined;
    const list = inter.list_reply as Record<string, unknown> | undefined;
    const choiceId = String(btn?.id || list?.id || "");
    const title = String(btn?.title || list?.title || "[Interactive reply]");
    const mapChoice = choiceId.match(/^hm_map:([-0-9.]+),([-0-9.]+)$/);
    if (choiceId === "hm_entry:product_consult") {
      content = "Product enquiry";
    } else if (choiceId === "hm_entry:nearby_chargers") {
      content = "Nearby chargers";
    } else if (mapChoice) {
      content = `我想導航到：${title}\nhttps://maps.google.com/maps?daddr=${mapChoice[1]},${mapChoice[2]}`;
    } else {
      content = title;
    }
  } else if (type === "reaction") {
    // 表情反应消息，不入处理流程，仅记日志后丢弃
    return { ok: true };
  } else {
    content = `[${type}]`;
  }

  const payload = {
    msg_id: "meta:" + wamid,           // 避免跟 chrome extension 的 msg_id 冲突
    customer_id: from,
    chat_name: name,
    is_group: false,                    // Meta Cloud API 不支持 group，全是私聊
    content,
    location,
    channel: "meta",                    // 后续 wa-message / wa-ai-trigger 据此走 Meta 分支：跳过合并 / 跳过 60s 抢答 / 不分段 / Meta API 出站
  };

  const url = `${SUPABASE_URL}/functions/v1/wa-message`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + SERVICE_KEY,
      },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 200) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ─── GET：webhook 订阅验证 ───
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const verifyToken = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const settingsRes = await sb.from("wa_settings").select("meta_webhook_verify_token").eq("id", 1).maybeSingle();
    const expected = settingsRes.data?.meta_webhook_verify_token as string | undefined;

    if (!expected) {
      cloudLog(sb, "错误", "wa-meta-webhook GET：wa_settings.meta_webhook_verify_token 未设置，无法验证");
      return new Response("Webhook verify token not configured", { status: 500 });
    }

    if (mode === "subscribe" && verifyToken === expected && challenge) {
      cloudLog(sb, "Meta-Webhook", "订阅验证通过");
      return new Response(challenge, { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } });
    }

    cloudLog(sb, "Meta-Webhook", `订阅验证失败：mode=${mode}, tokenMatch=${verifyToken === expected}`);
    return new Response("Forbidden", { status: 403 });
  }

  // ─── POST：Meta 推送消息 / 状态回执 ───
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const bodyText = await req.text();

  // 签名验证（如果配了 meta_app_secret）
  const settingsRes = await sb.from("wa_settings").select("meta_app_secret").eq("id", 1).maybeSingle();
  const appSecret = settingsRes.data?.meta_app_secret as string | undefined;
  if (appSecret) {
    const sigHeader = req.headers.get("x-hub-signature-256") || "";
    const ok = await verifyMetaSignature(bodyText, sigHeader, appSecret);
    if (!ok) {
      cloudLog(sb, "错误", "wa-meta-webhook 签名验证失败，丢弃 payload");
      return new Response("Invalid signature", { status: 401 });
    }
  }
  // 如果没配 appSecret 就跳过验证（开发期可以不配，但生产强烈建议配）

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (payload.object !== "whatsapp_business_account") {
    // 不是 WA 推送，可能是其他 product。Meta 要求 200，否则 retry 风暴
    return new Response(JSON.stringify({ ok: true, ignored: true, reason: "not whatsapp_business_account" }), {
      status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const entries = (payload.entry as Array<Record<string, unknown>>) || [];
  const results: Array<{ wamid?: string; ok: boolean; error?: string }> = [];
  let statusCount = 0;

  for (const entry of entries) {
    const changes = (entry.changes as Array<Record<string, unknown>>) || [];
    for (const change of changes) {
      if (change.field !== "messages") continue;
      const value = (change.value as Record<string, unknown>) || {};
      const contacts = (value.contacts as Array<Record<string, unknown>>) || [];
      const messages = (value.messages as Array<Record<string, unknown>>) || [];
      const statuses = (value.statuses as Array<Record<string, unknown>>) || [];
      const metadata = (value.metadata as Record<string, unknown>) || {};

      // 处理客户来信
      for (const msg of messages) {
        const r = await forwardToWaMessage(msg, contacts, metadata);
        results.push({ wamid: String(msg.id || ""), ...r });
      }

      // 处理状态回执（sent / delivered / read / failed）— 写到 wa_replies.delivery_meta，方便审计
      // 不严格匹配 wa_replies 行（wamid 数组在 delivery_meta JSON 里，PG 查 JSON contains 太重）
      // 简化：只记 cloudLog 日志，让 dashboard 可见。需要严格回执可后续补 ON wa_replies(wamids)
      for (const st of statuses) {
        statusCount++;
        const stType = String(st.status || "unknown");
        const recipientId = String(st.recipient_id || "");
        if (stType === "failed") {
          const errors = (st.errors as Array<Record<string, unknown>>) || [];
          const errMsg = errors[0] ? `${(errors[0].title as string) || ""} ${(errors[0].message as string) || ""}`.trim() : "unknown";
          cloudLog(sb, "错误", `Meta status failed: ${recipientId} ${errMsg.slice(0, 200)}`);
        } else if (stType === "delivered" || stType === "read") {
          cloudLog(sb, "Meta-Status", `${stType}: ${recipientId}`);
        }
        // sent / queued 这些不写日志（太多噪音）
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, messages: results.length, statuses: statusCount, results }), {
    status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
