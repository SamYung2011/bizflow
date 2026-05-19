// wa-unlock: 安全解鎖 WhatsApp 設置內的敏感欄位（admin_password / openai_api_key）
// 修法見 bizflow_roadmap：原本前端 select('*') 把 admin_password / openai_api_key 拉到 localStorage 明文存
// → AppContext 改 explicit 列不拉敏感欄位 → 這個 Edge Function 用 service_role 在 server 端比對密碼 + 返回 / 寫入
// 環境變量自動注入：SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface UnlockPayload {
  action: "unlock" | "save-secrets" | "set-initial-password";
  pwd?: string; // 解鎖密碼（unlock / save-secrets 必填）
  newAdminPassword?: string; // 修改 admin_password 用
  newApiKey?: string; // 修改 openai_api_key 用
  initialPassword?: string; // 首次設密碼用（admin_password 為空時）
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: UnlockPayload;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 拿當前 wa_settings 的 admin_password + openai_api_key（service_role 才能讀）
  const { data: settings, error: readErr } = await supabase
    .from("wa_settings")
    .select("admin_password, openai_api_key")
    .eq("id", 1)
    .maybeSingle();
  if (readErr) return json({ error: `Read failed: ${readErr.message}` }, 500);

  const currentPwd = settings?.admin_password || "";

  // ── action: set-initial-password ─────────────────────────────────────────
  // 首次設密碼：admin_password 必須為空（防止覆蓋已設好的密碼）
  if (body.action === "set-initial-password") {
    if (currentPwd) return json({ error: "Password already set, use save-secrets" }, 400);
    if (!body.initialPassword || !body.initialPassword.trim()) return json({ error: "Empty password" }, 400);
    const { error: updErr } = await supabase
      .from("wa_settings")
      .update({ admin_password: body.initialPassword.trim() })
      .eq("id", 1);
    if (updErr) return json({ error: `Update failed: ${updErr.message}` }, 500);
    return json({ ok: true });
  }

  // ── 以下 action 都需要驗 pwd ───────────────────────────────────────────────
  if (!currentPwd) return json({ error: "Password not set", needsInitialPassword: true }, 401);
  if (!body.pwd || body.pwd !== currentPwd) return json({ error: "Wrong password" }, 401);

  // ── action: unlock ───────────────────────────────────────────────────────
  // 比對成功，返回 openai_api_key 給前端 component state 暫存（解鎖期間用）
  if (body.action === "unlock") {
    return json({ ok: true, openai_api_key: settings.openai_api_key || "" });
  }

  // ── action: save-secrets ─────────────────────────────────────────────────
  // 已解鎖狀態下保存敏感欄位（修改 password 或 api_key）
  if (body.action === "save-secrets") {
    const patch: Record<string, string> = {};
    if (typeof body.newAdminPassword === "string" && body.newAdminPassword.trim()) {
      patch.admin_password = body.newAdminPassword.trim();
    }
    if (typeof body.newApiKey === "string") {
      patch.openai_api_key = body.newApiKey;
    }
    if (Object.keys(patch).length === 0) return json({ error: "Nothing to update" }, 400);
    const { error: updErr } = await supabase
      .from("wa_settings")
      .update(patch)
      .eq("id", 1);
    if (updErr) return json({ error: `Update failed: ${updErr.message}` }, 500);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
