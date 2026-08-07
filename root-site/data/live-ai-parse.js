import { getSession, getSupabaseClient } from "./auth.js";

export const TEAM_PARSE_EDGE_FUNCTION = "team-parse-tasks";

export class TeamAiParseError extends Error {
  constructor(code, status = 0, diagnostic = "") {
    super(code);
    this.name = "TeamAiParseError";
    this.code = code;
    this.status = status;
    this.diagnostic = diagnostic;
  }
}

async function edgeContext() {
  const [session, client] = await Promise.all([getSession(), getSupabaseClient()]);
  if (!session?.user || !session.access_token) throw new TeamAiParseError("auth_required", 401);
  if (!client?.supabaseUrl || !client?.supabaseKey) throw new TeamAiParseError("config_error");
  return {
    accessToken: session.access_token,
    anonKey: client.supabaseKey,
    baseUrl: String(client.supabaseUrl).replace(/\/+$/, ""),
  };
}

function responseCode(payload, fallback) {
  const code = typeof payload?.code === "string" ? payload.code : "";
  return code || fallback;
}

export async function callTeamTaskParser(
  { text, companyId, signal },
  { loadContext = edgeContext, fetchImpl = fetch } = {},
) {
  const context = await loadContext();
  let response;
  try {
    response = await fetchImpl(
      `${context.baseUrl}/functions/v1/${TEAM_PARSE_EDGE_FUNCTION}`,
      {
        method: "POST",
        cache: "no-store",
        signal,
        headers: {
          "Content-Type": "application/json",
          apikey: context.anonKey,
          Authorization: `Bearer ${context.accessToken}`,
        },
        body: JSON.stringify({ text, companyId }),
      },
    );
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new TeamAiParseError("network_error");
  }

  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new TeamAiParseError("response_error", response.status);
  }
  if (!response.ok) {
    throw new TeamAiParseError(
      responseCode(payload, "upstream_error"),
      response.status,
      typeof payload?.diagnostic === "string" ? payload.diagnostic : "",
    );
  }
  if (!Array.isArray(payload?.tasks) || payload.tasks.length === 0) {
    throw new TeamAiParseError("no_tasks", response.status);
  }
  return payload.tasks;
}
