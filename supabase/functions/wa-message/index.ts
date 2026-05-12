// wa-message: Chrome 扩展 POST 進來的 WhatsApp 消息
// 流程：幂等去重 → 寫 wa_messages（user role）→ 真人接手寫冷卻 / 否則寫 wa_pending_replies
// 環境變量自動注入：SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LocationPayload {
  lat: number;
  lng: number;
  placeName?: string;
  address?: string;
}

interface MessagePayload {
  msg_id: string;              // 扩展生成的唯一 ID（去重用）
  customer_id: string;         // 私聊：手機號 / 群聊：chatId
  chat_name?: string;
  is_group?: boolean;
  sender?: string;             // 群聊發送人
  content: string;
  visible_context?: unknown[]; // 群聊用：可見的最近對話
  is_staff?: boolean;          // true = 真人客服在發消息（觸發冷卻）
  location?: LocationPayload | null; // 位置消息：lat/lng/地點名（給 wa-ai-trigger 查 EPD 用）
}

const MERGE_WINDOW_MS = 7000; // 同 customer 7 秒內已有 pending 就合併，避免連發問題各自獨立調用 AI

// 從文本中嘗試解析 Google Maps 鏈接抠 lat/lng（兜底 content.js 不識別「粘貼的鏈接」場景）
// content.js parseLocationFromEl 只認 WhatsApp 原生位置卡片的 DOM 結構（staticmap?markers=...）
// 但客戶常複製 Google Maps 鏈接過來（普通文字消息）→ location=null → EPD 查不到
function parseLocationFromText(content: string): LocationPayload | null {
  if (!content) return null;
  // 三種常見格式：?q=lat,lng / @lat,lng / /lat,lng
  const patterns = [
    /maps\.google\.[^\s]*[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /maps\.google\.[^\s]*@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /maps\.google\.[^\s]*\/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:[,\/]|$)/i,
  ];
  for (const re of patterns) {
    const m = content.match(re);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) {
        return { lat, lng };
      }
    }
  }
  return null;
}

