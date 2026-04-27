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

interface MessagePayload {
  msg_id: string;              // 扩展生成的唯一 ID（去重用）
  customer_id: string;         // 私聊：手機號 / 群聊：chatId
  chat_name?: string;
  is_group?: boolean;
  sender?: string;             // 群聊發送人
  content: string;
  visible_context?: unknown[]; // 群聊用：可見的最近對話
  is_staff?: boolean;          // true = 真人客服在發消息（觸發冷卻）
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

  // 1. 幂等去重
  const dup = await sb.from("wa_processed_messages").select("msg_id").eq("msg_id", body.msg_id).maybeSingle();
  if (dup.data) {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
  await sb.from("wa_processed_messages").insert({ msg_id: body.msg_id, customer_id: body.customer_id });

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
    return new Response(JSON.stringify({ ok: true, staff_took_over: true }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  // 4. 檢查是否冷卻中
  const cd = await sb.from("wa_cooldowns").select("cooled_until").eq("chat_id", chatId).maybeSingle();
  if (cd.data && new Date(cd.data.cooled_until) > new Date()) {
    return new Response(JSON.stringify({ ok: true, in_cooldown: true, cooled_until: cd.data.cooled_until }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  // 5. 寫 wa_pending_replies 排隊等 60s 抢答
  const ins = await sb.from("wa_pending_replies").insert({
    customer_id: body.customer_id,
    chat_name: body.chat_name || null,
    is_group: !!body.is_group,
    sender: body.sender || null,
    content: body.content,
    visible_context: body.visible_context ? JSON.stringify(body.visible_context) : null,
    status: "pending",
  }).select("id").single();

  return new Response(JSON.stringify({ ok: true, pending_id: ins.data?.id, error: ins.error?.message }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
