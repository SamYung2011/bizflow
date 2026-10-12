import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeRpc, prepareRpcBody, sqlRpcDefinition } from "./test-support/rpc-generic-plan.mjs";

// Explicit opt-in. This gate only sends BEGIN READ ONLY / SELECT / PREPARE /
// EXPLAIN / ROLLBACK to HK. Candidate bodies are prepared without installing
// functions; no migration, schema reload, service, or container mutation.
const argv = process.argv.slice(2);
assert.ok(argv.includes("--hk"), "HK read-only gate requires --hk");
const option = (name) => argv[argv.indexOf(name) + 1];
assert.ok(argv.includes("--legacy-order-def"), "provide the saved pre-126 order definition");
assert.ok(argv.includes("--evidence-dir"), "provide a local evidence directory");
const evidenceDir = resolve(option("--evidence-dir"));
mkdirSync(evidenceDir, { recursive: true });
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyDefinition = readFileSync(resolve(option("--legacy-order-def")), "utf8");
assert.equal(sqlRpcDefinition(legacyDefinition).name, "bizflow_order_page");

function remoteSql(statement, allowFailure = false) {
  const result = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
    "ecs-user@47.242.242.233",
    "sudo docker exec -i supabase-db psql -X -U postgres -d postgres -qAt -v ON_ERROR_STOP=1"],
  { input: statement, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 360000 });
  if (!allowFailure) assert.equal(result.status, 0, result.stderr || String(result.error));
  return result;
}

const catalog = JSON.parse(remoteSql(`BEGIN READ ONLY;
  SELECT jsonb_build_object(
    'employee', (SELECT jsonb_build_object('sub', e.user_id, 'email', u.email, 'name', e.name)
      FROM public.employees e JOIN auth.users u ON u.id=e.user_id
      WHERE e.active IS TRUE AND e.kind='employee' AND e.is_super_admin IS FALSE
        AND e.bizflow_main_access IS TRUE AND e.name='Jack' LIMIT 1),
    'definitions', (SELECT jsonb_object_agg(p.proname, pg_get_functiondef(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('bizflow_customer_page',
        'bizflow_home_dashboard','bizflow_order_page','bizflow_warranty_page','bizflow_team_task_page')));
  ROLLBACK;`).stdout);
assert.ok(catalog.employee, "eligible non-admin employee Jack must exist");
const claims = JSON.stringify({ sub: catalog.employee.sub, email: catalog.employee.email, role: "authenticated" }).replaceAll("'", "''");
const identity = `SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '${claims}';
  DO $$ BEGIN
    IF current_user <> 'authenticated' OR public.is_bf_admin()
      OR NOT public.has_bizflow_main_access()
      OR NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.user_id=auth.uid()
        AND e.active IS TRUE AND e.kind='employee' AND e.bizflow_main_access IS TRUE
        AND e.is_super_admin IS FALSE) THEN
      RAISE EXCEPTION 'gate identity must be a non-admin active main-access employee';
    END IF;
  END $$;`;
const cases = [
  { name: "bizflow_customer_page", values: ["NULL","NULL","NULL","NULL","NULL","'createdDesc'","0","18"], migration: "127_bizflow_customer_page_materialized_reads_20261012.sql" },
  { name: "bizflow_home_dashboard", values: ["NULL"], migration: "128_bizflow_home_dashboard_materialized_reads_20261012.sql" },
  { name: "bizflow_warranty_page", values: ["NULL","NULL","NULL","NULL","0","18"] },
  { name: "bizflow_team_task_page", values: ["NULL","NULL","false","NULL","NULL","NULL","NULL","NULL"] },
  { name: "bizflow_order_page", values: ["NULL","NULL","NULL","NULL","NULL","'newest'","0","50"] }
];

function measurements(definition, values, mode, label, repeats = 3) {
  const name = "rpc_generic";
  let query = `BEGIN READ ONLY; ${identity}
    SET LOCAL statement_timeout='8s'; SET LOCAL plan_cache_mode=force_${mode}_plan;
    ${prepareRpcBody(definition, name)}\n`;
  for (let index = 0; index < repeats; index += 1) {
    query += `\\echo __PLAN__${index}\nEXPLAIN (ANALYZE, BUFFERS, VERBOSE, COSTS ON, TIMING OFF, FORMAT JSON) ${executeRpc(name, values)}\n`;
  }
  // Prove the measurement really used parameter-unknown plans, rather than
  // accepting a session setting that failed to affect the statement.
  query += `\\echo __END__\nDO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_prepared_statements WHERE name='${name}'
      AND ${mode}_plans=${repeats} AND ${mode === "generic" ? "custom" : "generic"}_plans=0) THEN
      RAISE EXCEPTION 'wrong plan cache mode';
    END IF;
  END $$; ROLLBACK;`;
  const output = remoteSql(query).stdout;
  const plans = [...output.matchAll(/__PLAN__\d+\n([^]*?)(?=__PLAN__\d+\n|__END__\n)/g)]
    .map((match) => JSON.parse(match[1])[0]);
  assert.equal(plans.length, repeats);
  writeFileSync(join(evidenceDir, `${label}.plans.json`), JSON.stringify(plans, null, 2));
  const seconds = plans.map((plan) => plan["Execution Time"] / 1000).sort((a, b) => a - b);
  return { seconds, median: seconds[Math.floor(seconds.length / 2)] };
}

console.log(`IDENTITY=${catalog.employee.name}; authenticated; is_bf_admin=false; main_access=true; claims-only`);
const order = cases.find(({ name }) => name === "bizflow_order_page");
const negative = remoteSql(`BEGIN READ ONLY; ${identity}
  SET LOCAL statement_timeout='8s'; SET LOCAL plan_cache_mode=force_generic_plan;
  ${prepareRpcBody(legacyDefinition)}
  EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) ${executeRpc("rpc_generic", order.values)}
  ROLLBACK;`, true);
writeFileSync(join(evidenceDir, "order-pre126-red.log"), negative.stderr);
assert.notEqual(negative.status, 0, "pre-126 order must make the gate RED");
assert.match(negative.stderr, /canceling statement due to statement timeout/,
  "only PostgreSQL's real 8s timeout counts as the negative control");
console.log("ORDER_PRE126=RED: PostgreSQL statement_timeout 8s");

const results = {};
for (const entry of cases) {
  const before = catalog.definitions[entry.name];
  assert.doesNotMatch(before, /SECURITY DEFINER/i, "body preparation must preserve INVOKER semantics");
  const generic = measurements(before, entry.values, "generic", `${entry.name}.before.generic`);
  const custom = measurements(before, entry.values, "custom", `${entry.name}.before.custom`);
  let after = generic;
  if (entry.migration) {
    const candidate = readFileSync(join(repo, "migrations", entry.migration), "utf8");
    assert.equal(sqlRpcDefinition(candidate).name, entry.name);
    assert.doesNotMatch(candidate, /SECURITY DEFINER/i);
    after = measurements(candidate, entry.values, "generic", `${entry.name}.after.generic`);
  }
  assert.ok(after.median < 8, `${entry.name} must make the 8s gate GREEN`);
  results[entry.name] = { generic, custom, after, changed: Boolean(entry.migration) };
  writeFileSync(join(evidenceDir, "times.json"), JSON.stringify(results, null, 2));
  console.log(`${entry.name}: generic ${generic.median.toFixed(4)} -> ${after.median.toFixed(4)}s; custom ${custom.median.toFixed(4)}s; GREEN`);
}
console.log("ORDER_126=GREEN; GENERIC_PLAN_GATE=PASS; all HK transactions rolled back");
