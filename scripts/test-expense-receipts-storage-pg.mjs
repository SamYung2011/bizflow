import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(scriptPath));
const source = (name) => readFileSync(join(repoRoot, "migrations", name), "utf8");
const migration = source("118_expense_receipts_private.sql");
const mutation = process.argv.find((arg) => arg.startsWith("--mutation="))?.split("=")[1];
assert.ok(!mutation || ["no-read", "public-bucket"].includes(mutation));
function extract(text, pattern) {
  const match = text.match(pattern);
  assert.ok(match, `Missing original SQL: ${pattern}`);
  return match[0];
}
const helper = (file, name) => extract(source(file), new RegExp(`CREATE OR REPLACE FUNCTION (?:public\\.)?${name}\\([^]*?\\n\\$\\$;`));
const writePolicies = extract(source("088_expense_rls_owner_admin.sql"), /DROP POLICY IF EXISTS expense_receipts_auth_upload[^]*?(?=NOTIFY pgrst)/);
const variants = {
  "no-read": migration.replace(/CREATE POLICY expense_receipts_auth_read[^]*?\n  \);/, ""),
  "public-bucket": migration.replace("UPDATE storage.buckets SET public = false WHERE id = 'expense-receipts';", "")
};
for (const variant of Object.values(variants)) assert.notEqual(variant, migration);

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
const probeRoot = mkdtempSync(join(tmpdir(), "bizflow-expense-storage-"));
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

const eid = (n) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const uid = (n) => `20000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const users = [
  { name: "no-access", n: 1, access: false },
  { name: "member-A", n: 2, access: true },
  { name: "member-B", n: 3, access: true },
  { name: "expense-admin", n: 4, admin: true, access: false },
  { name: "super-admin", n: 5, super: true, access: true },
  { name: "anon", n: 6, role: "anon" }
];
function asUser(user, statement, allowFailure = false) {
  const result = query(`BEGIN; SET LOCAL ROLE ${user.role || "authenticated"};
    SET LOCAL request.jwt.claim.sub = '${user.role === "anon" ? "" : uid(user.n)}';
    SET LOCAL request.jwt.claims = '{}';
    SET LOCAL statement_timeout = '8s'; ${statement} ROLLBACK;`, allowFailure);
  return allowFailure ? result : result.stdout.trim();
}
const rows = (user) => JSON.parse(asUser(user, `SELECT COALESCE(jsonb_agg(name ORDER BY name),'[]')
  FROM storage.objects WHERE bucket_id='expense-receipts';`));
function policies() {
  return JSON.parse(sql(`SELECT jsonb_agg(p ORDER BY policyname) FROM (
    SELECT policyname, roles, cmd, permissive, qual, with_check FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects') p;`));
}
function protectedPolicies() {
  return policies().filter((p) => !["expense_receipts_public_read", "expense_receipts_auth_read"].includes(p.policyname));
}
function scenario(name, callback) {
  callback(); passed += 1; console.log(`ok ${passed} - ${name}`);
}

