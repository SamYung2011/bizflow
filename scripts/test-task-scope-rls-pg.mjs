import assert from "node:assert/strict";
import { normalizePayload, assertLegacyPlan } from "./test-support/task-scope-rls-plans.mjs";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(scriptPath));
const read = (path) => readFileSync(join(repoRoot, path), "utf8");
const migration = read("migrations/116_task_scope_setbased_rls.sql");
const sources = {
  15: read("migrations/015_employee_management_v3.sql"),
  31: read("migrations/031_task_multi_assignees.sql"),
  52: read("migrations/052_departments.sql"),
  82: read("migrations/082_team_rls_hardening.sql"),
  94: read("migrations/094_team_subtask_writes.sql")
};
function extract(source, pattern, label) {
  const found = source.match(pattern);
  assert.ok(found, `Missing original SQL: ${label}`);
  return found[0];
}
const helper = (number, name) => extract(sources[number],
  new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^]*?\\n\\$\\$;`), `${number}:${name}`);
const policy = (number, name) => extract(sources[number],
  new RegExp(`CREATE POLICY ${name} ON [^]*?;`), `${number}:${name}`);

function without(fragment) {
  assert.equal(migration.split(fragment).length, 2, `mutation must target exactly one branch: ${fragment}`);
  return migration.replace(fragment, "");
}
const mutations = {
  creator: without("OR (t.creator_employee_id IS NOT NULL AND t.creator_employee_id = me.employee_id)"),
  department: without("t.department_id IS NULL OR "),
  unfiltered: without("  WHERE assignee.task_id IN (SELECT public.bizflow_visible_task_ids())")
    .replace("  WHERE feedback.task_id IN (SELECT public.bizflow_visible_task_ids())", "")
};
const mutation = process.argv.find((arg) => arg.startsWith("--mutation="))?.split("=")[1];
if (mutation) assert.ok(mutations[mutation], "Unknown mutation");

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
// No inherited database connection; every query uses our own Unix socket.
const pgEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG")));
const probeRoot = mkdtempSync(join(tmpdir(), "bizflow-task-scope-"));
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
function query(input, allowFailure = false) {
  return run(psql, ["-X", "-qAt", "-h", socketDir, "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], { input, allowFailure });
}
const sql = (input) => query(input).stdout.trim();
function asUser(user, statement, allowFailure = false) {
  const result = query(`BEGIN; SET LOCAL ROLE ${user.role || "authenticated"};
    SET LOCAL request.jwt.claim.sub = '${user.uid}';
    SET LOCAL statement_timeout = '8s'; ${statement} ROLLBACK;`, allowFailure);
  return allowFailure ? result : result.stdout.trim();
}
function scenario(name, callback) {
  callback();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}
const id = (kind, number) => `${kind}0000000-0000-0000-0000-${String(number).padStart(12, "0")}`;
const A = id(3, 1), B = id(3, 2);
const D1 = id(4, 1), D2 = id(4, 2), BD1 = id(4, 3), BD2 = id(4, 4);
const users = [
  { name: "super", number: 1, super: true, company: null, departments: [] },
  { name: "admin-A", number: 2, admin: true, company: A, departments: [] },
  { name: "member-A-none", number: 3, company: A, departments: [] },
  { name: "member-A-D1", number: 4, company: A, departments: [D1] },
  { name: "member-A-D2", number: 5, company: A, departments: [D2] },
  { name: "member-B", number: 6, company: B, departments: [BD1] },
  { name: "inactive", number: 7, active: false, super: true, admin: true, company: A, departments: [D1] },
  { name: "no-employee", number: 8, missing: true, departments: [] },
  { name: "member-AB", number: 10, companies: [A, B], departments: [D1, BD1] },
  { name: "admin-A-member-B", number: 11, companies: [A, B], adminCompanies: [A], departments: [BD1] },
  { name: "dept-only", number: 12, companies: [], departments: [D1] },
  { name: "member-A-dept-B", number: 13, companies: [A], departments: [BD1] },
  { name: "duplicate-employee", number: 14, companies: [A, B], boundCompanies: [A], departments: [D1] },
  { name: "anon", number: 9, role: "anon", missing: true, departments: [] }
].map((user) => ({ active: true, companies: user.companies || (user.company ? [user.company] : []),
  adminCompanies: user.adminCompanies || (user.admin ? [user.company] : []), ...user, uid: user.role === "anon" ? "" : id(2, user.number), employee: id(1, user.number) }));
const duplicateUser = users.find((user) => user.name === "duplicate-employee");
const employeeRows = [...users.filter((user) => !user.missing),
  { ...duplicateUser, employee: id(1, 114), boundCompanies: [B], departments: [BD2] }];
const selectedEmployees = new Map();
const literal = (value) => value == null ? "NULL" : `'${value}'`;
const tasks = [];
for (const [company, departments, creators] of [
  [A, [null, D1, D2], [null, 2, 3, 4, 5, 7]],
  [B, [null, BD1, BD2], [null, 1, 6]]
]) {
  for (const department of departments) for (const creator of creators) {
    tasks.push({ id: id(5, tasks.length + 1), company, department, creator: creator == null ? null : id(1, creator) });
  }
}
tasks.push(
  { id: id(5, 28), company: null, department: null, creator: id(1, 3) },
  { id: id(5, 29), company: null, department: null, creator: null },
  { id: id(5, 30), company: null, department: D1, creator: null },
  { id: id(5, 31), company: A, department: BD1, creator: null },
  { id: id(5, 32), company: A, department: D2, creator: id(1, 14) },
  { id: id(5, 33), company: B, department: BD2, creator: id(1, 114) },
  { id: id(5, 34), company: A, department: BD2, creator: null },
  { id: id(5, 35), company: B, department: BD2, creator: id(1, 14) }
);
const orphanIds = [id(5, 9001), id(5, 9002)];
const assignments = [...tasks.map((task) => task.id), ...orphanIds]
  .flatMap((task) => [3, 4].map((employee) => ({ task, employee: id(1, employee) })));
const feedbacks = assignments.map((assignment, index) => ({ id: id(6, index + 1), task: assignment.task }));

function expectedLists(user) {
  if (user.missing || !user.active) return { tasks: [], assignees: [], feedbacks: [] };
  const employee = selectedEmployees.get(user.name) || user.employee;
  const departments = employeeRows.find((row) => row.employee === employee).departments;
  const visible = new Set(tasks.filter((task) => user.super
    || user.adminCompanies.includes(task.company)
    || task.creator === employee
    || (user.companies.includes(task.company) && (task.department === null || departments.includes(task.department))))
    .map((task) => task.id));
  return {
    tasks: [...visible].sort(),
    assignees: assignments.filter((row) => visible.has(row.task)).map((row) => `${row.task}/${row.employee}`).sort(),
    // The unchanged fb_admin_all exposes orphan feedback to the super admin.
    feedbacks: feedbacks.filter((row) => user.super || visible.has(row.task)).map((row) => row.id).sort()
  };
}
function lists(user) {
  return JSON.parse(asUser(user, `SELECT jsonb_build_object(
    'tasks', (SELECT COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb) FROM public.employee_tasks),
    'assignees', (SELECT COALESCE(jsonb_agg(key ORDER BY key), '[]'::jsonb) FROM (
      SELECT task_id::text || '/' || employee_id::text AS key FROM public.task_assignees) rows),
    'feedbacks', (SELECT COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb) FROM public.employee_task_feedbacks)
  );`));
}
const capture = () => Object.fromEntries(users.map((user) => [user.name, lists(user)]));
function policies() {
  return JSON.parse(sql(`SELECT jsonb_agg(p ORDER BY tablename, policyname) FROM (
    SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('employee_tasks','task_assignees','employee_task_feedbacks')) p;`));
}
function helpers() {
  return JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname NOT IN
      ('bizflow_visible_task_ids','bizflow_scoped_task_assignees','bizflow_scoped_task_feedbacks','bizflow_team_task_page');`));
}
const rpcSignature = "public.bizflow_team_task_page(uuid, integer, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz)";
function functionInfo(signature) {
  return JSON.parse(sql(`SELECT to_jsonb(p) FROM pg_proc p WHERE oid='${signature}'::regprocedure;`));
}
const scopeFunctions = ["bizflow_visible_task_ids", "bizflow_scoped_task_assignees", "bizflow_scoped_task_feedbacks"];
const scopeCatalog = () => scopeFunctions.map((name) => {
  // DROP/recreate intentionally changes these three OIDs; RPC OID stays checked.
  const { oid, ...metadata } = functionInfo(`public.${name}()`);
  return metadata;
});
function rpcStatement(company = A, limit = "NULL", detail = true) {
  return `SELECT public.bizflow_team_task_page('${company}', ${limit}, ${detail});`;
}
function rpcPayload(user, statement = rpcStatement(user.company || user.companies[0] || A)) {
  if (user.role === "anon") {
    const denied = asUser(user, statement, true);
    assert.equal(denied.status, 3);
    assert.match(denied.stderr, /42501: permission denied for function bizflow_team_task_page/);
    return { sqlstate: "42501" };
  }
  return normalizePayload(JSON.parse(asUser(user, statement)));
}
function childRows(user, scoped = false) {
  return JSON.parse(asUser(user, `SELECT jsonb_build_object(
    'assignees', (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.task_id, a.employee_id), '[]'::jsonb)
      FROM public.${scoped ? "bizflow_scoped_task_assignees()" : "task_assignees"} a),
    'feedbacks', (SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.id), '[]'::jsonb)
      FROM public.${scoped ? "bizflow_scoped_task_feedbacks()" : "employee_task_feedbacks"} f)
  );`));
}
function functionCalls(user, statement) {
  sql("SELECT pg_stat_reset();");
  sql(`SET track_functions='all'; BEGIN; SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.sub='${user.uid}'; ${statement} COMMIT;
    SELECT pg_stat_force_next_flush();`);
  return JSON.parse(sql("SELECT COALESCE(jsonb_object_agg(funcname,calls),'{}'::jsonb) FROM pg_stat_user_functions;"));
}
const deniedTask = id(5, 2); // A/NULL department, creator admin-A; readable by member-A-none, not manageable.
const negativeWrites = [
  ["DELETE_OTHER_ASSIGNEE", `DELETE FROM public.task_assignees WHERE task_id='${deniedTask}' AND employee_id='${users[3].employee}' RETURNING task_id;`],
  ["UPDATE_OTHER_ASSIGNEE", `UPDATE public.task_assignees SET completed_at=now() WHERE task_id='${deniedTask}' AND employee_id='${users[3].employee}' RETURNING task_id;`],
  ["UPDATE_NONAUTHOR_FEEDBACK", `UPDATE public.employee_task_feedbacks SET body='denied' WHERE id='${id(6, 3)}' RETURNING id;`]
];

