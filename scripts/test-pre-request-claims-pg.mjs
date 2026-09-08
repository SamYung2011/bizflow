import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(scriptPath));
const read = (path) => readFileSync(join(repoRoot, path), "utf8");
const migration = read("migrations/117_pre_request_claims_and_revert_115.sql");
const omitSub = process.argv.includes("--mutation=omit-sub");
const subAssignment = "  PERFORM set_config('request.jwt.claim.sub',   coalesce(claims ->> 'sub',   ''), true);";
assert.equal(migration.split(subAssignment).length, 2, "mutation must remove exactly one sub assignment");

// Same independent signature oracle as the 115 test; never derive it from 117.
const signatures = [
  ["bizflow_team_task_page", "uuid, integer, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz"],
  ["bizflow_unread_summary", "uuid, timestamptz, timestamptz, timestamptz, text, timestamptz"],
  ["bizflow_home_dashboard", "uuid"],
  ["bizflow_customer_page", "text, text, text, date, date, text, integer, integer"],
  ["bizflow_warranty_page", "text, text, date, date, integer, integer"],
  ["bizflow_order_page", "text, text, text, date, date, text, integer, integer"],
  ["bizflow_order_revenue", "text"]
];
// Production expressions from TASK-D section 1, including the JSON fallback.
const authFunctions = `
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid;
  $function$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $function$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'));
  $function$;
  CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $function$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.email', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'));
  $function$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $function$
    SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb;
  $function$;
`;
const roles = ["anon", "authenticated", "service_role", "authenticator"];
const userA = "10000000-0000-0000-0000-000000000001";
const userB = "10000000-0000-0000-0000-000000000002";
function claimsFor(sub, email) {
  const claims = {
    iss: "https://fixture.invalid/auth/v1", sub, aud: "authenticated", exp: 1900000000, iat: 1800000000,
    email, phone: "", app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { email, email_verified: true, phone_verified: false, fixture: "" },
    role: "authenticated", aal: "aal1", amr: [{ method: "password", timestamp: 1800000000 }],
    session_id: "20000000-0000-0000-0000-000000000001", is_anonymous: false
  };
  claims.user_metadata.fixture = "x".repeat(600 - Buffer.byteLength(JSON.stringify(claims)));
  assert.equal(Buffer.byteLength(JSON.stringify(claims)), 600);
  return JSON.stringify(claims);
}
const claimsA = claimsFor(userA, "a@example.test");
const claimsB = claimsFor(userB, "b@example.test");
const literal = (text) => `'${text.replaceAll("'", "''")}'`;