try {
  run(initdb, ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  run(pgCtl, ["-D", dataDir, "-o", `-k ${socketDir} -c listen_addresses=''`, "-w", "start"], { stdio: "ignore" });
  started = true;
  console.log(`POSTGRES_VERSION=${sql("SHOW server_version;")}`);
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated, service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
      AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    CREATE TABLE public.employees (id uuid PRIMARY KEY, user_id uuid, active boolean DEFAULT true,
      is_admin boolean DEFAULT false, is_super_admin boolean DEFAULT false, bizflow_main_access boolean DEFAULT false, email text);
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean);
    CREATE TABLE storage.objects (id integer PRIMARY KEY, bucket_id text, name text, owner uuid);
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE
      AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
    GRANT SELECT ON storage.objects TO anon;
    ${helper("064_bizflow_main_access.sql", "has_bizflow_main_access")}
    ${helper("082_team_rls_hardening.sql", "current_employee_id")}
    ${helper("082_team_rls_hardening.sql", "is_bf_admin")}
    ${helper("088_expense_rls_owner_admin.sql", "can_admin_expenses")}
    ${extract(source("051_expense_reimbursements.sql"), /INSERT INTO storage.buckets[^]*?ON CONFLICT \(id\) DO NOTHING;/)}
    ${extract(source("051_expense_reimbursements.sql"), /DROP POLICY IF EXISTS "expense_receipts_public_read"[^]*?USING \(bucket_id = 'expense-receipts'\);/)}
    ${writePolicies}
    INSERT INTO storage.buckets VALUES ('other-bucket','other-bucket',true);
    CREATE POLICY other_bucket_anon_read ON storage.objects FOR SELECT TO anon USING (bucket_id='other-bucket');
    INSERT INTO public.employees (id,user_id,bizflow_main_access,is_admin,is_super_admin,email) VALUES
      ${users.filter((u) => !u.role).map((u) => `('${eid(u.n)}','${uid(u.n)}',${u.access},${!!u.admin},${!!u.super},'member${u.n}@example.invalid')`).join(",")};
    INSERT INTO storage.objects VALUES
      (1,'expense-receipts','${eid(2)}/one.jpg','${uid(2)}'),
      (2,'expense-receipts','${eid(2)}/two.png','${uid(2)}'),
      (3,'expense-receipts','${eid(3)}/three.jpg','${uid(3)}'),
      (9,'other-bucket','unrelated.jpg',NULL);`);
  const expected = [`${eid(2)}/one.jpg`, `${eid(2)}/two.png`, `${eid(3)}/three.jpg`];
  const before = protectedPolicies();
  const helperBefore = sql("SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE pronamespace='public'::regnamespace;");
  scenario("before 118 bucket is public and anon can select all receipt objects", () => {
    assert.equal(sql("SELECT public FROM storage.buckets WHERE id='expense-receipts';"), "t");
    assert.deepEqual(rows(users[5]), expected);
  });
  scenario("before 118 ordinary member can select other employee receipts", () => assert.deepEqual(rows(users[1]), expected));
  scenario("118 can run twice with identical policies and bucket metadata", () => {
    sql(mutation ? variants[mutation] : migration);
    const once = policies();
    sql(mutation ? variants[mutation] : migration);
    assert.deepEqual(policies(), once);
  });
  scenario("expense-receipts bucket is private", () => {
    assert.equal(sql("SELECT public FROM storage.buckets WHERE id='expense-receipts';"), "f", "receipt bucket must be private");
  });
  const expectedFor = [[], expected.slice(0,2), expected.slice(2), expected, expected, []];
  users.forEach((user,index) => scenario(`${user.name} has the exact allowed receipt list`, () => {
    assert.deepEqual(rows(user), expectedFor[index], `${user.name}: receipt visibility`);
    console.log(`RECEIPT_SCOPE_${user.name}=${expectedFor[index].length}`);
  }));
  scenario("all three 088 write policies and unrelated/anon policies are unchanged", () => {
    assert.deepEqual(protectedPolicies(), before);
    assert.equal(before.filter((p) => p.policyname.startsWith("expense_receipts_auth_")).length, 3);
    const read = policies().find((p) => p.policyname === "expense_receipts_auth_read");
    assert.deepEqual([read.cmd,read.roles,read.permissive], ["SELECT",["authenticated"],"PERMISSIVE"]);
    assert.ok(!policies().some((p) => p.policyname === "expense_receipts_public_read"));
  });
  scenario("removing Bizflow access hides even the caller's own two objects", () => {
    sql(`UPDATE public.employees SET bizflow_main_access=false WHERE id='${eid(2)}';`);
    assert.deepEqual(rows(users[1]), []);
    sql(`UPDATE public.employees SET bizflow_main_access=true WHERE id='${eid(2)}';`);
  });
  scenario("owner INSERT/UPDATE/DELETE still work", () => {
    assert.equal(asUser(users[1], `INSERT INTO storage.objects VALUES (4,'expense-receipts','${eid(2)}/new.png','${uid(2)}') RETURNING id;`), "4");
    assert.equal(asUser(users[1], "UPDATE storage.objects SET owner=NULL WHERE id=1 RETURNING id;"), "1");
    assert.equal(asUser(users[1], "DELETE FROM storage.objects WHERE id=1 RETURNING id;"), "1");
  });
  scenario("receipt admin read permission does not grant other-directory writes", () => {
    const result = asUser(users[3], `INSERT INTO storage.objects VALUES (4,'expense-receipts','${eid(2)}/new.png',NULL);`, true);
    assert.equal(result.status, 3); assert.match(result.stderr, /42501: new row violates row-level security policy/);
    assert.equal(asUser(users[3], "UPDATE storage.objects SET owner=NULL WHERE id=1 RETURNING id;"), "");
    assert.equal(asUser(users[3], "DELETE FROM storage.objects WHERE id=1 RETURNING id;"), "");
  });
  scenario("other bucket and existing helpers remain unchanged", () => {
    assert.equal(sql("SELECT public FROM storage.buckets WHERE id='other-bucket';"), "t");
    assert.equal(asUser(users[5], "SELECT count(*) FROM storage.objects WHERE bucket_id='other-bucket';"), "1");
    assert.equal(sql("SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE pronamespace='public'::regnamespace;"), helperBefore);
  });
  if (!mutation) for (const name of Object.keys(variants)) {
    scenario(`${name} mutation fails the independent PostgreSQL script`, () => {
      const result = run(process.execPath,[scriptPath,`--mutation=${name}`],{allowFailure:true});
      assert.equal(result.status,1);
      assert.match(result.stderr, name === "no-read" ? /member-A: receipt visibility/ : /receipt bucket must be private/);
      console.log(`RECEIPTS_STORAGE_MUTATION_${name}=DETECTED exit=1`);
    });
  }
  assert.equal(passed, 17);
  console.log(`EXPENSE_RECEIPTS_STORAGE_PG=${passed}/${passed} (private bucket, six identities, original writes, two mutation gates)`);
} finally {
  if (started) run(pgCtl,["-D",dataDir,"-m","fast","-w","stop"],{allowFailure:true});
  rmSync(probeRoot,{recursive:true,force:true});
}
