import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { createLiveRealtimeManager } from "../root-site/data/live-realtime.js";

const requiredEnv = [
  "RT150_SUPABASE_URL",
  "RT150_SUPABASE_ANON_KEY",
  "RT150_TEST_EMAIL",
  "RT150_TEST_PASSWORD",
  "RT150_MARKER_DIR"
];
for (const name of requiredEnv) {
  if (!String(process.env[name] || "").trim()) throw new Error(`${name} is required`);
}

const marker = `RT150_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}_${crypto.randomUUID().slice(0, 8)}`;
const readyFile = path.join(process.env.RT150_MARKER_DIR, "rt_ready.flag");
const resultFile = path.join(process.env.RT150_MARKER_DIR, "rt_result.json");
const credentials = {
  email: process.env.RT150_TEST_EMAIL,
  password: process.env.RT150_TEST_PASSWORD
};
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 20 } }
};
const listenerClient = createClient(
  process.env.RT150_SUPABASE_URL,
  process.env.RT150_SUPABASE_ANON_KEY,
  clientOptions
);
const triggerClient = createClient(
  process.env.RT150_SUPABASE_URL,
  process.env.RT150_SUPABASE_ANON_KEY,
  clientOptions
);

let manager = null;
let listenerSession = null;
let fixtureInserted = false;
const startedAt = Date.now();

function throwIfError(error) {
  if (error) throw error;
}

async function signIn(client) {
  const result = await client.auth.signInWithPassword(credentials);
  throwIfError(result.error);
  return result.data.session;
}

async function markerCounts(client) {
  const [invoices, events] = await Promise.all([
    client.from("invoices").select("id", { count: "exact", head: true }).like("id", "RT150_%"),
    client.from("shipment_events").select("id", { count: "exact", head: true }).like("description", "RT150_%")
  ]);
  throwIfError(invoices.error);
  throwIfError(events.error);
  return { invoices: invoices.count ?? 0, shipmentEvents: events.count ?? 0 };
}

function waitForSubscription() {
  let resolveReady;
  let rejectReady;
  const promise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timeout = setTimeout(() => rejectReady(new Error("Realtime subscription did not become ready")), 30000);
  void promise.catch(() => {});
  return {
    promise: promise.finally(() => clearTimeout(timeout)),
    resolve: resolveReady,
    reject: rejectReady
  };
}

function waitForTimeline() {
  let resolveTimeline;
  let rejectTimeline;
  const promise = new Promise((resolve, reject) => {
    resolveTimeline = resolve;
    rejectTimeline = reject;
  });
  const timeout = setTimeout(() => rejectTimeline(new Error("shipment_events realtime event timed out")), 90000);
  void promise.catch(() => {});
  return {
    promise: promise.finally(() => clearTimeout(timeout)),
    resolve: resolveTimeline,
    reject: rejectTimeline
  };
}

async function cleanup() {
  if (!fixtureInserted) return;
  const result = await triggerClient.from("invoices").delete().eq("id", marker).select("id");
  throwIfError(result.error);
  assert.equal(result.data?.length, 1, "cleanup must delete the exact RT150 invoice");
  fixtureInserted = false;
}

try {
  [listenerSession] = await Promise.all([
    signIn(listenerClient),
    signIn(triggerClient)
  ]);

  const baseline = await markerCounts(listenerClient);
  assert.deepEqual(baseline, { invoices: 0, shipmentEvents: 0 }, "RT150 baseline must be clean");

  const subscribed = waitForSubscription();
  const timelineSeen = waitForTimeline();
  const originalChannel = listenerClient.channel.bind(listenerClient);
  const listenerFacade = new Proxy(listenerClient, {
    get(target, property) {
      if (property === "channel") {
        return (name) => {
          const channel = originalChannel(name);
          const originalSubscribe = channel.subscribe.bind(channel);
          channel.subscribe = (callback) => originalSubscribe((status, error) => {
            callback(status, error);
            if (status === "SUBSCRIBED") subscribed.resolve();
            if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
              subscribed.reject(error || new Error(`Realtime status: ${status}`));
            }
          });
          return channel;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  manager = createLiveRealtimeManager({
    loadClient: async () => listenerFacade,
    loadSession: async () => listenerSession,
    loadCurrentUser: async () => ({
      userId: listenerSession.user.id,
      bizflowMainAccess: true,
      isBfAdmin: false
    }),
    invalidateTables: async () => {},
    refreshTables: async (tables) => {
      if (!tables.includes("shipment_events")) return;
      const [invoiceResult, eventResult] = await Promise.all([
        listenerClient.from("invoices").select("id,notes").eq("id", marker).maybeSingle(),
        listenerClient.from("shipment_events")
          .select("invoice_id,description,op_code")
          .eq("invoice_id", marker)
          .eq("op_code", "RT150")
          .maybeSingle()
      ]);
      throwIfError(invoiceResult.error);
      throwIfError(eventResult.error);
      if (invoiceResult.data?.notes === marker && eventResult.data?.description?.startsWith(marker)) {
        timelineSeen.resolve({
          tables,
          invoiceId: invoiceResult.data.id,
          description: eventResult.data.description
        });
      }
    },
    warn: (message, error) => timelineSeen.reject(new Error(`${message}: ${error?.message || error}`))
  });

  assert.equal(await manager.ensure(), true, "authenticated BizFlow user must establish realtime");
  await subscribed.promise;
  await mkdir(process.env.RT150_MARKER_DIR, { recursive: true });
  await writeFile(readyFile, `${marker}\n`, { flag: "wx" });

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const invoiceResult = await triggerClient.from("invoices").insert({
    id: marker,
    invoice_number: null,
    customer_id: null,
    salesperson_id: null,
    date: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date()),
    items: [{ id: marker, name: marker, qty: 1, price: 1 }],
    total: 1,
    status: "Unpaid",
    notes: marker,
    tracking_number: null,
    shipping_status: "待發貨"
  }).select("id").single();
  throwIfError(invoiceResult.error);
  fixtureInserted = true;

  const eventResult = await triggerClient.from("shipment_events").insert({
    invoice_id: marker,
    event_at: new Date().toISOString(),
    location: "RT150_TEST",
    description: `${marker}：realtime timeline probe`,
    op_code: "RT150",
    raw: { test_marker: marker }
  }).select("id").single();
  throwIfError(eventResult.error);

  const observed = await timelineSeen.promise;
  const elapsedMs = Date.now() - startedAt;
  await manager.dispose();
  manager = null;
  await cleanup();
  const residual = await markerCounts(listenerClient);
  assert.deepEqual(residual, { invoices: 0, shipmentEvents: 0 }, "RT150 cleanup must leave zero rows");

  const result = {
    ok: true,
    marker,
    elapsedMs,
    observedTables: observed.tables,
    baseline,
    residual
  };
  await writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify(result));
} finally {
  if (manager) await manager.dispose().catch(() => {});
  await cleanup().catch((error) => console.error(`cleanup failed: ${error.message || error}`));
  await Promise.all([
    listenerClient.auth.signOut().catch(() => {}),
    triggerClient.auth.signOut().catch(() => {})
  ]);
}
