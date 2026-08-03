import { getSession, getSupabaseClient } from "./auth.js";
import { invalidateLiveTables } from "./live-snapshot-utils.js";

async function writeContext() {
  const [client, session] = await Promise.all([getSupabaseClient(), getSession()]);
  if (!client || !session?.user) throw new Error("Supabase session required");
  return { client, session };
}

function throwIfError(error) {
  if (error) throw error;
}

async function finishWrite(result, ...tables) {
  throwIfError(result.error);
  await invalidateLiveTables(tables);
  return result.data;
}

export async function createTeamUpdateLog({ summary, detail }) {
  const { client, session } = await writeContext();
  const result = await client.from("team_update_logs").insert({
    summary,
    detail: detail || null,
    author_user_id: session.user.id
  }).select("*").single();
  return finishWrite(result, "team_update_logs");
}

export async function updateTeamUpdateLog(id, { summary, detail }) {
  const { client } = await writeContext();
  const result = await client.from("team_update_logs").update({
    summary,
    detail: detail || null,
    updated_at: new Date().toISOString()
  }).eq("id", id).select("*").single();
  return finishWrite(result, "team_update_logs");
}

export async function deleteTeamUpdateLog(id) {
  const { client } = await writeContext();
  const result = await client.from("team_update_logs").delete().eq("id", id).select("id").single();
  return finishWrite(result, "team_update_logs");
}

export async function createTeamUpdateComment({ updateLogId, authorName, body }) {
  const { client, session } = await writeContext();
  const result = await client.from("team_update_log_comments").insert({
    update_log_id: updateLogId,
    author_user_id: session.user.id,
    author_name: authorName,
    body
  }).select("*").single();
  return finishWrite(result, "team_update_log_comments");
}

export async function updateTeamUpdateComment(id, body) {
  const normalizedBody = String(body || "").trim();
  const { client } = await writeContext();
  const result = await client.from("team_update_log_comments").update({
    body: normalizedBody,
    updated_at: new Date().toISOString()
  }).eq("id", id).select("*").single();
  return finishWrite(result, "team_update_log_comments");
}

export async function deleteTeamUpdateComment(id) {
  const { client } = await writeContext();
  const result = await client.from("team_update_log_comments").delete().eq("id", id).select("id").single();
  return finishWrite(result, "team_update_log_comments");
}