try {
  run(initdb, ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  run(pgCtl, ["-D", dataDir, "-o", `-k ${socketDir} -c listen_addresses=''`, "-w", "start"], { stdio: "ignore" });
  started = true;
  console.log(`POSTGRES_VERSION=${sql("SHOW server_version;")}`);
  sql(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE public.companies (id uuid PRIMARY KEY, name text);
    CREATE TABLE public.employees (id uuid PRIMARY KEY, user_id uuid, active boolean DEFAULT true, is_super_admin boolean DEFAULT false);
    CREATE TABLE public.roles (id uuid PRIMARY KEY, company_id uuid, permissions jsonb DEFAULT '{}'::jsonb);
    CREATE TABLE public.employee_companies (employee_id uuid, company_id uuid, role_id uuid, is_company_admin boolean DEFAULT false);
    CREATE TABLE public.employee_departments (employee_id uuid, department_id uuid);
    CREATE TABLE public.employee_tasks (id uuid PRIMARY KEY, company_id uuid, department_id uuid, creator_employee_id uuid,
      employee_id uuid, parent_task_id uuid, needs_approval boolean DEFAULT false, title text);
    -- No FK in this fixture so orphan rows exercise the existing parent/ADMIN policy behavior.
    CREATE TABLE public.task_assignees (task_id uuid, employee_id uuid, completed_at timestamptz, abandoned_at timestamptz,
      PRIMARY KEY (task_id, employee_id));
    CREATE TABLE public.employee_task_feedbacks (id uuid PRIMARY KEY, task_id uuid, author_user_id uuid, body text);
    ${read("scripts/test-support/task-scope-rls-helpers.sql")}
    ${helper(31, "is_task_assignee")}
    ${["has_company_permission", "can_manage_task_assignees", "is_valid_task_assignee", "prevent_task_assignee_identity_update"].map((name) => helper(82, name)).join("\n")}
    ${["can_manage_task_subtasks", "can_insert_task_subtask"].map((name) => helper(94, name)).join("\n")}

    ALTER TABLE public.employee_tasks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.employee_task_feedbacks ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_tasks, public.task_assignees, public.employee_task_feedbacks TO authenticated;
    GRANT SELECT ON public.employee_tasks, public.task_assignees, public.employee_task_feedbacks TO anon;
    ${["tasks_admin_all", "fb_admin_all", "fb_author_modify", "fb_author_delete"].map((name) => policy(15, name)).join("\n")}
    ${["tasks_select_by_company", "tasks_update", "task_assignees_select", "task_assignees_insert_manage",
      "task_assignees_update_manage", "task_assignees_update_self", "task_assignees_delete_manage", "fb_select_by_task_scope",
      "fb_author_insert"].map((name) => policy(82, name)).join("\n")}
    ${["tasks_insert", "tasks_delete"].map((name) => policy(94, name)).join("\n")}
    INSERT INTO public.companies VALUES ('${A}','A'), ('${B}','B');
    INSERT INTO public.roles VALUES ('${id(7, 1)}','${A}','{}'), ('${id(7, 2)}','${B}','{}');
    INSERT INTO public.employees VALUES ${employeeRows
      .map((user) => `('${user.employee}','${user.uid}',${user.active},${user.super === true})`).join(",")};
    INSERT INTO public.employee_companies VALUES ${employeeRows.flatMap((user) => (user.boundCompanies || user.companies)
      .map((company) => `('${user.employee}','${company}','${id(7, company === A ? 1 : 2)}',${user.adminCompanies.includes(company)})`)).join(",")};
    INSERT INTO public.employee_departments VALUES ${employeeRows.flatMap((user) => user.departments.map((department) => `('${user.employee}','${department}')`)).join(",")};
    INSERT INTO public.employee_tasks (id, company_id, department_id, creator_employee_id) VALUES
      ${tasks.map((task) => `('${task.id}',${literal(task.company)},${literal(task.department)},${literal(task.creator)})`).join(",")};
    INSERT INTO public.task_assignees (task_id,employee_id) VALUES ${assignments.map((row) => `('${row.task}','${row.employee}')`).join(",")};
    INSERT INTO public.employee_task_feedbacks (id,task_id,author_user_id) VALUES ${feedbacks.map((row) => `('${row.id}','${row.task}','${users[1].uid}')`).join(",")};
    ANALYZE;
  `);
  for (const user of users.filter((user) => !user.missing && user.active)) {
    selectedEmployees.set(user.name, asUser(user, "SELECT public.current_employee_id();"));
  }
  // Full original 111 + 104 unread function; additional empty read tables are fixture-only.
  sql(read("scripts/test-support/task-scope-rpc-fixture.sql"));
  sql(`CREATE TRIGGER trg_prevent_task_assignee_identity_update BEFORE UPDATE ON public.task_assignees
    FOR EACH ROW EXECUTE FUNCTION public.prevent_task_assignee_identity_update();`);
  sql(helper(82, "can_select_employee"));
  sql(["employees_select_by_company", "employee_companies_select_by_company", "roles_select_by_company"]
    .map((name) => policy(82, name)).join("\n"));
  sql(["dept_select", "emp_dept_select"].map((name) => policy(52, name)).join("\n"));
  for (const [path, name] of [["migrations/103_guard_non_array_invoice_items.sql", "bizflow_jsonb_array"],
    ["migrations/104_bizflow_data_phase1_r5.sql", "bizflow_unread_summary"]]) {
    sql(extract(read(path), new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^]*?\\$function\\$;`), name));
  }
  sql(read("migrations/111_bizflow_team_task_page.sql"));
  const beforeLists = capture();
  const beforeRows = Object.fromEntries(users.map((user) => [user.name, childRows(user)]));
  const beforePayloads = Object.fromEntries(users.map((user) => [user.name, rpcPayload(user)]));
  const limitedBefore = rpcPayload(users[2], rpcStatement(A, "1", false));
  const policiesBefore = policies();
  const helpersBefore = helpers();
  const rpcBefore = functionInfo(rpcSignature);
  const rpcCommentBefore = sql(`SELECT obj_description('${rpcSignature}'::regprocedure, 'pg_proc');`);
  const callsBefore = functionCalls(users[2], rpcStatement());
  scenario("old direct policies match the fourteen-identity visibility oracle", () => {
    for (const user of users) assert.deepEqual(beforeLists[user.name], expectedLists(user), user.name);
    assert.equal(beforeRows.super.feedbacks.length, 74, "the unchanged fb_admin_all exposes four orphan rows");
  });
  scenario("116 is repeatable with identical scope functions and RPC catalogs", () => {
    const applied = mutation ? mutations[mutation] : migration;
    sql(applied);
    const once = { policies: policies(), scope: scopeCatalog(), rpc: functionInfo(rpcSignature) };
    sql(applied);
    assert.deepEqual({ policies: policies(), scope: scopeCatalog(), rpc: functionInfo(rpcSignature) }, once);
  });
  scenario("every policy on all three task tables stays byte-identical", () => {
    assert.deepEqual(policies(), policiesBefore);
    assert.deepEqual(capture(), beforeLists);
    console.log("POLICIES_UNCHANGED=all three tables; DIRECT_LISTS=42/42");
  });
  scenario("old helpers and RPC metadata stay unchanged; RPC body changes only two FROMs", () => {
    assert.deepEqual(helpers(), helpersBefore);
    const rpcAfter = functionInfo(rpcSignature);
    assert.equal(rpcAfter.provolatile, "s");
    assert.equal(rpcAfter.prosecdef, false);
    assert.deepEqual({ ...rpcAfter, prosrc: rpcBefore.prosrc }, rpcBefore);
    const expected = rpcBefore.prosrc.replace("FROM public.task_assignees AS assignee", "FROM public.bizflow_scoped_task_assignees() AS assignee")
      .replace("FROM public.employee_task_feedbacks AS feedback", "FROM public.bizflow_scoped_task_feedbacks() AS feedback");
    assert.equal(rpcAfter.prosrc, expected);
  });
  for (const user of users) {
    scenario(`${user.name}: complete RPC payload retains array order and values`, () => {
      const payload = rpcPayload(user);
      assert.deepEqual(payload, beforePayloads[user.name], `${user.name}: RPC payload changed`);
      const counts = user.role === "anon" ? "denied=42501" : `tasks:${payload.tasks.length} assignees:${payload.assignees.length} feedbacks:${payload.feedbacks.length}`;
      console.log(`RPC_EQUIVALENCE_${user.name}=${counts}`);
    });
  }
  scenario("completed_limit=1 and summary mode preserve the exact RPC payload", () => {
    const payload = rpcPayload(users[2], rpcStatement(A, "1", false));
    assert.deepEqual(payload, limitedBefore);
    assert.equal(payload.tasks.filter((task) => task.status === "done").length, 1);
    assert.ok(payload.tasks.every((task) => !Object.hasOwn(task, "note") && !Object.hasOwn(task, "attachments")));
    console.log(`RPC_LIMITED_MATCH=tasks:${payload.tasks.length}; done:1; detail:false`);
  });
  for (const table of ["task_assignees", "employee_task_feedbacks"]) {
    scenario(`${table}: single-row plan contains no visible-set function`, () => {
      const statement = `SELECT count(*) FROM public.${table} WHERE task_id='${deniedTask}'`;
      const plan = JSON.parse(asUser(users[2], `EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON) ${statement};`))[0].Plan;
      assertLegacyPlan(plan, table);
      assert.equal(asUser(users[2], `${statement};`), "2");
    });
  }
  scenario("scope function properties and direct execution ACLs are exact", () => {
    scopeFunctions.forEach((name, index) => {
      const fn = functionInfo(`public.${name}()`);
      assert.equal(fn.provolatile, "s");
      assert.equal(fn.prosecdef, true);
      assert.equal(fn.proretset, true);
      const returnType = index === 0 ? "uuid" : `public.${index === 1 ? "task_assignees" : "employee_task_feedbacks"}`;
      assert.equal(fn.prorettype, sql(`SELECT '${returnType}'::regtype::oid;`));
      assert.deepEqual(fn.proconfig, ['search_path=""']);
      assert.equal(sql(`SELECT has_function_privilege('authenticated','public.${name}()','EXECUTE');`), index === 0 ? "f" : "t");
      assert.equal(sql(`SELECT has_function_privilege('anon','public.${name}()','EXECUTE');`), "f");
      const denied = asUser(users.at(-1), `SELECT * FROM public.${name}();`, true);
      assert.equal(denied.status, 3);
      assert.match(denied.stderr, new RegExp(`42501: permission denied for function ${name}`));
    });
    const privateCall = asUser(users[2], "SELECT public.bizflow_visible_task_ids();", true);
    assert.equal(privateCall.status, 3);
    assert.match(privateCall.stderr, /42501: permission denied for function bizflow_visible_task_ids/);
  });
  // Check an ordinary member first so the unfiltered mutation proves cross-scope
  // leakage, rather than stopping only at the super admin's orphan-row exception.
  for (const user of [users[2], ...users.filter((user) => user !== users[2] && user.role !== "anon")]) {
    scenario(`${user.name}: direct controlled readers expose no extra child rows`, () => {
      const actual = childRows(user, true);
      const parentIds = new Set(tasks.map((task) => task.id));
      const expected = Object.fromEntries(Object.entries(beforeRows[user.name]).map(([table, rows]) =>
        [table, rows.filter((row) => parentIds.has(row.task_id))]));
      // Confirmed R2 exception: fb_admin_all lets the super admin see orphans;
      // controlled readers omit them, while the RPC's task_rows JOIN always did.
      assert.deepEqual(actual, expected, `${user.name}: controlled reader scope changed`);
      const omitted = beforeRows[user.name].feedbacks.length - actual.feedbacks.length;
      assert.equal(omitted, user.name === "super" ? 4 : 0);
      console.log(`READER_SCOPE_${user.name}=assignees:${actual.assignees.length} feedbacks:${actual.feedbacks.length} omitted_orphans:${omitted}`);
    });
  }
  for (const name of scopeFunctions.slice(1)) {
    scenario(`${name} computes one visible set and one admin identity`, () => {
      const calls = functionCalls(users[2], `SELECT count(*) FROM public.${name}();`);
      assert.equal(calls[name], 1);
      assert.equal(calls.bizflow_visible_task_ids, 1);
      assert.equal(calls.is_bf_admin, 1);
      assert.equal(calls.can_select_employee_task_by_id || 0, 0);
      console.log(`READER_FUNCTION_CALLS_${name}=${JSON.stringify(calls)}`);
    });
  }
  // Count the entire real 111 RPC before and after the reader change; ancillary
  // policies still invoke the original identity helpers and are not hidden here.
  const callsAfter = functionCalls(users[2], rpcStatement());
  console.log(`RPC_FUNCTION_CALLS_BEFORE=${JSON.stringify(callsBefore)}`);
  console.log(`RPC_FUNCTION_CALLS_AFTER=${JSON.stringify(callsAfter)}`);
  scenario("RPC computes two visible sets and never calls child row-by-row scope", () => {
    assert.equal(callsAfter.bizflow_visible_task_ids, 2);
    assert.equal(callsAfter.bizflow_scoped_task_assignees, 1);
    assert.equal(callsAfter.bizflow_scoped_task_feedbacks, 1);
    assert.equal(callsAfter.can_select_employee_task_by_id || 0, 0);
    assert.ok(callsBefore.can_select_employee_task_by_id > 0);
  });
  for (const [name, statement] of negativeWrites) {
    scenario(`${name} remains denied`, () => assert.equal(asUser(users[2], statement), "", name));
  }
  const returned = asUser(users[1], `
    INSERT INTO public.employee_tasks (id,company_id,creator_employee_id,title)
      VALUES ('${id(5, 7000)}','${A}','${users[1].employee}','RETURNING fixture') RETURNING id;
    INSERT INTO public.task_assignees (task_id,employee_id)
      VALUES ('${id(5, 7000)}','${users[2].employee}') RETURNING task_id;
    INSERT INTO public.employee_task_feedbacks (id,task_id,author_user_id,body)
      VALUES ('${id(6, 7000)}','${id(5, 7000)}','${users[1].uid}','RETURNING fixture') RETURNING id;
    SET LOCAL request.jwt.claim.sub = '${users[2].uid}';
    UPDATE public.task_assignees SET completed_at=now()
      WHERE task_id='${id(5, 7000)}' AND employee_id='${users[2].employee}' RETURNING task_id;
  `).split("\n");
  ["tasks INSERT", "assignees INSERT", "feedbacks INSERT", "member own assignee UPDATE"].forEach((name, index) => {
    scenario(`${name} RETURNING succeeds`, () => {
      assert.equal(returned.length, 4);
      assert.equal(returned[index], id(index === 2 ? 6 : 5, 7000));
      console.log(`RETURNING_${index + 1}=1 row (${name})`);
    });
  });
  scenario("116 alone recreates a dropped RPC with safe ACL and original COMMENT under Supabase defaults", () => {
    const oldOid = functionInfo(rpcSignature).oid;
    sql(`DROP FUNCTION ${rpcSignature};`);
    sql(migration);
    assert.notEqual(functionInfo(rpcSignature).oid, oldOid, "fixture must recreate the RPC from scratch");
    assert.equal(sql(`SELECT has_function_privilege('anon','${rpcSignature}','EXECUTE');`), "f");
    assert.equal(sql(`SELECT has_function_privilege('authenticated','${rpcSignature}','EXECUTE');`), "t");
    assert.deepEqual(rpcPayload(users.at(-1)), { sqlstate: "42501" });
    assert.deepEqual(rpcPayload(users[2]), beforePayloads[users[2].name]);
    assert.ok(rpcCommentBefore.length > 0);
    assert.equal(sql(`SELECT obj_description('${rpcSignature}'::regprocedure, 'pg_proc');`), rpcCommentBefore);
    console.log("FRESH_116_RPC=anon:42501; authenticated:full payload equal; COMMENT:exact 111");
  });
  scenario("service_role cannot execute the private visible-set function despite explicit default grants", () => {
    assert.equal(sql("SELECT has_function_privilege('service_role','public.bizflow_visible_task_ids()','EXECUTE');"), "f");
    const denied = asUser({ role: "service_role", uid: "" }, "SELECT public.bizflow_visible_task_ids();", true);
    assert.equal(denied.status, 3);
    assert.match(denied.stderr, /42501: permission denied for function bizflow_visible_task_ids/);
    console.log("PRIVATE_VISIBLE_SET_SERVICE_ROLE=execute:false; call:42501");
  });
  scenario("116 replaces all three stale return types while preserving the RPC object and ACL", () => {
    const expectedScope = scopeCatalog();
    const expectedRpc = functionInfo(rpcSignature);
    sql(`DROP FUNCTION public.bizflow_scoped_task_assignees();
      DROP FUNCTION public.bizflow_scoped_task_feedbacks();
      DROP FUNCTION public.bizflow_visible_task_ids();
      ${scopeFunctions.map((name) => `CREATE FUNCTION public.${name}() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;`).join("\n")}`);
    assert.equal(sql("SELECT has_function_privilege('service_role','public.bizflow_visible_task_ids()','EXECUTE');"), "t",
      "Supabase default privileges must explicitly grant service_role before the migration revoke");
    sql(migration);
    assert.deepEqual(scopeCatalog(), expectedScope);
    assert.deepEqual(functionInfo(rpcSignature), expectedRpc, "RPC OID and ACL must survive 116 reruns");
    assert.deepEqual(rpcPayload(users[2]), beforePayloads[users[2].name]);
    console.log("STALE_RETURN_TYPES=3 replaced; RPC OID/ACL:unchanged; payload:equal");
  });
  if (!mutation) {
    for (const name of Object.keys(mutations)) {
      scenario(`${name} mutation makes the independent script fail`, () => {
        const result = run(process.execPath, [scriptPath, `--mutation=${name}`], { allowFailure: true });
        assert.equal(result.status, 1);
        assert.match(result.stderr, name === "unfiltered" ? /member-A-none: controlled reader scope changed/ : /RPC payload changed/);
        console.log(`TASK_SCOPE_RPC_MUTATION_${name.toUpperCase()}=DETECTED exit=1; ${result.stderr.match(/AssertionError[^\n]*/)?.[0]}`);
      });
    }
  }
  assert.equal(passed, 51);
  console.log(`TASK_SCOPE_RPC_PG=${passed}/${passed} (policies unchanged, 14 RPC identities, reader no-extra-row gate, three mutations, legacy single-row plans, two RPC visible sets)`);
} finally {
  if (started) run(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "stop"], { allowFailure: true });
  rmSync(probeRoot, { recursive: true, force: true });
}
