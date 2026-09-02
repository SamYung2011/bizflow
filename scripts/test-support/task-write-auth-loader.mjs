const AUTH_SUFFIX = "/root-site/data/auth.js";

const AUTH_SOURCE = String.raw`
export const TRANSIENT_AUTH_RESET_EVENT = "tp:auth-transient-reset";

let sessionPending = true;
let resetCount = 0;

const client = {};
const currentUser = {
  employeeId: "employee-test",
  activeCompanyId: "company-test"
};

export async function getSupabaseClient() { return client; }
export async function getSession() {
  if (sessionPending) return new Promise(() => {});
  return { user: { id: "user-test" } };
}
export async function getCurrentUser() { return currentUser; }
export async function fetchAllTable() { return []; }
export function resetCurrentUserMemory() { resetCount += 1; }

export function __allowSession() { sessionPending = false; }
export function __resetCount() { return resetCount; }
`;

export async function load(url, context, nextLoad) {
  if (new URL(url).pathname.endsWith(AUTH_SUFFIX)) {
    return { format: "module", shortCircuit: true, source: AUTH_SOURCE };
  }
  return nextLoad(url, context);
}