function executable(name) {
  for (const candidate of [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, name]) {
    try {
      if (candidate === name) return candidate;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(`PostgreSQL executable not found: ${name}`);
}
const initdb = executable("initdb"), pgCtl = executable("pg_ctl"), psql = executable("psql");
// Never inherit a database connection. Every psql call targets our Unix socket.
const pgEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG")));
const probeRoot = mkdtempSync(join(tmpdir(), "bizflow-pre-request-"));
const dataDir = join(probeRoot, "data"), socketDir = join(probeRoot, "socket");
mkdirSync(socketDir);
let started = false, passed = 0;
function run(command, args, options = {}) {
  const { allowFailure = false, ...spawnOptions } = options;
  const result = spawnSync(command, args, {
    cwd: repoRoot, env: pgEnv, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, ...spawnOptions
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} failed (${result.status})\n${result.stdout || ""}\n${result.stderr || ""}`);
  }
  return result;
}
function query(input, allowFailure = false) {
  return run(psql, ["-X", "-qAt", "-h", socketDir, "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], { input, allowFailure });
}
const sql = (input) => query(input).stdout.trim();
const jsonLines = (input) => sql(input).split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
const catalog = (signature) => JSON.parse(sql(`SELECT to_jsonb(p) FROM pg_proc p WHERE oid='${signature}'::regprocedure;`));
const rpcCatalog = () => signatures.map(([name, args]) => catalog(`public.${name}(${args})`));
const authCatalog = () => ["uid", "role", "email", "jwt"].map((name) => catalog(`auth.${name}()`));
const hookCatalog = () => catalog("public.bizflow_pre_request()");
function scenario(name, callback) {
  callback();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}
function request(role, claims, body, before = "") {
  return `BEGIN; SET LOCAL ROLE ${role};
    ${claims === undefined ? "" : `SET LOCAL request.jwt.claims=${literal(claims)};`}
    ${before} SELECT public.bizflow_pre_request(); ${body} ROLLBACK;`;
}
function state(tag, expectedClaims, includeCount = false) {
  return `SELECT jsonb_build_object('tag', '${tag}', 'pid', pg_backend_pid(),
    'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
    'role', nullif(current_setting('request.jwt.claim.role', true), ''),
    'email', nullif(current_setting('request.jwt.claim.email', true), ''),
    'uid', auth.uid(), 'auth_role', auth.role(), 'auth_email', auth.email(),
    'jwt_preserved', auth.jwt() IS NOT DISTINCT FROM ${expectedClaims === null ? "NULL::jsonb" : `${literal(expectedClaims)}::jsonb`}
    ${includeCount ? ", 'visible', (SELECT count(*) FROM public.claims_probe)" : ""});`;
}
function assertIdentity(row, sub, email) {
  assert.equal(row.sub, sub, "claim.sub fast path must be populated");
  assert.equal(row.uid, sub);
  assert.equal(row.role, "authenticated");
  assert.equal(row.auth_role, "authenticated");
  assert.equal(row.email, email);
  assert.equal(row.auth_email, email);
  assert.equal(row.jwt_preserved, true);
  assert.equal(row.visible, 1500, "RLS must preserve the caller's own rows");
}
function assertCleared(row) {
  for (const field of ["sub", "role", "email", "uid", "auth_role", "auth_email"]) assert.equal(row[field], null, field);
  assert.equal(row.jwt_preserved, true);
}

try {
  run(initdb, ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  run(pgCtl, ["-D", dataDir, "-o", `-k ${socketDir} -c listen_addresses=''`, "-w", "start"], { stdio: "ignore" });
  started = true;
  console.log(`POSTGRES_VERSION=${sql("SHOW server_version;")}; CLAIMS_BYTES=${Buffer.byteLength(claimsA)}`);
  sql(`${roles.map((role) => `CREATE ROLE ${role};`).join("\n")}
    CREATE ROLE no_hook_access; CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO ${roles.join(", ")};
    ${authFunctions}
    ${signatures.map(([name, args]) => `CREATE FUNCTION public.${name}(${args}) RETURNS jsonb
      LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT '{}'::jsonb $$;
      REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO authenticated;`).join("\n")}
    CREATE TABLE public.claims_probe (id integer PRIMARY KEY, owner uuid NOT NULL);
    INSERT INTO public.claims_probe SELECT n, CASE WHEN n%2=0 THEN '${userA}'::uuid ELSE '${userB}'::uuid END
      FROM generate_series(1,3000) n;
    ALTER TABLE public.claims_probe ENABLE ROW LEVEL SECURITY;
    CREATE POLICY claims_probe_select ON public.claims_probe FOR SELECT TO authenticated USING (owner=auth.uid());
    GRANT SELECT ON public.claims_probe TO authenticated;
    ANALYZE public.claims_probe;
  `);
  const authBefore = authCatalog();
  scenario("117 fixture starts at migration 115's seven VOLATILE signatures", () => {
    sql(read("migrations/115_scalar_rpc_volatile_single_eval.sql"));
    assert.deepEqual(rpcCatalog().map((row) => row.provolatile), Array(7).fill("v"));
  });
  const before = rpcCatalog();
  scenario("117 can run twice with identical catalogs", () => {
    const applied = omitSub ? migration.replace(subAssignment, "") : migration;
    sql(applied);
    const once = { rpcs: rpcCatalog(), hook: hookCatalog() };
    sql(applied);
    assert.deepEqual({ rpcs: rpcCatalog(), hook: hookCatalog() }, once);
  });
  signatures.forEach(([name], index) => {
    scenario(`${name} changes only provolatile back to STABLE`, () => {
      const after = rpcCatalog()[index];
      assert.equal(after.provolatile, "s");
      assert.deepEqual({ ...after, provolatile: "v" }, before[index]);
    });
  });
  scenario("all four production auth functions remain byte-identical in pg_proc", () => {
    assert.deepEqual(authCatalog(), authBefore);
  });
  scenario("hook is INVOKER/VOLATILE/empty search_path and grants only the four request roles", () => {
    const hook = hookCatalog();
    assert.equal(hook.prosecdef, false);
    assert.equal(hook.provolatile, "v");
    assert.deepEqual(hook.proconfig, ['search_path=""']);
    for (const role of roles) {
      assert.equal(sql(`SELECT has_function_privilege('${role}', 'public.bizflow_pre_request()', 'EXECUTE');`), "t");
      sql(request(role, '{"role":"anon"}', ""));
    }
    assert.equal(sql(`SELECT has_function_privilege('no_hook_access', 'public.bizflow_pre_request()', 'EXECUTE');`), "f");
    assert.equal(sql(`SELECT count(*) FROM pg_proc p, LATERAL aclexplode(p.proacl) a
      WHERE p.oid='public.bizflow_pre_request()'::regprocedure AND a.grantee=0;`), "0");
    const denied = query("SET ROLE no_hook_access; SELECT public.bizflow_pre_request();", true);
    assert.equal(denied.status, 3);
    assert.match(denied.stderr, /42501: permission denied for function bizflow_pre_request/);
    console.log(`HOOK_SEARCH_PATH=${JSON.stringify(hook.proconfig)}; EXECUTE=anon/authenticated/service_role/authenticator; PUBLIC=denied`);
  });
  // One psql invocation, hence the same backend, across COMMIT and ROLLBACK.
  const trace = jsonLines(`
    BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims=${literal(claimsA)};
    SELECT public.bizflow_pre_request(); ${state("request-A", claimsA, true)} COMMIT;
    BEGIN; SET LOCAL ROLE authenticated; ${state("after-commit", null)} COMMIT;
    BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims=${literal(claimsB)};
    SELECT public.bizflow_pre_request(); ${state("request-B", claimsB, true)} ROLLBACK;
    BEGIN; SET LOCAL ROLE authenticated; ${state("after-rollback", null)} COMMIT;
  `);
  scenario("600-byte claims populate all fast paths while preserving auth.jwt and RLS scope", () => {
    assert.equal(trace.length, 4);
    assertIdentity(trace[0], userA, "a@example.test");
    console.log(`CLAIMS_CORE=${JSON.stringify(trace[0])}`);
  });
  scenario("COMMIT clears transaction-local identity in the same backend", () => {
    assert.equal(new Set(trace.map((row) => row.pid)).size, 1);
    assertCleared(trace[1]);
    console.log(`CLAIMS_AFTER_COMMIT=${JSON.stringify(trace[1])}`);
  });
  scenario("next request uses B and ROLLBACK clears B without identity leakage", () => {
    assertIdentity(trace[2], userB, "b@example.test");
    assertCleared(trace[3]);
    console.log(`CLAIMS_NEXT_REQUEST=${JSON.stringify(trace[2])}`);
    console.log(`CLAIMS_AFTER_ROLLBACK=${JSON.stringify(trace[3])}`);
  });
  scenario("anon claims preserve anon role and NULL identity", () => {
    const row = jsonLines(request("anon", '{"role":"anon"}', state("anon", '{"role":"anon"}')))[0];
    assert.equal(row.sub, null); assert.equal(row.uid, null);
    assert.equal(row.role, "anon"); assert.equal(row.auth_role, "anon");
    assert.equal(row.email, null); assert.equal(row.auth_email, null); assert.equal(row.jwt_preserved, true);
    console.log(`CLAIMS_ANON=${JSON.stringify(row)}`);
  });
  for (const [tag, value] of [["unset", undefined], ["empty", ""]]) {
    scenario(`${tag} claims do not throw and expose no identity`, () => {
      const row = jsonLines(request("anon", value, state(tag, null)))[0];
      assertCleared(row);
      console.log(`CLAIMS_${tag.toUpperCase()}=${JSON.stringify(row)}`);
    });
  }
  scenario("bad JSON does not throw in the hook and clears stale short-circuit values", () => {
    const row = jsonLines(request("anon", "{bad", `SELECT jsonb_build_object(
      'sub', current_setting('request.jwt.claim.sub', true), 'role', current_setting('request.jwt.claim.role', true),
      'email', current_setting('request.jwt.claim.email', true), 'claims', current_setting('request.jwt.claims', true));`,
    `SET LOCAL request.jwt.claim.sub='${userA}'; SET LOCAL request.jwt.claim.role='authenticated';
      SET LOCAL request.jwt.claim.email='a@example.test';`))[0];
    // auth.uid()/jwt() still parse malformed JSON on fallback; those functions are intentionally unchanged.
    assert.deepEqual(row, { sub: "", role: "", email: "", claims: "{bad" });
    console.log(`CLAIMS_BAD_JSON_HOOK=${JSON.stringify(row)}`);
  });
  scenario("3000-row RLS query is faster with the hook, with identical visible counts", () => {
    const select = "SELECT count(*) FROM public.claims_probe";
    const explain = `EXPLAIN (ANALYZE, FORMAT TEXT) ${select};`;
    const output = sql(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims=${literal(claimsA)};
      ${Array.from({ length: 5 }, () => `
        SET LOCAL request.jwt.claim.sub=''; SET LOCAL request.jwt.claim.role=''; SET LOCAL request.jwt.claim.email='';
        SELECT 'COUNT_T1=' || count(*) FROM public.claims_probe;
        ${explain}
        SELECT public.bizflow_pre_request();
        SELECT 'COUNT_T2=' || count(*) FROM public.claims_probe;
        ${explain}`).join("\n")}
      ROLLBACK;`);
    const times = [...output.matchAll(/Execution Time: ([\d.]+) ms/g)].map((match) => Number(match[1]));
    assert.equal(times.length, 10);
    assert.deepEqual([...output.matchAll(/COUNT_T[12]=(\d+)/g)].map((match) => Number(match[1])), Array(10).fill(1500));
    assert.equal([...output.matchAll(/Rows Removed by Filter: 1500/g)].length, 10, "RLS must filter 3000 rows on every plan");
    const t1 = times.filter((_, index) => index % 2 === 0), t2 = times.filter((_, index) => index % 2 === 1);
    const median = (values) => [...values].sort((a, b) => a - b)[2];
    console.log(`CLAIMS_RLS_SAMPLES=${JSON.stringify({ T1_ms: t1, T2_ms: t2 })}`);
    console.log(`CLAIMS_RLS_T1=${median(t1)}ms; CLAIMS_RLS_T2=${median(t2)}ms; ROWS=1500->1500/3000; MEDIAN_PAIRS=5`);
    console.log(`CLAIMS_RLS_EXPLAIN\n${output}`);
    assert.ok(median(t2) < median(t1), "T2 with the hook must be less than T1 without the hook");
  });
  if (!omitSub) {
    scenario("removing the sub assignment makes the independent script exit nonzero", () => {
      const mutated = run(process.execPath, [scriptPath, "--mutation=omit-sub"], { allowFailure: true });
      assert.equal(mutated.status, 1);
      assert.match(mutated.stderr, /claim.sub fast path must be populated/);
      console.log(`PRE_REQUEST_CLAIMS_MUTATION=DETECTED (exit=${mutated.status}; claim.sub fast path must be populated)`);
    });
  }
  assert.equal(passed, 20);
  console.log("PRE_REQUEST_CLAIMS_PG=20/20 (seven STABLE reverts, auth unchanged, four-role ACL, same-backend commit/rollback, anon/bad JSON, 3000-row RLS, mutation exit=1)");
} finally {
  if (started) run(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "stop"], { allowFailure: true });
  rmSync(probeRoot, { recursive: true, force: true });
}
