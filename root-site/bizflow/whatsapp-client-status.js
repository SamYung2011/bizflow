export const WHATSAPP_CLIENT_HEARTBEAT_INTERVAL_MS = 5_000;
export const WHATSAPP_CLIENT_ONLINE_THRESHOLD_MS = 25_000;

export function whatsappClientLastSeenTime(value) {
  const raw = String(value || "").trim().replaceAll("/", "-").replace(" ", "T");
  if (!raw) return Number.NaN;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}+08:00`;
  return Date.parse(zoned);
}

export function whatsappClientOnlineState(clients, now = Date.now()) {
  let latestClient = null;
  let latestAt = Number.NaN;

  for (const client of Array.isArray(clients) ? clients : []) {
    const lastSeenAt = whatsappClientLastSeenTime(client?.lastSeen);
    if (!Number.isFinite(lastSeenAt) || (Number.isFinite(latestAt) && lastSeenAt <= latestAt)) continue;
    latestClient = client;
    latestAt = lastSeenAt;
  }

  if (!latestClient) {
    return { status: "never", client: null, lastSeen: "", lastSeenAt: Number.NaN };
  }

  return {
    status: now - latestAt < WHATSAPP_CLIENT_ONLINE_THRESHOLD_MS ? "online" : "offline",
    client: latestClient,
    lastSeen: String(latestClient.lastSeen || ""),
    lastSeenAt: latestAt
  };
}
