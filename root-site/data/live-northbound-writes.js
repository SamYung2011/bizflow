import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";
import { invalidateLiveTables } from "./live-snapshot-utils.js";
import { invalidateLiveSnapshot } from "./live-snapshots.js";

const RECORD_FIELDS = new Set([
  "remarks",
  "submitted_at",
  "submitted_end_at",
  "name",
  "plate_no",
  "hkid",
  "phone_hk",
  "phone_mainland",
  "address",
  "hrp_no",
  "status_id"
]);

async function writeContext() {
  const [client, session, currentUser] = await Promise.all([
    getSupabaseClient(),
    getSession(),
    getCurrentUser()
  ]);
  if (!client || !session?.user || currentUser?.bizflowMainAccess !== true) {
    throw new Error("Authenticated northbound write context required");
  }
  return { client, currentUser };
}

function throwIfError(error) {
  if (error) throw error;
}

function textOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function dateOrNull(value) {
  return value ? String(value) : null;
}

function recordPatch(values) {
  const patch = {};
  Object.entries(values ?? {}).forEach(([field, value]) => {
    if (!RECORD_FIELDS.has(field)) return;
    if (["submitted_at", "submitted_end_at"].includes(field)) patch[field] = dateOrNull(value);
    else if (field === "status_id") patch[field] = value || null;
    else patch[field] = textOrNull(value);
  });
  if (!Object.keys(patch).length) throw new Error("Northbound update requires a supported field");
  return patch;
}

async function invalidateNorthboundReads() {
  await invalidateLiveTables("northbound_records", "northbound_statuses");
  invalidateLiveSnapshot("northbound.json");
}

export async function updateLiveNorthboundRecord(id, values) {
  const { client } = await writeContext();
  const result = await client.from("northbound_records")
    .update(recordPatch(values))
    .eq("id", id)
    .select("*")
    .single();
  throwIfError(result.error);
  await invalidateNorthboundReads();
  return result.data;
}

export async function createLiveNorthboundRecord(values) {
  const { client } = await writeContext();
  const payload = recordPatch(values);
  if (!payload.name) throw new Error("Northbound record requires a name");
  const result = await client.from("northbound_records").insert(payload).select("*").single();
  throwIfError(result.error);
  await invalidateNorthboundReads();
  return result.data;
}

export async function deleteLiveNorthboundRecord(id) {
  const { client } = await writeContext();
  const result = await client.from("northbound_records").delete().eq("id", id).select("id").single();
  throwIfError(result.error);
  await invalidateNorthboundReads();
  return result.data;
}

export async function createLiveNorthboundStatus({ label, color, sortOrder }) {
  const { client } = await writeContext();
  const result = await client.from("northbound_statuses").insert({
    label: textOrNull(label),
    color: textOrNull(color),
    sort_order: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0
  }).select("*").single();
  throwIfError(result.error);
  await invalidateNorthboundReads();
  return result.data;
}
