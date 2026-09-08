import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(repoRoot, path), "utf8");
const migration = read("migrations/116_task_scope_setbased_rls.sql");
const sources = {
  15: read("migrations/015_employee_management_v3.sql"),
  31: read("migrations/031_task_multi_assignees.sql"),
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
  department: without("t.department_id IS NULL OR ")
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
  { name: "anon", number: 9, role: "anon", missing: true, departments: [] }
].map((user) => ({ active: true, ...user, uid: user.role === "anon" ? "" : id(2, user.number), employee: id(1, user.number) }));
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
  { id: id(5, 30), company: null, department: D1, creator: null }
);
const orphanIds = [id(5, 9001), id(5, 9002)];
const assignments = [...tasks.map((task) => task.id), ...orphanIds]
  .flatMap((task) => [3, 4].map((employee) => ({ task, employee: id(1, employee) })));
const feedbacks = assignments.map((assignment, index) => ({ id: id(6, index + 1), task: assignment.task }));

function expectedLists(user) {
  if (user.missing || !user.active) return { tasks: [], assignees: [], feedbacks: [] };
  const visible = new Set(tasks.filter((task) => user.super
    || (user.admin && task.company === user.company)
    || task.creator === user.employee
    || (task.company === user.company && (task.department === null || user.departments.includes(task.department))))
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
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname <> 'bizflow_visible_task_ids';`));
}
const untouchedPolicy = (p) => !["task_assignees_select", "fb_select_by_task_scope"].includes(p.policyname);
function functionInfo() {
  return JSON.parse(sql(`SELECT to_jsonb(p) FROM pg_proc p WHERE oid='public.bizflow_visible_task_ids()'::regprocedure;`));
}
function assertEquivalent(before, after) {
  for (const user of users) for (const table of ["tasks", "assignees", "feedbacks"]) {
    assert.deepEqual(after[user.name][table], before[user.name][table], `${user.name}/${table} visibility changed`);
  }
}

try {
  run(initdb, ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  run(pgCtl, ["-D", dataDir, "-o", `-k ${socketDir} -c listen_addresses=''`, "-w", "start"], { stdio: "ignore" });
  started = true;
  console.log(`POSTGRES_VERSION=${sql("SHOW server_version;")}`);
  sql(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
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
    CREATE TRIGGER trg_prevent_task_assignee_identity_update BEFORE UPDATE ON public.task_assignees
      FOR EACH ROW EXECUTE FUNCTION public.prevent_task_assignee_identity_update();
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
    INSERT INTO public.employees VALUES ${users.filter((user) => !user.missing)
      .map((user) => `('${user.employee}','${user.uid}',${user.active},${user.super === true})`).join(",")};
    INSERT INTO public.employee_companies VALUES ${users.filter((user) => !user.missing && user.company)
      .map((user) => `('${user.employee}','${user.company}','${id(7, user.company === A ? 1 : 2)}',${user.admin === true})`).join(",")};
    INSERT INTO public.employee_departments VALUES ${users.flatMap((user) => user.departments.map((department) => `('${user.employee}','${department}')`)).join(",")};
    INSERT INTO public.employee_tasks (id, company_id, department_id, creator_employee_id) VALUES
      ${tasks.map((task) => `('${task.id}',${literal(task.company)},${literal(task.department)},${literal(task.creator)})`).join(",")};
    INSERT INTO public.task_assignees (task_id,employee_id) VALUES ${assignments.map((row) => `('${row.task}','${row.employee}')`).join(",")};
    INSERT INTO public.employee_task_feedbacks (id,task_id,author_user_id) VALUES ${feedbacks.map((row) => `('${row.id}','${row.task}','${users[1].uid}')`).join(",")};
    ANALYZE;
  `);
  const before = capture();
  const policiesBefore = policies();
  const helpersBefore = helpers();
  scenario("old policies match the independent nine-identity visibility oracle", () => {
    for (const user of users) assert.deepEqual(before[user.name], expectedLists(user), user.name);
    assert.equal(before.super.tasks.length, 30);
    assert.equal(before.super.assignees.length, 60);
    assert.equal(before.super.feedbacks.length, 64, "fb_admin_all must retain orphan visibility");
  });
  scenario("116 can be applied twice with identical function and policy catalogs", () => {
    sql(mutation ? mutations[mutation] : migration);
    const once = { policies: policies(), fn: functionInfo() };
    sql(mutation ? mutations[mutation] : migration);
    assert.deepEqual({ policies: policies(), fn: functionInfo() }, once);
  });
  scenario("employee_tasks, all write/admin_all policies and every old helper stay unchanged", () => {
    assert.deepEqual(policies().filter(untouchedPolicy), policiesBefore.filter(untouchedPolicy));
    assert.deepEqual(helpers(), helpersBefore);
    assert.equal(sql(`SELECT bool_and(relrowsecurity AND NOT relforcerowsecurity AND pg_get_userbyid(relowner)='postgres')
      FROM pg_class WHERE oid IN ('public.employee_tasks'::regclass,'public.task_assignees'::regclass,'public.employee_task_feedbacks'::regclass);`), "t");
  });
  const after = capture();
  for (const user of users) {
    scenario(`${user.name}: old/new full lists match across all three tables`, () => {
      for (const table of ["tasks", "assignees", "feedbacks"]) {
        assert.deepEqual(after[user.name][table], before[user.name][table], `${user.name}/${table} visibility changed`);
      }
      console.log(`EQUIVALENCE_${user.name}=${Object.entries(after[user.name]).map(([table, rows]) => `${table}:${rows.length}`).join(" ")}`);
    });
  }
  scenario("new function has the exact definer/stable/search_path/role boundary", () => {
    const fn = functionInfo();
    assert.equal(fn.prosecdef, true);
    assert.equal(fn.provolatile, "s");
    assert.deepEqual(fn.proconfig, ["search_path=public"]);
    assert.equal(sql("SELECT has_function_privilege('authenticated','public.bizflow_visible_task_ids()','EXECUTE');"), "t");
    assert.equal(sql("SELECT has_function_privilege('anon','public.bizflow_visible_task_ids()','EXECUTE');"), "f");
    const denied = asUser(users.at(-1), "SELECT public.bizflow_visible_task_ids();", true);
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /42501: permission denied for function bizflow_visible_task_ids/);
  });
  for (const [name, altered] of Object.entries(mutations)) {
    scenario(`removing ${name} branch makes full-list equivalence fail`, () => {
      try {
        sql(altered);
        assert.throws(() => assertEquivalent(before, capture()), (error) =>
          error instanceof assert.AssertionError && /visibility changed/.test(error.message));
        console.log(`TASK_SCOPE_MUTATION_${name.toUpperCase()}=DETECTED`);
      } finally { sql(migration); }
      assertEquivalent(before, capture());
    });
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
  for (const table of ["task_assignees", "employee_task_feedbacks"]) {
    scenario(`${table}: visible-task set is computed once`, () => {
      const statement = `SELECT count(*) FROM public.${table}`;
      const text = asUser(users[2], `EXPLAIN (ANALYZE, VERBOSE, FORMAT TEXT) ${statement};`);
      const plan = JSON.parse(asUser(users[2], `EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON) ${statement};`))[0].Plan;
      const nodes = [];
      function visit(node) { nodes.push(node); (node.Plans || []).forEach(visit); }
      visit(plan);
      const calls = nodes.filter((node) => node.Output?.some((output) => output.includes("bizflow_visible_task_ids")));
      assert.equal(calls.length, 1, "one set-producing plan node");
      assert.equal(calls[0]["Actual Loops"], 1);
      assert.match(text, /bizflow_visible_task_ids/);
      console.log(`EXPLAIN_${table}\n${text}\nSET_EVALUATIONS_${table}=1`);
    });
  }
  assert.equal(passed, 21);
  console.log("TASK_SCOPE_RLS_PG=21/21 (9 identities x 3 tables=27/27, two mutation gates, RETURNING 4/4, both set plans loops=1)");
} finally {
  if (started) run(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "stop"], { allowFailure: true });
  rmSync(probeRoot, { recursive: true, force: true });
}
