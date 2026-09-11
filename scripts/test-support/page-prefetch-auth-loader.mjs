import { load as baseLoad } from './data-phase1-auth-loader.mjs';
export async function load(url, context, nextLoad) {
  const result = await baseLoad(url, context, nextLoad);
  if (!new URL(url).pathname.endsWith('/root-site/data/auth.js')) return result;
  let source = result.source;
  source = source.replace('function emptyQuery() {', 'function emptyQuery(table) {');
  source = source.replace('Promise.resolve({ data: [], error: null, count: 0 })', 'tableRead(table).then(data => ({ data, error: null, count: 0 }))');
  source = source.replace('from() { return emptyQuery(); }', 'from(table) { return emptyQuery(table); }');
  source = source.replace('export async function getCurrentUser() { return currentUser; }', 'export async function getCurrentUser() { await authHold; return currentUser; }');
  source = source.replace('export async function fetchAllTable() {\n  if (tableError) throw tableError;\n  return [];\n}', 'export async function fetchAllTable(table, ...args) { if (tableError) throw tableError; return tableRead(table, args); }');
  source += `
let authHold = null;
let authRelease = null;
const tableCalls = [];
let tableHandler = () => [];
async function tableRead(table, args) { tableCalls.push({ table, args }); return tableHandler(table, args); }
export function __holdAuth() { authHold = new Promise(resolve => { authRelease = resolve; }); }
export function __releaseAuth() { authRelease?.(); authHold = null; }
export function __tableCalls() { return tableCalls.slice(); }
export function __setTableHandler(handler) { tableHandler = handler; tableCalls.length = 0; }
`;
  return { ...result, source };
}
