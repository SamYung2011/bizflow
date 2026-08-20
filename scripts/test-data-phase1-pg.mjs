import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { buildCustomerGroups } from "../root-site/data/customer-groups.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationPath = join(repoRoot, "migrations/102_bizflow_data_phase1.sql");

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
const probeRoot = mkdtempSync(join(tmpdir(), "bizflow-data1-r3-"));
const dataDir = join(probeRoot, "data");
const socketDir = join(probeRoot, "socket");
mkdirSync(socketDir);
let started = false;

function run(command, args, { input = undefined, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  if (!quiet && result.stderr) process.stderr.write(result.stderr);
  return result.stdout.trim();
}

function psqlArgs(extra = []) {
  return ["-X", "-qAt", "-h", socketDir, "-d", "postgres", "-v", "ON_ERROR_STOP=1", ...extra];
}

function sql(input) {
  return run(psql, psqlArgs(), { input, quiet: true });
}

function asAuthenticated(statement) {
  return sql(`
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
    SET statement_timeout = '8s';
    ${statement}
  `).split("\n").filter(Boolean).at(-1);
}

function timedAuthenticated(statement) {
  const startedAt = performance.now();
  const value = asAuthenticated(statement);
  return { value, elapsedMs: performance.now() - startedAt };
}

function customerId(index) {
  return `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
}

function semanticFixture() {
  const rows = Array.from({ length: 541 }, (_, offset) => {
    const index = offset + 1;
    return {
      id: customerId(index),
      name: `Unique ${index}`,
      phone: `852-${index}`,
      phone_mainland: `86-${index}`,
      email: `unique-${index}@example.test`,
      address: `Address ${index}`,
      parent_id: null,
      merge_exclude: []
    };
  });
  for (let index = 100; index < 160; index += 1) rows[index - 1].address = "Shared shop address";
  for (let index = 160; index < 190; index += 1) rows[index - 1].email = "shared@example.test";
  for (let index = 190; index < 215; index += 1) {
    rows[index - 1].email = "two-fields@example.test";
    rows[index - 1].address = "Two fields only";
  }

  [rows[0], rows[1], rows[2]].forEach((row, index) => {
    row.name = "Fuzzy trio";
    row.email = ["trio-cat@example.test", "trio-cut@example.test", "trio-cute@example.test"][index];
    row.address = ["Lane 1", "Lane 2", "Lane 22"][index];
  });
  [rows[3], rows[4]].forEach((row) => Object.assign(row, { name: "Exact three", phone: "852-exact", phone_mainland: "86-exact" }));
  [rows[5], rows[6]].forEach((row, index) => Object.assign(row, {
    name: "Fuzzy pair", email: ["mail-a@test", "mail-b@test"][index], address: ["Road A", "Road B"][index]
  }));
  [rows[7], rows[8]].forEach((row, index) => Object.assign(row, {
    phone: "852-shared", email: ["phone-a@test", "phone-b@test"][index], address: ["Phone A", "Phone B"][index]
  }));
  [rows[9], rows[10]].forEach((row, index) => Object.assign(row, {
    phone_mainland: "86-shared", email: ["main-a@test", "main-b@test"][index], address: ["Main A", "Main B"][index]
  }));

  for (let index = 542; index <= 547; index += 1) {
    rows.push({
      id: customerId(index),
      name: `Physical child ${index}`,
      phone: "",
      phone_mainland: "",
      email: "",
      address: "",
      parent_id: customerId(index - 530),
      merge_exclude: []
    });
  }
  return rows;
}

function quote(value) {
  if (value == null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

try {
  run(initdb, ["-D", dataDir, "-A", "trust", "--no-locale"], { quiet: true });
  const startResult = spawnSync(
    pgCtl,
    ["-D", dataDir, "-o", `-k ${socketDir} -c listen_addresses=''`, "-w", "start"],
    { cwd: repoRoot, encoding: "utf8", stdio: "ignore" }
  );
  if (startResult.status !== 0) throw new Error(`pg_ctl start failed (${startResult.status})`);
  started = true;

  sql(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
    CREATE TABLE public.employees (
      id uuid PRIMARY KEY, user_id uuid, name text, created_at timestamptz DEFAULT now(),
      active boolean DEFAULT true, bizflow_main_access boolean DEFAULT false, is_admin boolean DEFAULT false
    );
    CREATE FUNCTION public.has_bizflow_main_access() RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth
      AS $$ SELECT EXISTS (SELECT 1 FROM public.employees WHERE user_id=auth.uid() AND (bizflow_main_access OR is_admin)) $$;
    GRANT EXECUTE ON FUNCTION public.has_bizflow_main_access() TO authenticated, anon;
    CREATE FUNCTION public.current_employee_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth
      AS $$ SELECT id FROM public.employees WHERE user_id=auth.uid() LIMIT 1 $$;
    GRANT EXECUTE ON FUNCTION public.current_employee_id() TO authenticated;

    CREATE TABLE public.invoices (
      id text PRIMARY KEY, invoice_number text, customer_id uuid, salesperson_id uuid, date date,
      created_at timestamptz DEFAULT now(), total numeric DEFAULT 0, status text, notes text,
      shipping_status text, shipped_at timestamptz, tracking_number text, items jsonb
    );
    CREATE TABLE public.customers (
      id uuid PRIMARY KEY, name text, phone text, phone_mainland text, email text, address text,
      car_make text, car_model text, parent_id uuid, merge_exclude jsonb DEFAULT '[]'::jsonb
    );
    CREATE TABLE public.products (
      id uuid PRIMARY KEY, name text, warranty_months integer DEFAULT 0, is_virtual boolean DEFAULT false,
      category text, parent_product_id uuid, status text, image_url text, internal_code text, code text, shopify_sku text
    );
    CREATE TABLE public.inventory_stock (product_id uuid, qty integer);
    CREATE TABLE public.line_item_aliases (alias_name text, skip boolean DEFAULT false, products jsonb DEFAULT '[]'::jsonb);
    CREATE TABLE public.warranty_renewals (
      id uuid PRIMARY KEY, invoice_id text, product_id uuid, months integer, paid_at date,
      previous_end date, new_end date, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.employee_companies (
      employee_id uuid, company_id uuid, role_id uuid, is_company_admin boolean DEFAULT false, joined_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.roles (id uuid PRIMARY KEY, name text);
    CREATE TABLE public.employee_tasks (
      id uuid PRIMARY KEY, parent_task_id uuid, status text, created_at timestamptz DEFAULT now(), title text,
      due_date date, company_id uuid, creator_employee_id uuid, employee_id uuid
    );
    CREATE TABLE public.task_assignees (task_id uuid, employee_id uuid, abandoned_at timestamptz);
    CREATE TABLE public.employee_task_feedbacks (task_id uuid);
    CREATE TABLE public.departments (id uuid PRIMARY KEY, name text, company_id uuid);
    CREATE TABLE public.employee_departments (employee_id uuid, department_id uuid);
    CREATE TABLE public.task_pending (reviewed_at timestamptz);
    CREATE TABLE public.team_update_logs (created_at timestamptz DEFAULT now());

    DO $$
    DECLARE table_name text;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY['customers','invoices','products','inventory_stock','line_item_aliases','warranty_renewals'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
          'CREATE POLICY access ON public.%I FOR ALL TO authenticated USING (public.has_bizflow_main_access()) WITH CHECK (public.has_bizflow_main_access())',
          table_name
        );
      END LOOP;
    END $$;

    INSERT INTO public.employees(id,user_id,name,bizflow_main_access)
      VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','KC',true);
    INSERT INTO public.employee_companies(employee_id,company_id)
      VALUES ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
    INSERT INTO public.customers(id,name,phone,phone_mainland,email,address)
    SELECT md5('customer-'||i)::uuid,
           CASE WHEN i<=5 THEN 'Duplicate Five' ELSE 'Customer '||i END,
           CASE WHEN i<=5 THEN '852-5555' ELSE '852-'||lpad(i::text,8,'0') END,
           CASE WHEN i<=5 THEN '86-5555' ELSE '86-'||lpad(i::text,8,'0') END,
           'customer-'||i||'@example.test',
           CASE WHEN i<=450 THEN 'Shared HK store address' ELSE 'Address '||i END
    FROM generate_series(1,4500) AS i;
    INSERT INTO public.products(id,name,warranty_months,status,internal_code)
      SELECT md5('product-'||i)::uuid,'Product '||i,12,'active','P-'||i FROM generate_series(1,100) AS i;
    INSERT INTO public.inventory_stock(product_id,qty) SELECT id,100 FROM public.products;
    INSERT INTO public.invoices(id,invoice_number,customer_id,salesperson_id,date,created_at,total,status,shipping_status,items)
    SELECT 'invoice-'||i, i::text, md5('customer-'||(((i-1)%4500)+1))::uuid,
           '10000000-0000-0000-0000-000000000001', current_date-(i%365), now()-(i||' minutes')::interval,
           100+(i%1000), CASE WHEN i%5=0 THEN 'Unpaid' ELSE 'Paid' END,
           CASE WHEN i%4=0 THEN '簽收' ELSE 'unshipped' END,
           jsonb_build_array(
             jsonb_build_object('name','Product '||(((i-1)%100)+1),'product_id',(md5('product-'||(((i-1)%100)+1))::uuid)::text,'qty',1,'price',100+(i%100),'warranty_months',12),
             jsonb_build_object('name','Product '||((i%100)+1),'product_id',(md5('product-'||((i%100)+1))::uuid)::text,'qty',1,'price',50+(i%50),'warranty_months',12)
           )
    FROM generate_series(1,6603) AS i;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

    CREATE INDEX invoices_order_page_created_idx ON public.invoices(created_at);
    CREATE INDEX invoices_order_page_date_idx ON public.invoices(date);
    CREATE INDEX invoices_order_page_customer_idx ON public.invoices(customer_id);
    CREATE INDEX invoices_order_page_salesperson_idx ON public.invoices(salesperson_id);
    CREATE INDEX invoices_order_page_shipping_idx ON public.invoices(shipping_status);
  `);

  run(psql, psqlArgs(["-f", migrationPath]), { quiet: true });
  run(psql, psqlArgs(["-f", migrationPath]), { quiet: true });
  assert.equal(sql("SELECT count(*) FROM pg_indexes WHERE indexname LIKE 'invoices_order_page_%';"), "0",
    "migration reruns must remove all five R1 staging indexes");

  const group = timedAuthenticated("SELECT public.bizflow_customer_group_count();");
  assert.equal(Number(group.value), 4496, "a five-person duplicate cluster must collapse without counting 450 shared addresses");
  assert.ok(group.elapsedMs < 1000, `authenticated customer grouping must stay below 1s, got ${group.elapsedMs.toFixed(1)}ms`);

  const home = timedAuthenticated("SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')->'counts'->>'customers';");
  assert.equal(Number(home.value), 4496);
  assert.ok(home.elapsedMs < 2000, `authenticated Home RPC must stay below 2s, got ${home.elapsedMs.toFixed(1)}ms`);

  const cappedOffset = JSON.parse(asAuthenticated("SELECT public.bizflow_order_page(NULL,NULL,NULL,NULL,NULL,'newest',2147483647,50)::text;"));
  assert.equal(cappedOffset.total_count, 6603);
  assert.deepEqual(cappedOffset.rows, [], "an oversized offset must be capped safely and return no phantom page rows");

  const revenue = timedAuthenticated("SELECT public.bizflow_order_revenue('all')->>'paid_count';");
  assert.equal(Number(revenue.value), 5283);
  assert.ok(revenue.elapsedMs < 4000, `authenticated all-time revenue RPC must stay below 4s, got ${revenue.elapsedMs.toFixed(1)}ms`);

  const fixture = semanticFixture();
  const oldGroups = buildCustomerGroups(fixture).groups;
  assert.equal(oldGroups.length, 535, "the independent front-end oracle must retain the reviewed 535-group result");
  const values = fixture.map((row) => `(${[
    quote(row.id), quote(row.name), quote(row.phone), quote(row.phone_mainland), quote(row.email), quote(row.address),
    quote(row.parent_id), `${quote(JSON.stringify(row.merge_exclude))}::jsonb`
  ].join(",")})`).join(",\n");
  sql(`
    TRUNCATE public.customers;
    INSERT INTO public.customers(id,name,phone,phone_mainland,email,address,parent_id,merge_exclude) VALUES
    ${values};
  `);
  const sqlGroups = Number(asAuthenticated("SELECT public.bizflow_customer_group_count();"));
  assert.equal(sqlGroups, oldGroups.length, "SQL grouping must match the independent legacy JS oracle (535=535)");

  console.log(`DATA-phase1 PG: PASS (authenticated group ${group.elapsedMs.toFixed(1)}ms, Home ${home.elapsedMs.toFixed(1)}ms, revenue ${revenue.elapsedMs.toFixed(1)}ms, parity ${oldGroups.length}=${sqlGroups})`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "-m", "immediate", "stop"], { encoding: "utf8" });
  rmSync(probeRoot, { recursive: true, force: true });
}
