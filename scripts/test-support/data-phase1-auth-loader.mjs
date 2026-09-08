import { readFile } from "node:fs/promises";

const AUTH_SUFFIX = "/root-site/data/auth.js";

const AUTH_SOURCE = String.raw`
export const TRANSIENT_AUTH_RESET_EVENT = "tp:auth-transient-reset";
export const RBAC_KEYS = Object.freeze([]);

const calls = [];
const errors = new Map();
const rpcData = new Map();
const rpcHandlers = new Map();
let heldRpc = "";
let releaseHeld = null;
let tableError = null;
let sessionUserId = "test-user";
let clientMissing = false;

function emptyQuery() {
  let proxy;
  const target = {
    then(resolve, reject) {
      return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
    }
  };
  proxy = new Proxy(target, {
    get(value, property) {
      if (property === "then") return value.then.bind(value);
      return () => proxy;
    }
  });
  return proxy;
}

function orderPage() {
  return {
    rows: [{
      id: "invoice-live-1", invoice_number: "10001", customer_id: null,
      order_date: "2026-08-20", total: 100, status: "Paid", notes: "",
      customer_name: "Live customer", customer_phone: "8520000", salesperson_name: "KC",
      channel: "Manual", first_item: { name: "Adapter", qty: 1 }, second_item: null
    }],
    total_count: 1,
    date_from: "2026/08/20",
    date_to: "2026/08/20",
    shipping_counts: { all: 1, pending: 1, in_transit: 0, exception: 0, delivered: 0 }
  };
}

const client = {
  from() { return emptyQuery(); },
  async rpc(name, args) {
    calls.push({ name, args });
    if (heldRpc === name) {
      await new Promise((resolve) => { releaseHeld = resolve; });
      heldRpc = "";
      releaseHeld = null;
    }
    if (errors.has(name)) return { data: null, error: errors.get(name) };
    if (rpcHandlers.has(name)) return { data: await rpcHandlers.get(name)(args), error: null };
    if (rpcData.has(name)) return { data: rpcData.get(name), error: null };
    if (name === "bizflow_order_page") return { data: orderPage(), error: null };
    if (name === "bizflow_unread_summary") return {
      data: { unread: {}, watermarks: {} }, error: null
    };
    return { data: {}, error: null };
  }
};

const currentUser = {
  id: "employee-test", name: "KC", email: "kc@example.test", role: "member",
  activeCompanyId: "company-test", bizflowMainAccess: true, isBfAdmin: false, canViewRevenue: true,
  hasPermission() { return true; }
};

export async function getSupabaseClient() { return clientMissing ? null : client; }
export async function getSession() { return sessionUserId ? { user: { id: sessionUserId } } : null; }
export async function getCurrentUser() { return currentUser; }
export async function fetchAllTable() {
  if (tableError) throw tableError;
  return [];
}

export function __setCurrentUser(value) { Object.assign(currentUser, value); }
export function __setClientMissing(value) { clientMissing = value; }
export function __calls() { return calls.slice(); }
export function __reset() {
  calls.length = 0;
  sessionUserId = "test-user";
  clientMissing = false;
  currentUser.id = "employee-test";
  currentUser.activeCompanyId = "company-test";
  errors.clear();
  rpcData.clear();
  rpcHandlers.clear();
  tableError = null;
  heldRpc = "";
  if (releaseHeld) releaseHeld();
  releaseHeld = null;
  currentUser.isBfAdmin = false;
  currentUser.canViewRevenue = true;
}
export function __setRpcError(name, error) { if (error) errors.set(name, error); else errors.delete(name); }
export function __setRpcData(name, data) { rpcData.set(name, data); }
export function __setRpcHandler(name, handler) { rpcHandlers.set(name, handler); }
export function __setCanViewRevenue(value) { currentUser.canViewRevenue = value === true; }
export function __setTableError(error) { tableError = error; }
export function __setSessionUser(id) { sessionUserId = id; }
export function __holdNextRpc(name) { heldRpc = name; }
export function __releaseRpc() { if (releaseHeld) releaseHeld(); }
`;

export async function load(url, context, nextLoad) {
  if (new URL(url).pathname.endsWith(AUTH_SUFFIX)) {
    // Exercise the production storage helper while keeping network auth stubbed.
    const production = await readFile(new URL(url), "utf8");
    const helpers = ["safeLocalStorageGet", "activeCompanyStorageKey", "getRememberedActiveCompanyId",
      "employeeIdStorageKey", "getRememberedEmployeeId"]
      .map((name) => production.match(new RegExp(`(?:export )?function ${name}\\([^]*?\\n}`, "m"))?.[0]);
    if (helpers.some((helper) => !helper)) throw new Error("Auth storage helper missing");
    return { format: "module", shortCircuit: true, source: AUTH_SOURCE + "\n" + helpers.join("\n") };
  }
  return nextLoad(url, context);
}
