import { getSession, getSupabaseClient } from "./auth.js";

async function writeContext() {
  const [client, session] = await Promise.all([getSupabaseClient(), getSession()]);
  if (!client || !session?.user) throw new Error("Supabase session required");
  return { client, session };
}

function throwIfError(error) {
  if (error) throw error;
}

export async function createTeamUpdateLog({ summary, detail }) {
  const { client, session } = await writeContext();
  const result = await client.from("team_update_logs").insert({
    summary,
    detail: detail || null,
    author_user_id: session.user.id
  }).select("*").single();
  throwIfError(result.error);
  return result.data;
}

export async function updateTeamUpdateLog(id, { summary, detail }) {
  const { client } = await writeContext();
  const result = await client.from("team_update_logs").update({
    summary,
    detail: detail || null,
    updated_at: new Date().toISOString()
  }).eq("id", id).select("*").single();
  throwIfError(result.error);
  return result.data;
}

export async function deleteTeamUpdateLog(id) {
  const { client } = await writeContext();
  const result = await client.from("team_update_logs").delete().eq("id", id).select("id").single();
  throwIfError(result.error);
  return result.data;
}

export async function createTeamUpdateComment({ updateLogId, authorName, body }) {
  const { client, session } = await writeContext();
  const result = await client.from("team_update_log_comments").insert({
    update_log_id: updateLogId,
    author_user_id: session.user.id,
    author_name: authorName,
    body
  }).select("*").single();
  throwIfError(result.error);
  return result.data;
}

export async function deleteTeamUpdateComment(id) {
  const { client } = await writeContext();
  const result = await client.from("team_update_log_comments").delete().eq("id", id).select("id").single();
  throwIfError(result.error);
  return result.data;
}
