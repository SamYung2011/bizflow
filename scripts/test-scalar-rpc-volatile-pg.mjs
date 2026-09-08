import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migration = readFileSync(join(repoRoot, "migrations/115_scalar_rpc_volatile_single_eval.sql"), "utf8");
const omitVolatile = process.argv.includes("--mutation=omit-volatile");
// Independent signature oracle; do not derive these fixtures from the migration under test.
const signatures = [
  ["bizflow_team_task_page", "uuid, integer, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz"],
  ["bizflow_unread_summary", "uuid, timestamptz, timestamptz, timestamptz, text, timestamptz"],
  ["bizflow_home_dashboard", "uuid"],
  ["bizflow_customer_page", "text, text, text, date, date, text, integer, integer"],
  ["bizflow_warranty_page", "text, text, date, date, integer, integer"],
  ["bizflow_order_page", "text, text, text, date, date, text, integer, integer"],
  ["bizflow_order_revenue", "text"]
];

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

const initdb = executable("initdb");
const pgCtl = executable("pg_ctl");
const psql = executable("psql");
// Own temporary, socket-only PostgreSQL. Ignore inherited database connections.
const pgEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG")));
const probeRoot = mkdtempSync(join(tmpdir(), "bizflow-scalar-rpc-"));
const dataDir = join(probeRoot, "data");
const socketDir = join(probeRoot, "socket");
mkdirSync(socketDir);
let started = false;
let passed = 0;

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

function sql(input) {
  return run(psql, ["-X", "-qAt", "-h", socketDir, "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1"], { input }).stdout.trim();
}

function scenario(name, callback) {
  callback();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

// PostgREST's scalar wrapper: the whole-row count and scalar aggregate must both
// stay present. '{}' replaces the request payload; this probe takes no arguments.
const wrapper = `
  WITH pgrst_source AS (
    SELECT pgrst_call.pgrst_scalar
    FROM (SELECT '{}'::json AS json_data) pgrst_payload,
      LATERAL (SELECT public.probe_page() AS pgrst_scalar) pgrst_call
  )
  SELECT null::bigint AS total_result_set,
    pg_catalog.count(_postgrest_t) AS page_total,
    coalesce(json_agg(_postgrest_t.pgrst_scalar)->0, 'null') AS body,
    nullif(current_setting('response.headers', true), '') AS response_headers,
    nullif(current_setting('response.status', true), '') AS response_status,
    '' AS response_inserted
  FROM (SELECT * FROM pgrst_source) _postgrest_t;
`;

function evaluationCount() {
  sql("ALTER SEQUENCE public.probe_seq RESTART WITH 1;");
  sql(wrapper);
  return Number(sql("SELECT last_value FROM public.probe_seq WHERE is_called;"));
}

function catalog(signature) {
  return JSON.parse(sql(`SELECT jsonb_build_object(
    'identity', pg_get_function_identity_arguments(p.oid),
    'metadata', to_jsonb(p)
  ) FROM pg_proc p WHERE p.oid = '${signature}'::regprocedure;`));
}

try {
  run(initdb, ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  run(pgCtl, ["-D", dataDir, "-o", `-k ${socketDir} -c listen_addresses=''`, "-w", "start"], { stdio: "ignore" });
  started = true;
  console.log(`POSTGRES_VERSION=${sql("SHOW server_version;")}`);
  // nextval is deliberately inside a STABLE test function to count evaluations;
  // this is an isolated probe, never a production function or migration body.
  sql(`CREATE SEQUENCE public.probe_seq;
    CREATE FUNCTION public.probe_page() RETURNS jsonb LANGUAGE sql STABLE
      AS $$ SELECT jsonb_build_object('n', nextval('public.probe_seq')) $$;`);

  scenario("STABLE scalar wrapper evaluates the function twice", () => {
    const count = evaluationCount();
    assert.equal(count, 2);
    console.log(`PROBE_STABLE=${count}`);
  });
  scenario("omitting ALTER VOLATILE makes the single-evaluation assertion red", () => {
    assert.throws(() => assert.equal(evaluationCount(), 1), (error) =>
      error instanceof assert.AssertionError && error.actual === 2 && error.expected === 1);
    console.log("SCALAR_RPC_MUTATION=DETECTED (actual=2 expected=1 without ALTER)");
  });
  scenario("VOLATILE scalar wrapper evaluates the function once", () => {
    if (!omitVolatile) sql("ALTER FUNCTION public.probe_page() VOLATILE;");
    const count = evaluationCount();
    assert.equal(count, 1, "VOLATILE wrapper must evaluate the scalar exactly once");
    console.log(`PROBE_VOLATILE=${count}; PROBE_EVALUATIONS=2->1`);
  });

  sql(`CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE FUNCTION public.bizflow_jsonb_array(input_value jsonb) RETURNS jsonb
      LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
      AS $$ SELECT CASE WHEN jsonb_typeof(input_value) = 'array' THEN input_value ELSE '[]'::jsonb END $$;
    ${signatures.map(([name, args]) => `
      CREATE FUNCTION public.${name}(${args}) RETURNS jsonb
        LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT '{}'::jsonb $$;
      REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO authenticated;
    `).join("\n")}
  `);
  const before = signatures.map(([name, args]) => catalog(`public.${name}(${args})`));
  const helperBefore = catalog("public.bizflow_jsonb_array(jsonb)");
  scenario("seven fixture identities match the reviewed signatures and start STABLE", () => {
    before.forEach((row, index) => {
      // PostgreSQL renders timestamptz using its canonical SQL spelling.
      const identity = signatures[index][1].replaceAll("timestamptz", "timestamp with time zone");
      assert.equal(row.identity, identity);
      assert.equal(row.metadata.provolatile, "s");
      console.log(`SIGNATURE_MATCH=${signatures[index][0]}(${row.identity})`);
    });
  });
  let after;
  scenario("migration 115 is repeatable with identical catalog results", () => {
    sql(migration);
    const once = signatures.map(([name, args]) => catalog(`public.${name}(${args})`));
    sql(migration);
    after = signatures.map(([name, args]) => catalog(`public.${name}(${args})`));
    assert.deepEqual(after, once);
  });
  signatures.forEach(([name, args], index) => {
    scenario(`${name} changes only provolatile to v`, () => {
      const row = after[index];
      assert.equal(row.metadata.provolatile, "v");
      assert.equal(row.metadata.prosecdef, false);
      assert.deepEqual(row.metadata.proconfig, ['search_path=""']);
      assert.deepEqual({ ...row, metadata: { ...row.metadata, provolatile: "s" } }, before[index],
        "function body, owner, ACL, return type, search_path and all other pg_proc fields must be unchanged");
      assert.equal(sql(`SELECT has_function_privilege('authenticated', 'public.${name}(${args})', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.${name}(${args})', 'EXECUTE');`), "t");
    });
  });
  scenario("bizflow_jsonb_array stays IMMUTABLE and byte-identical in pg_proc", () => {
    const helperAfter = catalog("public.bizflow_jsonb_array(jsonb)");
    assert.equal(helperAfter.metadata.provolatile, "i");
    assert.deepEqual(helperAfter, helperBefore);
  });
  assert.equal(passed, 13);
  console.log("SCALAR_RPC_VOLATILE_PG=13/13 (probe 2->1, mutation detected, seven identities/metadata, repeatable, IMMUTABLE helper)");
} finally {
  if (started) run(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "stop"], { allowFailure: true });
  rmSync(probeRoot, { recursive: true, force: true });
}
