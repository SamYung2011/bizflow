import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildTeamTaskPrompt,
  departmentNamesForEmployee,
  hongKongDate,
  normalizeTeamParseInput,
  parsedTasksFailure,
  safeJson,
  sanitizeParsedTasks,
  TeamParseContractError,
} from "./contract.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function failure(code: string, message: string, status: number, diagnostic = "") {
  return json({ code, error: message, ...(diagnostic ? { diagnostic } : {}) }, status);
}

function bearerToken(req: Request) {
  const match = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function uniqueNames(values: unknown[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function upstreamDiagnostic(error: unknown) {
  const name = error instanceof Error ? error.name : "unknown";
  return `network_${String(name || "unknown").toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 40)}`;
}

async function callOpenAI(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  text: string;
}) {
  const response = await fetch(`${options.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.text },
      ],
      max_tokens: 8192,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(55_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new TeamParseContractError(`upstream_http_${response.status}`);
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new TeamParseContractError("upstream_empty_content");
  }
  return content;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return failure("method_not_allowed", "Method not allowed", 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return failure("server_misconfigured", "Server is not configured", 500);
  }

  let input: { text: string; companyId: string };
  try {
    input = normalizeTeamParseInput(await req.json());
  } catch (error) {
    const code = error instanceof TeamParseContractError ? error.code : "invalid_request";
    return failure(code, "Invalid request", 400);
  }

  const token = bearerToken(req);
  if (!token) return failure("auth_required", "Authentication required", 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    return failure("invalid_token", "Invalid authentication token", 401);
  }

  const employeeResult = await admin
    .from("employees")
    .select("id,name,is_super_admin")
    .eq("user_id", userData.user.id)
    .order("id", { ascending: true })
    .limit(1);
  if (employeeResult.error) return failure("employee_lookup_failed", "Employee lookup failed", 500);
  const employee = employeeResult.data?.[0];
  if (!employee?.id) return failure("not_company_member", "Company membership required", 403);

  const membershipResult = await admin
    .from("employee_companies")
    .select("company_id,is_company_admin")
    .eq("employee_id", employee.id)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (membershipResult.error) return failure("membership_lookup_failed", "Company membership lookup failed", 500);
  if (!membershipResult.data) return failure("not_company_member", "Company membership required", 403);

  const companyResult = await admin
    .from("companies")
    .select("id,feature_ai_batch")
    .eq("id", input.companyId)
    .maybeSingle();
  if (companyResult.error) return failure("company_lookup_failed", "Company lookup failed", 500);
  if (companyResult.data?.feature_ai_batch !== true) {
    return failure("feature_not_enabled", "AI task parsing is not enabled", 403);
  }

  const unrestrictedDepartments = employee.is_super_admin === true
    || membershipResult.data.is_company_admin === true;
  const [departmentResult, employeeDepartmentResult, colleagueResult, settingsResult] = await Promise.all([
    admin.from("departments").select("id,name").eq("company_id", input.companyId),
    unrestrictedDepartments
      ? Promise.resolve({ data: [] as { department_id: string }[], error: null })
      : admin.from("employee_departments")
        .select("department_id")
        .eq("employee_id", employee.id),
    admin.from("employee_companies")
      .select("employee_id,employees!inner(name)")
      .eq("company_id", input.companyId),
    admin.from("wa_settings")
      .select("openai_api_key,openai_base_url,model")
      .eq("id", 1)
      .maybeSingle(),
  ]);
  if (departmentResult.error || employeeDepartmentResult.error || colleagueResult.error) {
    return failure("company_context_failed", "Company context lookup failed", 500);
  }
  if (settingsResult.error || !settingsResult.data?.openai_api_key) {
    return failure("ai_not_configured", "AI is not configured", 503);
  }

  const meName = String(employee.name || "").trim() || "當前使用者";
  const departmentNames = departmentNamesForEmployee(
    departmentResult.data ?? [],
    employeeDepartmentResult.data ?? [],
    unrestrictedDepartments,
  );
  const colleagueNames = uniqueNames((colleagueResult.data ?? [])
    .map((row) => {
      const related = (row as unknown as { employees?: { name?: unknown } | { name?: unknown }[] }).employees;
      return Array.isArray(related) ? related[0]?.name : related?.name;
    })
    .filter((name) => String(name || "").trim() !== meName));
  const settings = settingsResult.data;

  let content: string;
  try {
    content = await callOpenAI({
      baseUrl: String(settings.openai_base_url || "https://api.deepseek.com"),
      apiKey: String(settings.openai_api_key),
      model: String(settings.model || "deepseek-chat"),
      systemPrompt: buildTeamTaskPrompt({
        meName,
        colleagueNames,
        departmentNames,
        today: hongKongDate(),
      }),
      text: input.text,
    });
  } catch (error) {
    const diagnostic = error instanceof TeamParseContractError
      ? error.code
      : upstreamDiagnostic(error);
    return failure("ai_upstream_failed", "AI upstream request failed", 502, diagnostic);
  }

  try {
    const tasks = sanitizeParsedTasks(safeJson(content), departmentNames);
    return json({ tasks });
  } catch (error) {
    const detail = parsedTasksFailure(error);
    return failure(detail.code, "AI returned an invalid task response", 502, detail.diagnostic);
  }
});
