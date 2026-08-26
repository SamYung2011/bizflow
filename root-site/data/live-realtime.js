import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";
import { invalidateLiveTableData, refreshLiveTables } from "./live-snapshot-utils.js";
import { WHATSAPP_REALTIME_TABLES } from "./live-whatsapp-contract.js";

const SHARED_REALTIME_TABLES = Object.freeze([
  "employee_tasks",
  "task_assignees",
  "employee_task_feedbacks",
  "employees",
  "employee_departments"
]);
const BIZFLOW_TABLES = Object.freeze([
  "invoices",
  "customers",
  "charger_leads",
  "northbound_records",
  "northbound_statuses",
  "shipment_events",
  "products",
  "inventory_stock",
  "inventory_movements",
  "shopify_catalog_bindings",
  "shopify_variant_links",
  "shopify_resource_mappings",
  // expense_reimbursements: RLS (migration 088) requires has_bizflow_main_access()
  // for every row (own-row select for the submitter, or can_admin_expenses() for
  // reviewers) -- identical to this list's own isBfAdmin||bizflowMainAccess gate,
  // so every possible row owner already qualifies for this push. Fixes G-exp-8/E4:
  // non-admin reimbursement submitters were never subscribed, so their own
  // "我的報銷" edits never crossed tabs. See VERIFY-ROUND-B.md E4.
  "expense_reimbursements",
  ...WHATSAPP_REALTIME_TABLES
]);
const INVALIDATION_DELAY_MS = 250;
export const REALTIME_CATCH_UP_MIN_INTERVAL_MS = 60_000;

export function visibleRealtimeTables(currentUser) {
  if (!currentUser?.userId) return [];
  const tables = [...SHARED_REALTIME_TABLES];
  if (currentUser.isBfAdmin === true || currentUser.bizflowMainAccess === true) {
    tables.push(...BIZFLOW_TABLES);
  }
  return tables;
}

export function createLiveRealtimeManager({
  loadClient,
  loadSession,
  loadCurrentUser,
  invalidateTables,
  refreshTables,
  markTablesStale = invalidateTables,
  invalidationDelay = INVALIDATION_DELAY_MS,
  catchUpMinInterval = REALTIME_CATCH_UP_MIN_INTERVAL_MS,
  now = Date.now,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
  warn = console.warn
}) {
  let channel = null;
  let client = null;
  let userId = "";
  let tableSignature = "";
  let subscribedOnce = false;
  let disconnectedAfterSubscribe = false;
  let stopping = false;
  let ensurePromise = null;
  let flushTimer = null;
  let flushChain = Promise.resolve();
  let generation = 0;
  let pendingGeneration = 0;
  let lastCatchUpAt = Number.NEGATIVE_INFINITY;
  const pendingTables = new Set();

  function queueCatchUp(tables, channelGeneration = generation) {
    if (channelGeneration !== generation) return;
    const requestedAt = now();
    if (requestedAt - lastCatchUpAt < catchUpMinInterval) return;
    lastCatchUpAt = requestedAt;
    flushChain = flushChain
      .then(async () => {
        if (channelGeneration !== generation) return;
        await markTablesStale(tables);
      })
      .catch((error) => warn("[live-realtime] catch-up failed", error));
  }

  function queueInvalidation(tables, channelGeneration = generation) {
    if (channelGeneration !== generation) return;
    if (pendingGeneration !== channelGeneration) {
      pendingTables.clear();
      pendingGeneration = channelGeneration;
    }
    tables.forEach((table) => pendingTables.add(table));
    if (flushTimer !== null) return;
    flushTimer = scheduleTimeout(() => {
      flushTimer = null;
      const targets = [...pendingTables];
      const flushGeneration = pendingGeneration;
      pendingTables.clear();
      if (!targets.length) return;
      flushChain = flushChain
        .then(async () => {
          if (flushGeneration !== generation) return;
          await invalidateTables(targets);
          if (flushGeneration !== generation) return;
          await refreshTables(targets);
        })
        .catch((error) => warn("[live-realtime] invalidation failed", error));
    }, invalidationDelay);
  }

  async function removeCurrentChannel() {
    stopping = true;
    generation += 1;
    pendingGeneration = generation;
    if (flushTimer !== null) {
      cancelTimeout(flushTimer);
      flushTimer = null;
    }
    pendingTables.clear();
    const currentChannel = channel;
    channel = null;
    if (client && currentChannel) await client.removeChannel(currentChannel);
    stopping = false;
    subscribedOnce = false;
    disconnectedAfterSubscribe = false;
    lastCatchUpAt = Number.NEGATIVE_INFINITY;
  }

  function handleStatus(status, channelGeneration, tables) {
    if (channelGeneration !== generation) return;
    if (status === "SUBSCRIBED") {
      const firstSubscribe = !subscribedOnce;
      const reconnected = subscribedOnce && disconnectedAfterSubscribe;
      subscribedOnce = true;
      disconnectedAfterSubscribe = false;
      // A repeated SUBSCRIBED with no disconnect in between is neither -- stay quiet
      // so a chatty transport cannot turn into a refresh loop.
      // Catch-up only marks persisted rows stale. The next page read serves those rows
      // immediately and revalidates on demand instead of eagerly refetching every table.
      if (firstSubscribe || reconnected) queueCatchUp(tables, channelGeneration);
      return;
    }
    if (!stopping && subscribedOnce && ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
      disconnectedAfterSubscribe = true;
    }
  }

  async function establish() {
    const session = await loadSession();
    if (!session?.user?.id) {
      await removeCurrentChannel();
      userId = "";
      tableSignature = "";
      return false;
    }
    const currentUser = await loadCurrentUser();
    const tables = visibleRealtimeTables(currentUser);
    const nextSignature = tables.join(",");
    if (!tables.length) {
      await removeCurrentChannel();
      userId = session.user.id;
      tableSignature = "";
      return false;
    }
    if (channel && userId === session.user.id && tableSignature === nextSignature) return true;

    await removeCurrentChannel();
    client = await loadClient();
    if (!client) return false;
    userId = session.user.id;
    tableSignature = nextSignature;
    const channelGeneration = generation;
    const nextChannel = tables.reduce((value, table) => value.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      () => queueInvalidation([table], channelGeneration)
    ), client.channel(`tp-live-cache-${userId}`));
    channel = nextChannel;
    nextChannel.subscribe((status) => handleStatus(status, channelGeneration, tables));
    return true;
  }

  function ensure() {
    if (!ensurePromise) {
      const promise = establish().finally(() => {
        if (ensurePromise === promise) ensurePromise = null;
      });
      ensurePromise = promise;
    }
    return ensurePromise;
  }

  async function dispose() {
    await removeCurrentChannel();
    userId = "";
    tableSignature = "";
  }

  return Object.freeze({ ensure, dispose });
}

const liveRealtimeManager = createLiveRealtimeManager({
  loadClient: getSupabaseClient,
  loadSession: getSession,
  loadCurrentUser: getCurrentUser,
  invalidateTables: (tables) => invalidateLiveTableData(tables),
  refreshTables: (tables) => refreshLiveTables(tables),
  markTablesStale: (tables) => invalidateLiveTableData(tables)
});

export function ensureLiveRealtime() {
  return liveRealtimeManager.ensure();
}
