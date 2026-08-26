import { getShopifyCredentialHealth, shopifyWriteReady } from "../data/live-inventory-writes.js";

export function inventoryWriteAccess({ authenticated, isAdmin, checking, health }) {
  const healthChecking = Boolean(authenticated && isAdmin && checking);
  const ready = Boolean(isAdmin && !healthChecking && shopifyWriteReady(health));
  const liveReadOnly = Boolean(authenticated && (!isAdmin || healthChecking || !ready));
  return {
    checking: healthChecking,
    ready,
    liveReadOnly,
    writeAttributes: liveReadOnly ? ' disabled aria-disabled="true"' : "",
  };
}

export async function runInventoryHealthCheck({
  isCurrent,
  loadHealth = getShopifyCredentialHealth,
  onSettled,
}) {
  let health = null;
  try {
    health = await loadHealth({ refresh: true });
  } catch {
    // A rejected health request uses the same fail-closed not-ready state.
  }
  if (!isCurrent()) return false;
  onSettled(health);
  return true;
}
