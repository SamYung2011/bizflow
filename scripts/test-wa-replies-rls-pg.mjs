import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = (name) => readFileSync(join(repoRoot, "migrations", name), "utf8");
const source012 = source("012_wa_cloud_api.sql");
const source064 = source("064_bizflow_main_access.sql");
const source065 = source("065_rls_bizflow_main_access.sql");
const source109 = source("109_wa_admin_rls_alignment.sql");
const migration = source("114_wa_replies_admin_write.sql");
const mutate = process.argv.includes("--mutate-admin-gate");
assert.ok(process.argv.slice(2).every((arg) => arg === "--mutate-admin-gate"), "unknown argument");
const adminGate = "AND public.is_wa_admin()";
assert.equal(migration.split(adminGate).length - 1, 4, "all four write predicates must be mutable");
const mutation = migration.replaceAll(adminGate, "");

function extract(text, pattern, label) {
  const match = text.match(pattern);
  assert.ok(match, `${label} must come from its existing migration`);
  return match[0];
}

function executable(name) {
  for (const candidate of [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, name]) {
    try {
      if (candidate === name) return candidate;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
}

const initdb = executable("initdb");
const pgCtl = executable("pg_ctl");
const psql = executable("psql");
// Always start our own socket-only cluster; never inherit a database connection.
const pgEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG")));
const probeRoot = mkdtempSync(join(tmpdir(), "bizflow-wa-replies-"));
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

function sql(input) {
  return query(input).stdout.trim();
}

const MEMBER = { uid: "20000000-0000-0000-0000-000000000001", email: "member@example.invalid" };
const ADMIN = { uid: "20000000-0000-0000-0000-000000000002", email: "admin@example.invalid" };
const EMAIL_ADMIN = { uid: "20000000-0000-0000-0000-000000000003", email: "samyung2011@gmail.com" };
const NO_ACCESS = { uid: "20000000-0000-0000-0000-000000000004", email: "samyung2011@gmail.com" };
const ANON = { role: "anon", uid: "", email: "" };

function asUser(user, statement, allowFailure = false) {
  // Literal fixture IDs are resolved before SET ROLE; no protected employees lookup here.
  const result = query(`
    BEGIN;
    SET LOCAL ROLE ${user.role || "authenticated"};
    SET LOCAL request.jwt.claim.sub = '${user.uid}';
    SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: user.uid, email: user.email })}';
    SET LOCAL statement_timeout = '8s';
    ${statement}
    ROLLBACK;
  `, allowFailure);
  return allowFailure ? result : result.stdout.trim();
}

function scenario(name, callback) {
  callback();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function updateCount(user) {
  return asUser(user, `WITH changed AS (
    UPDATE public.wa_replies SET delivered_at = now(), delivery_meta = '{"reason":"manual_skip"}'::jsonb
    WHERE id = 1 RETURNING id
  ) SELECT count(*) FROM changed;`);
}

function memberCannotUpdate() {
  assert.equal(updateCount(MEMBER), "0", "ordinary member UPDATE delivered_at must affect 0 rows");
}

function insertDenied(user) {
  const result = asUser(user,
    "INSERT INTO public.wa_replies (customer_id, segments) VALUES ('forbidden', '[]');", true);
  assert.notEqual(result.status, 0, "INSERT must be rejected");
  assert.match(result.stderr, /42501: new row violates row-level security policy for table "wa_replies"/);
}

function policies() {
  return JSON.parse(sql(`SELECT json_agg(p ORDER BY policyname) FROM (
    SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wa_replies'
  ) p;`));
}

try {
  run(initdb, ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  run(pgCtl, ["-D", dataDir, "-o", `-k ${socketDir} -c listen_addresses=''`, "-w", "start"], { stdio: "ignore" });
  started = true;
  sql(`
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
      AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    CREATE TABLE public.employees (
      user_id uuid PRIMARY KEY, name text, role text, is_admin boolean DEFAULT false
    );
    CREATE TABLE public.wa_pending_replies (id bigint PRIMARY KEY);
    ${extract(source012, /CREATE TABLE IF NOT EXISTS wa_replies \([\s\S]*?\n\);/, "wa_replies table")}
    ${extract(source012, /ALTER TABLE wa_replies ENABLE ROW LEVEL SECURITY;[\s\S]*?WITH CHECK \(true\);/, "initial authenticated policy")}
    ${extract(source012, /DROP POLICY IF EXISTS "anon_read_replies"[\s\S]*?WITH CHECK \(true\);/, "anon policies")}
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_replies TO authenticated;
    GRANT SELECT, UPDATE ON public.wa_replies TO anon;
    GRANT USAGE ON SEQUENCE public.wa_replies_id_seq TO authenticated;
  `);
  sql(source064);
  sql(source109);
  sql(extract(source065, /DROP POLICY IF EXISTS "authenticated_all" ON wa_replies;[\s\S]*?WITH CHECK \(has_bizflow_main_access\(\)\);/, "065 authenticated policy"));
  sql(`
    INSERT INTO public.employees (user_id, name, is_admin, bizflow_main_access) VALUES
      ('${MEMBER.uid}', 'Member', false, true),
      ('${ADMIN.uid}', 'Admin', true, false),
      ('${EMAIL_ADMIN.uid}', 'Email admin', false, true),
      ('${NO_ACCESS.uid}', 'No Bizflow access', false, false);
    INSERT INTO public.wa_replies (customer_id, segments) VALUES ('fixture', '[]');
  `);

  scenario("real helpers resolve in public and authenticated can execute", () => {
    assert.equal(sql(`SELECT n.nspname || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.oid = 'public.has_bizflow_main_access()'::regprocedure;`), "public|true");
    assert.equal(asUser(MEMBER, "SELECT public.has_bizflow_main_access(), public.is_wa_admin();"), "t|f");
    assert.equal(asUser(ADMIN, "SELECT public.has_bizflow_main_access(), public.is_wa_admin();"), "t|t");
    assert.equal(asUser(EMAIL_ADMIN, "SELECT public.has_bizflow_main_access(), public.is_wa_admin();"), "t|t");
    assert.equal(asUser(NO_ACCESS, "SELECT public.has_bizflow_main_access(), public.is_wa_admin();"), "f|t");
  });
  scenario("before 114 ordinary member UPDATE affects 1 row", () => {
    assert.equal(updateCount(MEMBER), "1");
  });
  const anonBefore = policies().filter((p) => p.roles.includes("anon"));
  const appliedMigration = mutate ? mutation : migration;
  scenario("114 can be applied twice without changing policies", () => {
    sql(appliedMigration);
    const once = policies();
    sql(appliedMigration);
    assert.deepEqual(policies(), once);
  });
  scenario("exactly six policies, old FOR ALL removed, anon definitions unchanged", () => {
    const current = policies();
    assert.deepEqual(current.map((p) => [p.policyname, p.roles, p.cmd]), [
      ["anon_mark_delivered", ["anon"], "UPDATE"],
      ["anon_read_replies", ["anon"], "SELECT"],
      ["wa_replies_admin_delete", ["authenticated"], "DELETE"],
      ["wa_replies_admin_insert", ["authenticated"], "INSERT"],
      ["wa_replies_admin_update", ["authenticated"], "UPDATE"],
      ["wa_replies_read", ["authenticated"], "SELECT"]
    ]);
    assert.deepEqual(current.filter((p) => p.roles.includes("anon")), anonBefore);
  });
  scenario("ordinary member can SELECT but UPDATE affects 0 rows", () => {
    assert.equal(asUser(MEMBER, "SELECT count(*) FROM public.wa_replies;"), "1");
    memberCannotUpdate();
  });
  scenario("employees.is_admin administrator UPDATE affects 1 row", () => {
    assert.equal(updateCount(ADMIN), "1");
  });
  scenario("anon extension can SELECT and UPDATE 1 row", () => {
    assert.equal(asUser(ANON, "SELECT count(*) FROM public.wa_replies;"), "1");
    assert.equal(updateCount(ANON), "1");
  });
  scenario("ordinary member INSERT rejected and DELETE affects 0 rows", () => {
    insertDenied(MEMBER);
    assert.equal(asUser(MEMBER, "WITH changed AS (DELETE FROM public.wa_replies WHERE id = 1 RETURNING id) SELECT count(*) FROM changed;"), "0");
  });
  scenario("administrator can INSERT and DELETE", () => {
    assert.equal(asUser(ADMIN, `
      INSERT INTO public.wa_replies (customer_id, segments) VALUES ('admin-created', '[]');
      WITH changed AS (DELETE FROM public.wa_replies WHERE customer_id = 'admin-created' RETURNING id)
      SELECT count(*) FROM changed;
    `), "1");
  });
  scenario("109 email allowlist administrator UPDATE affects 1 row", () => {
    assert.equal(updateCount(EMAIL_ADMIN), "1");
  });
  scenario("email allowlist alone cannot bypass Bizflow access", () => {
    assert.equal(asUser(NO_ACCESS, "SELECT count(*) FROM public.wa_replies;"), "0");
    assert.equal(updateCount(NO_ACCESS), "0");
    insertDenied(NO_ACCESS);
    assert.equal(asUser(NO_ACCESS, "WITH changed AS (DELETE FROM public.wa_replies WHERE id = 1 RETURNING id) SELECT count(*) FROM changed;"), "0");
  });
  scenario("removing is_wa_admin makes the ordinary member assertion fail", () => {
    try {
      sql(mutation);
      assert.throws(memberCannotUpdate, (error) =>
        error instanceof assert.AssertionError && error.actual === "1" && error.expected === "0");
      console.log("WA_REPLIES_MUTATION=DETECTED (ordinary member UPDATE actual=1 expected=0)");
    } finally {
      sql(migration);
    }
    memberCannotUpdate();
    assert.deepEqual(policies().filter((p) => p.roles.includes("anon")), anonBefore);
  });
  assert.equal(passed, 12);
  console.log("WA_REPLIES_RLS_PG=12/12 (local socket-only PostgreSQL; mutation gate detected)");
} finally {
  if (started) run(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "stop"], { allowFailure: true });
  rmSync(probeRoot, { recursive: true, force: true });
}