// 同步寫 wa_logs，跟本地 server.js 用同一張表 + 同一套 category 名（dashboard 共享顏色）。
// 加 [云] 前綴方便 dashboard 一眼分辨來源。失敗吞掉，不阻擋主流程。
async function cloudLog(
  sb: ReturnType<typeof createClient>,
  category: string,
  message: string,
) {
  try { await sb.from("wa_logs").insert({ category, message: "[云] " + message }); } catch (_) { /* swallow */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  let body: MessagePayload;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  if (!body.msg_id || !body.customer_id || !body.content) {
    return new Response(JSON.stringify({ error: "missing msg_id/customer_id/content" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const chatLabel = body.is_group ? `群:${body.chat_name || body.customer_id}` : `客戶:${body.customer_id}`;
  const senderLabel = body.sender ? ` (${body.sender})` : "";

  // 1. 幂等去重
  const dup = await sb.from("wa_processed_messages").select("msg_id").eq("msg_id", body.msg_id).maybeSingle();
  if (dup.data) {
    cloudLog(sb, "跳过", `重複 msg_id=${body.msg_id.slice(-10)} ${chatLabel}`);
    return new Response(JSON.stringify({ ok: true, duplicate: true }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
  await sb.from("wa_processed_messages").insert({ msg_id: body.msg_id, customer_id: body.customer_id });

  // 收到日誌（content 截 50 字，避免敏感原話 + 日誌過長）
  cloudLog(sb, "收到", `${chatLabel}${senderLabel} → ${body.content.slice(0, 50)}${body.content.length > 50 ? "…" : ""}`);

  // 客戶端未傳 location（v1.2 只認 WhatsApp 原生位置卡片）→ 從文本兜底解析 Google Maps 鏈接
  if (!body.location) {
    const parsed = parseLocationFromText(body.content);
    if (parsed) {
      body.location = parsed;
      cloudLog(sb, "收到", `${chatLabel} 從文本解析位置 lat=${parsed.lat.toFixed(5)}, lng=${parsed.lng.toFixed(5)}（粘貼的 Maps 鏈接）`);
    }
  } else {
    cloudLog(sb, "收到", `${chatLabel} 位置消息 lat=${body.location.lat.toFixed(5)}, lng=${body.location.lng.toFixed(5)}${body.location.placeName ? " (" + body.location.placeName + ")" : ""}`);
  }

  // 2. 寫對話記錄（即使是 staff / 冷卻中也寫，保留完整對話）
  await sb.from("wa_messages").insert({
    customer_id: body.customer_id,
    role: body.is_staff ? "assistant" : "user",
    content: body.content,
  });

  const chatId = body.is_group ? (body.chat_name || body.customer_id) : body.customer_id;

  // 3. 真人接手 → 寫冷卻 + 取消同 chat 的 pending
  if (body.is_staff) {
    const cooledUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
    await sb.from("wa_cooldowns").upsert({
      chat_id: chatId,
      is_group: !!body.is_group,
      cooled_until: cooledUntil,
      triggered_by: body.sender || "unknown",
      triggered_at: new Date().toISOString(),
    }, { onConflict: "chat_id" });
    // 取消該 chat 所有 pending
    const cancelKey = body.is_group ? "chat_name" : "customer_id";
    await sb.from("wa_pending_replies").update({ status: "cancelled", cancelled_reason: "staff_took_over" })
      .eq(cancelKey, chatId).eq("status", "pending");
    cloudLog(sb, "跳过", `真人接手 ${chatLabel}${senderLabel}，已取消同 chat pending + 30min 冷卻`);
    return new Response(JSON.stringify({ ok: true, staff_took_over: true }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  // 4. 檢查是否冷卻中
  const cd = await sb.from("wa_cooldowns").select("cooled_until").eq("chat_id", chatId).maybeSingle();
  if (cd.data && new Date(cd.data.cooled_until) > new Date()) {
    cloudLog(sb, "跳过", `冷卻中 ${chatLabel} until ${new Date(cd.data.cooled_until).toLocaleTimeString("zh-HK", { hour12: false })}`);
    return new Response(JSON.stringify({ ok: true, in_cooldown: true, cooled_until: cd.data.cooled_until }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  // 5a. 合併窗口：同 customer 5 秒內已有 pending → append content 到既有 pending
  //     避免客戶連發 N 條問題 → AI 各自獨立調用 N 次 + 觸發 rate_limit cancel
  const mergeSince = new Date(Date.now() - MERGE_WINDOW_MS).toISOString();
  const existing = await sb.from("wa_pending_replies")
    .select("id, content, location")
    .eq("customer_id", body.customer_id)
    .eq("status", "pending")
    .gte("received_at", mergeSince)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.data) {
    // 群聊合併時加 sender 前綴避免 AI 混淆誰說的
    const prefix = body.is_group && body.sender ? `[${body.sender}] ` : "";
    const newContent = `${existing.data.content}\n${prefix}${body.content}`;
    // 新消息帶 location 而舊的沒 → 補上；都有就保留舊的（最早的位置上下文）
    const newLocation = existing.data.location || body.location || null;
    const upd = await sb.from("wa_pending_replies")
      .update({ content: newContent, location: newLocation })
      .eq("id", existing.data.id);
    if (upd.error) {
      cloudLog(sb, "错误", `合併 pending#${existing.data.id} 失敗：${upd.error.message}`);
    } else {
      const segs = newContent.split("\n").length;
      cloudLog(sb, "回复入队", `pending#${existing.data.id} 合併（共 ${segs} 條）${chatLabel}`);
    }
    return new Response(JSON.stringify({ ok: true, merged_into: existing.data.id }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // 5b. 否則正常 INSERT 新 pending（等 60s 抢答）
  const ins = await sb.from("wa_pending_replies").insert({
    customer_id: body.customer_id,
    chat_name: body.chat_name || null,
    is_group: !!body.is_group,
    sender: body.sender || null,
    content: body.content,
    visible_context: body.visible_context ? JSON.stringify(body.visible_context) : null,
    location: body.location || null,
    status: "pending",
  }).select("id").single();

  if (ins.error) {
    cloudLog(sb, "错误", `wa-message pending insert 失敗：${ins.error.message}`);
  } else {
    cloudLog(sb, "回复入队", `pending#${ins.data?.id} ${chatLabel}（等 60s 真人搶答）`);
  }

  return new Response(JSON.stringify({ ok: true, pending_id: ins.data?.id, error: ins.error?.message }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
