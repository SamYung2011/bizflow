import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { buildCustomerGroups } from "../root-site/data/customer-groups.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationPath = join(repoRoot, "migrations/102_bizflow_data_phase1.sql");
const guardMigrationPath = join(repoRoot, "migrations/103_guard_non_array_invoice_items.sql");
const repairMigrationPath = join(repoRoot, "migrations/104_bizflow_data_phase1_r5.sql");
const patchMigrationPath = join(repoRoot, "migrations/105_bizflow_warranty_revenue_gate.sql");
const homeRevenueGateMigrationPath = join(repoRoot, "migrations/106_bizflow_home_revenue_gate.sql");
const homeSalesGateMigrationPath = join(repoRoot, "migrations/107_bizflow_home_sales_gate.sql");

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
  return asAuthenticatedUser('20000000-0000-0000-0000-000000000001', statement);
}

function asAuthenticatedUser(userId, statement) {
  return sql(`
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '${userId}';
    SET statement_timeout = '8s';
    ${statement}
  `).split("\n").filter(Boolean).at(-1);
}

function timedAuthenticated(statement) {
  const startedAt = performance.now();
  const value = asAuthenticated(statement);
  return { value, elapsedMs: performance.now() - startedAt };
}

function explainAuthenticated(statement) {
  return JSON.parse(sql(`
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
    SET statement_timeout = '8s';
    EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FORMAT JSON) ${statement}
  `));
}

function activeFunctionBody(signature) {
  const definition = sql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`);
  const marker = "AS $function$";
  const start = definition.indexOf(marker);
  const end = definition.lastIndexOf("$function$");
  assert.ok(start >= 0 && end > start, `could not extract active SQL body for ${signature}`);
  return definition.slice(start + marker.length, end).trim();
}

function explainOrderPage({ search = "NULL::text", offset = 0, limit = 50 } = {}) {
  let body = activeFunctionBody("public.bizflow_order_page(text,text,text,date,date,text,integer,integer)");
  const replacements = new Map([
    ["p_search", search], ["p_source", "NULL::text"], ["p_shipping", "NULL::text"],
    ["p_date_from", "NULL::date"], ["p_date_to", "NULL::date"], ["p_sort", "'newest'::text"],
    ["p_offset", `${offset}::integer`], ["p_limit", `${limit}::integer`]
  ]);
  for (const [parameter, value] of replacements) {
    body = body.replace(new RegExp(`\\b${parameter}\\b`, "g"), value);
  }
  return explainAuthenticated(body);
}

function planNodes(value, nodes = []) {
  if (Array.isArray(value)) value.forEach((entry) => planNodes(entry, nodes));
  else if (value && typeof value === "object") {
    if (value["Node Type"]) nodes.push(value);
    Object.values(value).forEach((entry) => planNodes(entry, nodes));
  }
  return nodes;
}

function assertPageBoundedJsonExpansion(plan, limit) {
  const expansions = planNodes(plan).filter((node) =>
    node["Node Type"] === "Function Scan" && JSON.stringify(node).includes("jsonb_array_elements")
  );
  assert.ok(expansions.length >= 2,
    `the order plan must expose both selected-page JSON expansions, got ${JSON.stringify(plan)}`);
  for (const node of expansions) {
    assert.ok(Number(node["Actual Loops"]) <= limit,
      `jsonb_array_elements must run at most once per selected row (${node["Actual Loops"]} > ${limit})`);
  }
  return Math.max(...expansions.map((node) => Number(node["Actual Loops"])));
}

function expectAuthenticatedTimeout(statement) {
  const startedAt = performance.now();
  const result = spawnSync(psql, psqlArgs(), {
    cwd: repoRoot,
    encoding: "utf8",
    input: `
      SET ROLE authenticated;
      SET request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
      SET statement_timeout = '8s';
      ${statement}
    `,
    maxBuffer: 64 * 1024 * 1024
  });
  const elapsedMs = performance.now() - startedAt;
  assert.notEqual(result.status, 0,
    `the authenticated 8s statement-timeout control must be cut off; it finished in ${elapsedMs.toFixed(1)}ms`);
  assert.match(`${result.stdout}\n${result.stderr}`, /canceling statement due to statement timeout/,
    "the negative performance control must be killed by PostgreSQL statement_timeout");
}

function customerId(index) {
  return `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
}

const ECMASCRIPT_TRIM_CHARS = [
  "\u0009", "\u000A", "\u000B", "\u000C", "\u000D", "\u0020", "\u00A0", "\u1680",
  "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007",
  "\u2008", "\u2009", "\u200A", "\u2028", "\u2029", "\u202F", "\u205F", "\u3000", "\uFEFF"
];

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

  ECMASCRIPT_TRIM_CHARS.forEach((whitespace, offset) => {
    const cleanName = `Whitespace ${offset}`;
    const cleanPhone = `852-ws-${offset}`;
    const cleanMainland = `86-ws-${offset}`;
    rows.push({
      id: customerId(600 + offset * 2),
      name: `${whitespace}${cleanName}${whitespace}`,
      phone: `${whitespace}${cleanPhone}${whitespace}`,
      phone_mainland: `${whitespace}${cleanMainland}${whitespace}`,
      email: `ws-left-${offset}@example.test`, address: `WS left ${offset}`, parent_id: null, merge_exclude: []
    }, {
      id: customerId(601 + offset * 2),
      name: cleanName, phone: cleanPhone, phone_mainland: cleanMainland,
      email: `ws-right-${offset}@example.test`, address: `WS right ${offset}`, parent_id: null, merge_exclude: []
    });
  });
  rows.push({
    id: customerId(700), name: "CRLF list", phone: "852-crlf\r\n852-other", phone_mainland: "86-crlf",
    email: "crlf-left@example.test", address: "CRLF left", parent_id: null, merge_exclude: []
  }, {
    id: customerId(701), name: "CRLF list", phone: "852-crlf", phone_mainland: "86-crlf",
    email: "crlf-right@example.test", address: "CRLF right", parent_id: null, merge_exclude: []
  });

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

function customerValues(rows) {
  return rows.map((row) => `(${[
    quote(row.id), quote(row.name), quote(row.phone), quote(row.phone_mainland), quote(row.email), quote(row.address),
    quote(row.parent_id), `${quote(JSON.stringify(row.merge_exclude))}::jsonb`
  ].join(",")})`).join(",\n");
}

function normalizedPartition(groups) {
  return groups.map((group) => group.cids.map(String).sort()).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  );
}

const migrationSql = readFileSync(migrationPath, "utf8");
const groupFunctionSql = migrationSql.slice(
  migrationSql.indexOf("CREATE OR REPLACE FUNCTION public.bizflow_customer_group_count"),
  migrationSql.indexOf("REVOKE ALL ON FUNCTION public.bizflow_edit_distance_one")
);
const groupWithSql = groupFunctionSql.slice(
  groupFunctionSql.indexOf("WITH RECURSIVE"),
  groupFunctionSql.lastIndexOf("  SELECT\n    (SELECT count(*) FROM normalized)")
).trimEnd();
assert.ok(groupWithSql.startsWith("WITH RECURSIVE") && groupWithSql.endsWith(")"),
  "the partition parity probe must reuse the production grouping CTE verbatim");
const sqlPartitionQuery = `
  ${groupWithSql}, resolved AS (
    SELECT normalized.id,COALESCE(components.component,normalized.id::text) AS component
    FROM normalized LEFT JOIN components ON components.node=normalized.id
  ), grouped AS (
    SELECT jsonb_agg(id::text ORDER BY id::text) AS members FROM resolved GROUP BY component
  )
  SELECT COALESCE(jsonb_agg(members ORDER BY members::text),'[]'::jsonb)::text FROM grouped;
`;

function reseedCustomers(insertSql) {
  sql(`TRUNCATE public.customers; ${insertSql}; ANALYZE public.customers;`);
}

function seedScaleBook(size) {
  reseedCustomers(`
    INSERT INTO public.customers(id,name,phone,phone_mainland,email,address)
    SELECT md5('scale-'||i)::uuid,
      CASE WHEN i<=5 THEN 'Duplicate Five' ELSE 'Scale Customer '||i END,
      CASE WHEN i<=5 THEN '852-scale-five' ELSE '852-scale-'||i END,
      CASE WHEN i<=5 THEN '86-scale-five' ELSE '86-scale-'||i END,
      'scale-'||i||'@example.test','Scale Address '||i
    FROM generate_series(1,${size}) AS i
  `);
}

function seedDirtyBook() {
  reseedCustomers(`
    INSERT INTO public.customers(id,name,phone,phone_mainland,email,address)
    SELECT md5('dirty-'||i)::uuid,
      CASE WHEN i<=150 THEN
        CASE i%3 WHEN 0 THEN chr(9)||'Dirty Group '||((i-1)/3) WHEN 1 THEN 'Dirty Group '||((i-1)/3)||chr(12288) ELSE chr(160)||'Dirty Group '||((i-1)/3)||chr(160) END
        ELSE 'Dirty Customer '||i END,
      CASE WHEN i<=150 THEN
        CASE i%3 WHEN 0 THEN chr(13)||'852-dirty-'||((i-1)/3) WHEN 1 THEN '852-dirty-'||((i-1)/3)||chr(8239) ELSE chr(65279)||'852-dirty-'||((i-1)/3) END
        ELSE '852-dirty-'||i END,
      CASE WHEN i<=150 THEN '86-dirty-'||((i-1)/3) ELSE '86-dirty-'||i END,
      'dirty-'||i||'@example.test',
      CASE WHEN i<=450 THEN 'Shared HK store address' ELSE 'Dirty Address '||i END
    FROM generate_series(1,4500) AS i
  `);
}

function seedLargeClusters() {
  reseedCustomers(`
    INSERT INTO public.customers(id,name,phone,phone_mainland,email,address)
    SELECT md5('cluster-'||i)::uuid,
      CASE WHEN i<=4000 THEN 'Unique '||i WHEN i<=4300 THEN '300-name-cluster' ELSE 'Phone Member '||i END,
      CASE WHEN i<=4300 THEN '852-cluster-'||i ELSE '852-200-cluster' END,
      '86-cluster-'||i,
      CASE WHEN i<=4000 THEN 'cluster-'||i||'@example.test' WHEN i<=4300 THEN 'name-cluster@example.test' ELSE 'phone-cluster@example.test' END,
      CASE WHEN i<=4000 THEN 'Cluster Address '||i WHEN i<=4300 THEN '300 Name Cluster Address' ELSE '200 Phone Cluster Address' END
    FROM generate_series(1,4500) AS i
  `);
}

try {
  run(initdb, ["-D", dataDir, "-A", "trust", "--no-locale", "--encoding=UTF8"], { quiet: true });
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
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
    CREATE TABLE public.employees (
      id uuid PRIMARY KEY, user_id uuid, name text, created_at timestamptz DEFAULT now(),
      active boolean DEFAULT true, bizflow_main_access boolean DEFAULT false, is_admin boolean DEFAULT false,
      can_view_revenue boolean NOT NULL DEFAULT false
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

    INSERT INTO public.employees(id,user_id,name,bizflow_main_access,can_view_revenue)
      VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','KC',true,true);
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
    INSERT INTO public.invoices(id,invoice_number,customer_id,salesperson_id,date,created_at,total,status,notes,shipping_status,items)
    SELECT 'invoice-'||i, i::text, md5('customer-'||(((i-1)%4500)+1))::uuid,
           '10000000-0000-0000-0000-000000000001', current_date-(i%365), now()-(i||' minutes')::interval,
           100+(i%1000), CASE WHEN i%5=0 THEN 'Unpaid' ELSE 'Paid' END,
           CASE WHEN i%3=0 THEN '__FORMS_BUY__:lead Shopify order #'||i||' financial=paid | customer note '||i
                WHEN i%3=1 THEN '__BROADWAY__:batch batch='||i||' idx=1 | warehouse note '||i
                ELSE 'manual note '||i END,
           CASE WHEN i%4=0 THEN '簽收' ELSE 'unshipped' END,
           jsonb_build_array(
             jsonb_build_object(
               'name','Product '||(((i-1)%100)+1),
               'product_id',(md5('product-'||(((i-1)%100)+1))::uuid)::text,
               'qty',1,'price',100+(i%100),'warranty_months',12,
               'shopify_payload',jsonb_build_object(
                 'properties',jsonb_build_array(
                   jsonb_build_object('name','engraving','value',(
                     SELECT string_agg(md5('fat-a-'||i||'-'||part), '') FROM generate_series(1,48) AS part
                   )),
                   jsonb_build_object('name','checkout','value',(
                     SELECT string_agg(md5('fat-b-'||i||'-'||part), '') FROM generate_series(1,48) AS part
                   ))
                 ),
                 'nested',jsonb_build_object('raw',(
                   SELECT string_agg(md5('fat-c-'||i||'-'||part), '') FROM generate_series(1,32) AS part
                 ))
               )
             ),
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
  run(psql, psqlArgs(["-f", guardMigrationPath]), { quiet: true });
  run(psql, psqlArgs(["-f", guardMigrationPath]), { quiet: true });
  assert.equal(sql("SELECT count(*) FROM pg_indexes WHERE indexname LIKE 'invoices_order_page_%';"), "0",
    "migration reruns must remove all five R1 staging indexes");
  sql("ANALYZE;");
  assert.ok(Number(sql("SELECT min(octet_length(items::text)) FROM public.invoices;")) >= 2048,
    "the performance fixture must contain at least 2KB of nested Shopify JSON per invoice");
  assert.ok(Number(sql("SELECT min(pg_column_size(items)) FROM public.invoices;")) >= 2048,
    "the production-shape JSON must stay physically fat after TOAST compression");
  // A real over-budget statement proves the same authenticated connection used
  // by the measurements is actually governed by PostgreSQL's 8s cutoff.
  expectAuthenticatedTimeout("SELECT pg_sleep(9);");
  const preR5OrderPage = JSON.parse(asAuthenticated(
    "SELECT public.bizflow_order_page(NULL,NULL,NULL,NULL,NULL,'newest',0,50)::text;"
  ));
  const preR5OrderSearch = JSON.parse(asAuthenticated(
    "SELECT public.bizflow_order_page('Product 1',NULL,NULL,NULL,NULL,'newest',50,50)::text;"
  ));
  const preR5Home = JSON.parse(asAuthenticated(
    "SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')::text;"
  ));
  run(psql, psqlArgs(["-f", repairMigrationPath]), { quiet: true });
  run(psql, psqlArgs(["-f", repairMigrationPath]), { quiet: true });
  sql("ANALYZE;");
  const postR5OrderPage = JSON.parse(asAuthenticated(
    "SELECT public.bizflow_order_page(NULL,NULL,NULL,NULL,NULL,'newest',0,50)::text;"
  ));
  const postR5OrderSearch = JSON.parse(asAuthenticated(
    "SELECT public.bizflow_order_page('Product 1',NULL,NULL,NULL,NULL,'newest',50,50)::text;"
  ));
  const postR5Home = JSON.parse(asAuthenticated(
    "SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')::text;"
  ));
  assert.deepEqual(postR5OrderPage, preR5OrderPage,
    "the narrow R5 order plan must preserve the reviewed page payload exactly");
  assert.deepEqual(postR5OrderSearch, preR5OrderSearch,
    "the narrow R5 order plan must preserve backend item-search and second-page semantics exactly");
  delete preR5Home.generated_at;
  delete postR5Home.generated_at;
  delete preR5Home.counts.warranty;
  delete postR5Home.counts.warranty;
  delete preR5Home.warranty_items;
  delete postR5Home.warranty_items;
  assert.deepEqual(postR5Home, preR5Home,
    "the materialized Home plan must preserve every non-warranty metric and bounded widget");
  const prePatchRevenue = JSON.parse(asAuthenticated("SELECT public.bizflow_order_revenue('all')::text;"));
  const prePatchHome = JSON.parse(asAuthenticated(
    "SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')::text;"
  ));
  run(psql, psqlArgs(["-f", patchMigrationPath]), { quiet: true });
  run(psql, psqlArgs(["-f", patchMigrationPath]), { quiet: true });
  sql("ANALYZE;");
  const postPatchRevenue = JSON.parse(asAuthenticated("SELECT public.bizflow_order_revenue('all')::text;"));
  const postPatchHome = JSON.parse(asAuthenticated(
    "SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')::text;"
  ));
  delete prePatchHome.generated_at;
  delete postPatchHome.generated_at;
  assert.deepEqual(postPatchRevenue, prePatchRevenue,
    "a revenue-authorized employee must receive the byte-equivalent reviewed aggregate after migration 105");
  assert.deepEqual(postPatchHome, prePatchHome,
    "migration 105 must preserve Home output when no dirty product-name whitespace is present");
  assert.equal(asAuthenticated("SELECT current_user;"), "authenticated", "performance gates must execute as authenticated");
  assert.equal(sql("SELECT prosecdef FROM pg_proc WHERE oid='public.bizflow_order_revenue(text)'::regprocedure;"), "f",
    "the revenue permission gate must remain SECURITY INVOKER");
  assert.equal(sql("SELECT has_function_privilege('anon','public.bizflow_jsonb_array(jsonb)','EXECUTE');"), "f");
  assert.equal(sql("SELECT has_function_privilege('authenticated','public.bizflow_jsonb_array(jsonb)','EXECUTE');"), "t");
  assert.equal(sql("SELECT has_function_privilege('anon','public.bizflow_customer_group_map()','EXECUTE');"), "f");
  assert.equal(sql("SELECT has_function_privilege('authenticated','public.bizflow_customer_group_map()','EXECUTE');"), "t");
  assert.equal(sql("SELECT prosecdef FROM pg_proc WHERE oid='public.bizflow_customer_group_map()'::regprocedure;"), "f",
    "the customer-group map must remain SECURITY INVOKER");
  assert.equal(sql("SELECT has_function_privilege('anon','public.bizflow_invoice_item_search(jsonb)','EXECUTE');"), "f");
  assert.equal(sql("SELECT has_function_privilege('authenticated','public.bizflow_invoice_item_search(jsonb)','EXECUTE');"), "t");
  assert.equal(sql("SELECT has_function_privilege('service_role','public.bizflow_invoice_item_search(jsonb)','EXECUTE');"), "t",
    "server-side invoice writes must be able to maintain the generated search projection");

  const group = timedAuthenticated("SELECT public.bizflow_customer_group_count();");
  assert.equal(Number(group.value), 4496, "a five-person duplicate cluster must collapse without counting 450 shared addresses");
  assert.ok(group.elapsedMs < 1000, `authenticated customer grouping must stay below 1s, got ${group.elapsedMs.toFixed(1)}ms`);

  const home = timedAuthenticated("SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')->'counts'->>'customers';");
  assert.equal(Number(home.value), 4496);
  assert.ok(home.elapsedMs < 1000, `authenticated Home RPC must stay below 1s, got ${home.elapsedMs.toFixed(1)}ms`);

  const orderPage = timedAuthenticated("SELECT public.bizflow_order_page(NULL,NULL,NULL,NULL,NULL,'newest',0,50)->>'total_count';");
  assert.equal(Number(orderPage.value), 6603);
  assert.ok(orderPage.elapsedMs < 300,
    `ANALYZE'd authenticated production-shape order page must stay below 300ms, got ${orderPage.elapsedMs.toFixed(1)}ms`);
  const firstPageExpansionLoops = assertPageBoundedJsonExpansion(explainOrderPage(), 50);
  const laterPage = timedAuthenticated("SELECT public.bizflow_order_page(NULL,NULL,NULL,NULL,NULL,'newest',3250,50)->>'total_count';");
  assert.equal(Number(laterPage.value), 6603);
  assert.ok(laterPage.elapsedMs < 300,
    `ANALYZE'd authenticated later order page must stay below 300ms, got ${laterPage.elapsedMs.toFixed(1)}ms`);
  const orderSearch = timedAuthenticated("SELECT public.bizflow_order_page('Product 1',NULL,NULL,NULL,NULL,'newest',50,50)->>'total_count';");
  assert.ok(Number(orderSearch.value) > 0);
  assert.ok(orderSearch.elapsedMs < 375,
    `ANALYZE'd authenticated product search must stay below 375ms, got ${orderSearch.elapsedMs.toFixed(1)}ms`);
  const searchExpansionLoops = assertPageBoundedJsonExpansion(explainOrderPage({
    search: "'Product 1'::text", offset: 50
  }), 50);
  const unread = timedAuthenticated(`
    SELECT public.bizflow_unread_summary(NULL::uuid,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::text,NULL::timestamptz)
      ->'unread'->>'orders';
  `);
  assert.equal(Number(unread.value), 6603);
  assert.ok(unread.elapsedMs < 100,
    `ANALYZE'd authenticated unread summary must stay below 100ms, got ${unread.elapsedMs.toFixed(1)}ms`);
  const orderPayloadBytes = Number(asAuthenticated(
    "SELECT octet_length(public.bizflow_order_page(NULL,NULL,NULL,NULL,NULL,'newest',0,50)::text);"
  ));
  const rawInvoiceItemBytes = Number(asAuthenticated("SELECT sum(octet_length(items::text)) FROM public.invoices;"));
  assert.ok(orderPayloadBytes < 100000, `the 50-row payload must stay page-sized, got ${orderPayloadBytes} bytes`);
  assert.ok(rawInvoiceItemBytes > orderPayloadBytes * 100,
    `the paged response must be at least 100x smaller than the raw invoice JSON (${rawInvoiceItemBytes}/${orderPayloadBytes})`);

  const cappedOffset = JSON.parse(asAuthenticated("SELECT public.bizflow_order_page(NULL,NULL,NULL,NULL,NULL,'newest',2147483647,50)::text;"));
  assert.equal(cappedOffset.total_count, 6603);
  assert.deepEqual(cappedOffset.rows, [], "an oversized offset must be capped safely and return no phantom page rows");

  const revenue = timedAuthenticated("SELECT public.bizflow_order_revenue('all')->>'paid_count';");
  assert.equal(Number(revenue.value), 5283);
  assert.ok(revenue.elapsedMs < 4000, `authenticated all-time revenue RPC must stay below 4s, got ${revenue.elapsedMs.toFixed(1)}ms`);

  const preLimitMutationPlan = explainAuthenticated(`
    WITH expanded AS MATERIALIZED (
      SELECT invoice.id, first_line.value AS first_value, second_line.value AS second_value
      FROM public.invoices AS invoice
      LEFT JOIN LATERAL (
        SELECT line.value
        FROM jsonb_array_elements(public.bizflow_jsonb_array(invoice.items)) WITH ORDINALITY AS line(value, position)
        ORDER BY line.position LIMIT 1
      ) AS first_line ON true
      LEFT JOIN LATERAL (
        SELECT line.value
        FROM jsonb_array_elements(public.bizflow_jsonb_array(invoice.items)) WITH ORDINALITY AS line(value, position)
        ORDER BY line.position OFFSET 1 LIMIT 1
      ) AS second_line ON true
      WHERE invoice.items IS NOT NULL AND invoice.date IS NOT NULL
    ), page AS (
      SELECT * FROM expanded ORDER BY id LIMIT 50
    )
    SELECT count(first_value) + count(second_value) FROM page;
  `);
  const preLimitMutationLoops = Math.max(...planNodes(preLimitMutationPlan)
    .filter((node) => node["Node Type"] === "Function Scan" && JSON.stringify(node).includes("jsonb_array_elements"))
    .map((node) => Number(node["Actual Loops"])));
  assert.throws(() => assertPageBoundedJsonExpansion(preLimitMutationPlan, 50), /at most once per selected row/,
    "M-A must turn the EXPLAIN shape gate red when JSON expansion moves before LIMIT");

  run(psql, psqlArgs(["-f", migrationPath]), { quiet: true });
  run(psql, psqlArgs(["-f", guardMigrationPath]), { quiet: true });
  sql("ANALYZE;");
  const revertedR5Plan = explainOrderPage();
  const revertedR5Loops = Math.max(...planNodes(revertedR5Plan)
    .filter((node) => node["Node Type"] === "Function Scan" && JSON.stringify(node).includes("jsonb_array_elements"))
    .map((node) => Number(node["Actual Loops"])));
  assert.throws(() => assertPageBoundedJsonExpansion(revertedR5Plan, 50), /at most once per selected row/,
    "M-A2 must turn the gate red when migration 103's production-failing order function is restored");
  run(psql, psqlArgs(["-f", repairMigrationPath]), { quiet: true });
  run(psql, psqlArgs(["-f", repairMigrationPath]), { quiet: true });
  run(psql, psqlArgs(["-f", patchMigrationPath]), { quiet: true });
  run(psql, psqlArgs(["-f", patchMigrationPath]), { quiet: true });
  sql("ANALYZE;");
  assertPageBoundedJsonExpansion(explainOrderPage(), 50);

  sql(`
    INSERT INTO public.invoices(id,invoice_number,customer_id,salesperson_id,date,created_at,total,status,shipping_status,items) VALUES
      ('literal-search','literal-search',md5('customer-1')::uuid,'10000000-0000-0000-0000-000000000001',current_date,now(),100,'Paid','unshipped',
        jsonb_build_array(jsonb_build_object('name','Percent% Und_score Back\\slash','qty',1)));
  `);
  assert.equal(Number(asAuthenticated("SELECT public.bizflow_order_page('%',NULL,NULL,NULL,NULL,'newest',0,50)->>'total_count';")), 1,
    "percent must remain a literal search character");
  assert.equal(Number(asAuthenticated("SELECT public.bizflow_order_page('Und_score',NULL,NULL,NULL,NULL,'newest',0,50)->>'total_count';")), 1,
    "underscore must remain a literal search character");
  assert.equal(Number(asAuthenticated("SELECT public.bizflow_order_page('UndXscore',NULL,NULL,NULL,NULL,'newest',0,50)->>'total_count';")), 0,
    "underscore must not act as a one-character wildcard");
  assert.equal(Number(asAuthenticated("SELECT public.bizflow_order_page(E'Back\\\\slash',NULL,NULL,NULL,NULL,'newest',0,50)->>'total_count';")), 1,
    "backslash must remain a literal search character");
  sql(`
    UPDATE public.invoices
    SET items=jsonb_build_array(jsonb_build_object('name','Projection Updated','qty',1))
    WHERE id='literal-search';
  `);
  assert.equal(Number(asAuthenticated("SELECT public.bizflow_order_page('Projection Updated',NULL,NULL,NULL,NULL,'newest',0,50)->>'total_count';")), 1,
    "invoice writes must refresh the generated item-name search projection");
  assert.equal(Number(asAuthenticated("SELECT public.bizflow_order_page('Und_score',NULL,NULL,NULL,NULL,'newest',0,50)->>'total_count';")), 0);
  sql("DELETE FROM public.invoices WHERE id='literal-search';");

  const helperShapes = JSON.parse(asAuthenticated(`
    SELECT jsonb_build_array(
      public.bizflow_jsonb_array('[1]'::jsonb),
      public.bizflow_jsonb_array('"legacy string"'::jsonb),
      public.bizflow_jsonb_array('{"name":"legacy object"}'::jsonb),
      public.bizflow_jsonb_array('null'::jsonb),
      public.bizflow_jsonb_array(NULL::jsonb)
    )::text;
  `));
  assert.deepEqual(helperShapes, [[1], [], [], [], []],
    "the guard must preserve arrays and treat string, object, JSON null, and SQL null as empty arrays");

  const cleanRevenue = JSON.parse(asAuthenticated("SELECT public.bizflow_order_revenue('all')::text;"));
  const cleanHome = JSON.parse(asAuthenticated("SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')::text;"));
  const cleanWarrantyCount = Number(asAuthenticated("SELECT count(*) FROM public.bizflow_warranty_rows;"));
  sql(`
    INSERT INTO public.employees(id,user_id,name,bizflow_main_access)
      VALUES ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Second BizFlow user',true);
    INSERT INTO public.invoices(id,invoice_number,customer_id,salesperson_id,date,created_at,total,status,shipping_status,items)
      VALUES (
        'orphan-warranty','orphan-warranty',NULL,'10000000-0000-0000-0000-000000000001',current_date-1,now(),100,'Paid','unshipped',
        jsonb_build_array(jsonb_build_object(
          'name','Product 1','product_id',(md5('product-1')::uuid)::text,'qty',1,'price',100,'warranty_months',12
        ))
      );
    ANALYZE public.invoices, public.employees;
  `);
  const orphanHome = JSON.parse(asAuthenticated(
    "SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')::text;"
  ));
  const authorizedHomeRevenueBeforeGate = asAuthenticated(
    "SELECT (public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')->'revenue')::text;"
  );
  const deniedHomeBeforeGate = JSON.parse(asAuthenticatedUser(
    '20000000-0000-0000-0000-000000000002',
    "SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')::text;"
  ));
  assert.deepEqual(deniedHomeBeforeGate.revenue, orphanHome.revenue,
    "the migration-105 pre-state must reproduce the Home revenue leak for an otherwise authorized employee");
  assert.ok(Number(deniedHomeBeforeGate.revenue.total_revenue) > 0,
    "the negative fixture must contain real monthly revenue before migration 106");

  run(psql, psqlArgs(["-f", homeRevenueGateMigrationPath]), { quiet: true });
  run(psql, psqlArgs(["-f", homeRevenueGateMigrationPath]), { quiet: true });
  sql("ANALYZE;");

  const authorizedHomeAfterGate = JSON.parse(asAuthenticated(
    "SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')::text;"
  ));
  const authorizedHomeRevenueAfterGate = asAuthenticated(
    "SELECT (public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')->'revenue')::text;"
  );
  const deniedHomeAfterGate = JSON.parse(asAuthenticatedUser(
    '20000000-0000-0000-0000-000000000002',
    "SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')::text;"
  ));
  const { generated_at: authorizedBeforeGeneratedAt, ...authorizedHomeBeforeStable } = orphanHome;
  const { generated_at: authorizedAfterGeneratedAt, ...authorizedHomeAfterStable } = authorizedHomeAfterGate;
  assert.equal(authorizedHomeRevenueAfterGate, authorizedHomeRevenueBeforeGate,
    "a revenue-authorized employee must receive byte-identical Home revenue JSON after migration 106");
  assert.deepEqual(authorizedHomeAfterStable, authorizedHomeBeforeStable,
    "migration 106 must preserve every Home field for a revenue-authorized employee");
  assert.deepEqual(deniedHomeAfterGate.revenue, {
    total_revenue: 0,
    paid_count: 0,
    average: 0,
    unpaid_count: 0,
    unpaid_amount: 0
  }, "an employee without revenue permission must receive the stable all-zero Home revenue object");
  const { generated_at: deniedBeforeGeneratedAt, revenue: deniedRevenueBeforeGate, ...deniedHomeBeforeStable } = deniedHomeBeforeGate;
  const { generated_at: deniedAfterGeneratedAt, revenue: deniedRevenueAfterGate, ...deniedHomeAfterStable } = deniedHomeAfterGate;
  assert.deepEqual(deniedHomeAfterStable, deniedHomeBeforeStable,
    "migration 106 must leave every non-revenue Home field unchanged for a denied employee");
  assert.equal(sql("SELECT prosecdef FROM pg_proc WHERE oid='public.bizflow_home_dashboard(uuid)'::regprocedure;"), "f",
    "the Home revenue permission gate must remain SECURITY INVOKER");
  assert.equal(sql("SELECT has_function_privilege('anon','public.bizflow_home_dashboard(uuid)','EXECUTE');"), "f");
  assert.equal(sql("SELECT has_function_privilege('authenticated','public.bizflow_home_dashboard(uuid)','EXECUTE');"), "t");

  assert.ok(Number(deniedHomeAfterGate.counts.orders) > 0,
    "the migration-106 pre-state must reproduce the denied Home order-count leak");
  assert.ok(deniedHomeAfterGate.chart.length > 0,
    "the migration-106 pre-state must reproduce the denied Home sales-chart leak");
  const authorizedHomeBeforeSalesGate = asAuthenticated(
    "SELECT (public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001') - 'generated_at')::text;"
  );
  const deniedHomeNonSalesBeforeGate = asAuthenticatedUser(
    '20000000-0000-0000-0000-000000000002',
    "SELECT ((public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001') - 'generated_at' - 'chart') #- '{counts,orders}')::text;"
  );

  run(psql, psqlArgs(["-f", homeSalesGateMigrationPath]), { quiet: true });
  run(psql, psqlArgs(["-f", homeSalesGateMigrationPath]), { quiet: true });
  sql("ANALYZE;");

  const authorizedHomeAfterSalesGate = JSON.parse(asAuthenticated(
    "SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')::text;"
  ));
  const authorizedHomeAfterSalesGateStable = asAuthenticated(
    "SELECT (public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001') - 'generated_at')::text;"
  );
  const deniedHomeAfterSalesGate = JSON.parse(asAuthenticatedUser(
    '20000000-0000-0000-0000-000000000002',
    "SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')::text;"
  ));
  const deniedHomeNonSalesAfterGate = asAuthenticatedUser(
    '20000000-0000-0000-0000-000000000002',
    "SELECT ((public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001') - 'generated_at' - 'chart') #- '{counts,orders}')::text;"
  );
  assert.equal(authorizedHomeAfterSalesGateStable, authorizedHomeBeforeSalesGate,
    "a revenue-authorized employee must receive byte-identical stable Home JSON after migration 107");
  assert.equal(deniedHomeAfterSalesGate.counts.orders, 0,
    "a denied employee must receive a zero Home order count");
  assert.deepEqual(deniedHomeAfterSalesGate.chart, [],
    "a denied employee must receive an empty Home sales chart");
  assert.deepEqual(deniedHomeAfterSalesGate.revenue, deniedHomeAfterGate.revenue,
    "migration 107 must retain migration 106's denied all-zero revenue object");
  assert.equal(deniedHomeNonSalesAfterGate, deniedHomeNonSalesBeforeGate,
    "migration 107 must preserve every denied Home field outside chart and counts.orders byte-for-byte");

  const secondUserWarranty = Number(asAuthenticatedUser(
    '20000000-0000-0000-0000-000000000002',
    "SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')->'counts'->>'warranty';"
  ));
  const authorizedRevenueWithOrphan = JSON.parse(asAuthenticated(
    "SELECT public.bizflow_order_revenue('all')::text;"
  ));
  const deniedUserOrderCount = Number(asAuthenticatedUser(
    '20000000-0000-0000-0000-000000000002',
    "SELECT public.bizflow_order_page(NULL,NULL,NULL,NULL,NULL,'newest',0,50)->>'total_count';"
  ));
  const deniedRevenue = JSON.parse(asAuthenticatedUser(
    '20000000-0000-0000-0000-000000000002',
    "SELECT public.bizflow_order_revenue('all')::text;"
  ));
  assert.ok(deniedUserOrderCount > 0,
    "the negative revenue case must retain ordinary BizFlow/RLS invoice visibility");
  assert.deepEqual(deniedRevenue, {
    total_revenue: 0,
    paid_count: 0,
    average: 0,
    unpaid_count: 0,
    unpaid_amount: 0,
    months: [],
    products: [],
    customers: [],
    single_month: false
  }, "a BizFlow employee without can_view_revenue must receive only the stable empty/zero revenue shape");
  sql("UPDATE public.employees SET is_admin=true WHERE user_id='20000000-0000-0000-0000-000000000002';");
  const adminHomeRevenue = asAuthenticatedUser(
    '20000000-0000-0000-0000-000000000002',
    "SELECT (public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')->'revenue')::text;"
  );
  const adminHomeSales = JSON.parse(asAuthenticatedUser(
    '20000000-0000-0000-0000-000000000002',
    "SELECT jsonb_build_object('orders', public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')->'counts'->'orders', 'chart', public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')->'chart')::text;"
  ));
  assert.equal(adminHomeRevenue, authorizedHomeRevenueAfterGate,
    "is_admin alone must retain the unchanged Home revenue payload");
  assert.deepEqual(adminHomeSales, {
    orders: authorizedHomeAfterSalesGate.counts.orders,
    chart: authorizedHomeAfterSalesGate.chart
  }, "is_admin alone must retain the unchanged Home sales signals");
  sql("UPDATE public.employees SET is_admin=false, can_view_revenue=true WHERE user_id='20000000-0000-0000-0000-000000000002';");
  const newlyAuthorizedRevenue = JSON.parse(asAuthenticatedUser(
    '20000000-0000-0000-0000-000000000002',
    "SELECT public.bizflow_order_revenue('all')::text;"
  ));
  const newlyAuthorizedHomeRevenue = asAuthenticatedUser(
    '20000000-0000-0000-0000-000000000002',
    "SELECT (public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')->'revenue')::text;"
  );
  const newlyAuthorizedHomeSales = JSON.parse(asAuthenticatedUser(
    '20000000-0000-0000-0000-000000000002',
    "SELECT jsonb_build_object('orders', public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')->'counts'->'orders', 'chart', public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')->'chart')::text;"
  ));
  assert.deepEqual(newlyAuthorizedRevenue, authorizedRevenueWithOrphan,
    "the same employee must receive the unchanged aggregate immediately after can_view_revenue is granted");
  assert.equal(newlyAuthorizedHomeRevenue, authorizedHomeRevenueAfterGate,
    "can_view_revenue alone must retain the unchanged Home revenue payload");
  assert.deepEqual(newlyAuthorizedHomeSales, {
    orders: authorizedHomeAfterSalesGate.counts.orders,
    chart: authorizedHomeAfterSalesGate.chart
  }, "can_view_revenue alone must retain the unchanged Home sales signals");
  assert.equal(orphanHome.counts.orders, cleanHome.counts.orders + 1,
    "an orphan invoice remains a valid order");
  assert.equal(orphanHome.counts.warranty, cleanHome.counts.warranty,
    "the warranty KPI must match the legacy known-customer scope and exclude orphan Shopify invoices");
  assert.equal(secondUserWarranty, cleanHome.counts.warranty,
    "BizFlow-authorized accounts must see the same warranty KPI regardless of company selection context");
  sql("DELETE FROM public.invoices WHERE id='orphan-warranty'; DELETE FROM public.employees WHERE id='10000000-0000-0000-0000-000000000002'; ANALYZE public.invoices, public.employees;");
  sql(`
    INSERT INTO public.customers(id,name,phone,parent_id) VALUES
      ('40000000-0000-0000-0000-000000000001','Alpha One','852-1',NULL),
      ('40000000-0000-0000-0000-000000000002','Alpha Child','852-2','40000000-0000-0000-0000-000000000001'),
      ('40000000-0000-0000-0000-000000000003','Missing Parent Child','852-3','40000000-0000-0000-0000-000000000099'),
      ('40000000-0000-0000-0000-000000000004','Empty Months','852-4',NULL),
      ('40000000-0000-0000-0000-000000000005','By Id Null','852-5',NULL);
    INSERT INTO public.products(id,name,warranty_months,status) VALUES
      ('50000000-0000-0000-0000-000000000000','Serial Product',12,'active'),
      ('50000000-0000-0000-0000-000000000001','Serial Product',NULL,'active');
    INSERT INTO public.invoices(id,invoice_number,customer_id,salesperson_id,date,created_at,total,status,shipping_status,items) VALUES
      ('warranty-group-primary','wg-primary','40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',(current_date-interval '12 months')::date,now()+interval '4 seconds',100,'Paid','unshipped',
        jsonb_build_array(jsonb_build_object('name','Product 1','product_id',(md5('product-1')::uuid)::text,'qty',1))),
      ('warranty-missing-parent','wg-missing','40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',(current_date-interval '12 months')::date,now()+interval '3 seconds',100,'Paid','unshipped',
        jsonb_build_array(jsonb_build_object('name','Product 1','product_id',(md5('product-1')::uuid)::text,'qty',1))),
      ('warranty-empty-months','wg-empty','40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001',(current_date-interval '12 months')::date,now()+interval '2 seconds',100,'Paid','unshipped',
        jsonb_build_array(jsonb_build_object('name','Product 1','product_id',(md5('product-1')::uuid)::text,'qty',1,'warranty_months',''))),
      ('warranty-by-id-null','wg-by-id','40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001',(current_date-interval '12 months')::date,now()+interval '1 second',100,'Paid','unshipped',
        jsonb_build_array(jsonb_build_object('name','Serial Product','product_id','50000000-0000-0000-0000-000000000001','qty',1)));
    ANALYZE public.customers, public.products, public.invoices;
  `);
  const warrantyEdgeHome = JSON.parse(asAuthenticated(
    "SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')::text;"
  ));
  assert.equal(warrantyEdgeHome.counts.warranty, cleanHome.counts.warranty + 1,
    "only the valid physical child may add a warranty row; missing parent, empty months, and by-id NULL stay excluded");
  const primaryWarranty = warrantyEdgeHome.warranty_items.find((row) => row.no === '#wg-primary');
  assert.deepEqual(primaryWarranty && { customer: primaryWarranty.customer, phone: primaryWarranty.phone },
    { customer: 'Alpha One', phone: '852-1' },
    "warranty cards must display the legacy customer-group primary name and phone");
  const mappedChildren = JSON.parse(asAuthenticated(`
    SELECT COALESCE(jsonb_agg(to_jsonb(mapping) ORDER BY member_id),'[]'::jsonb)::text
    FROM public.bizflow_customer_group_map() AS mapping
    WHERE member_id IN (
      '40000000-0000-0000-0000-000000000002'::uuid,
      '40000000-0000-0000-0000-000000000003'::uuid
    );
  `));
  assert.equal(mappedChildren.length, 1, "a physical child whose parent is missing must not enter the legacy group map");
  assert.equal(mappedChildren[0].primary_id, '40000000-0000-0000-0000-000000000001');
  sql(`
    DELETE FROM public.invoices WHERE id LIKE 'warranty-%';
    DELETE FROM public.products WHERE id IN ('50000000-0000-0000-0000-000000000000','50000000-0000-0000-0000-000000000001');
    DELETE FROM public.customers WHERE id::text LIKE '40000000-0000-0000-0000-%';
    ANALYZE public.customers, public.products, public.invoices;
  `);
  sql(`
    INSERT INTO public.invoices(id,invoice_number,customer_id,salesperson_id,date,created_at,total,status,shipping_status,items) VALUES
      ('dirty-items-string','dirty-string',md5('customer-1')::uuid,'10000000-0000-0000-0000-000000000001',current_date,now()+interval '3 seconds',101,'Paid','unshipped','"legacy string"'::jsonb),
      ('dirty-items-object','dirty-object',md5('customer-2')::uuid,'10000000-0000-0000-0000-000000000001',current_date,now()+interval '2 seconds',102,'Paid','unshipped','{"name":"legacy object"}'::jsonb),
      ('dirty-items-null','dirty-null',md5('customer-3')::uuid,'10000000-0000-0000-0000-000000000001',current_date,now()+interval '1 second',103,'Paid','unshipped','null'::jsonb);
    ANALYZE public.invoices;
  `);

  const dirtyOrderRows = JSON.parse(asAuthenticated(`
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'first',first_item,'second',second_item) ORDER BY id),'[]'::jsonb)::text
    FROM public.bizflow_order_list WHERE id LIKE 'dirty-items-%';
  `));
  assert.equal(dirtyOrderRows.length, 3);
  assert.ok(dirtyOrderRows.every((row) => row.first === null && row.second === null),
    "string, object, and JSON-null items must render as invoices with no line-item previews");

  const dirtyPage = JSON.parse(asAuthenticated("SELECT public.bizflow_order_page('dirty-items',NULL,NULL,NULL,NULL,'newest',0,50)::text;"));
  assert.equal(dirtyPage.total_count, 3);
  assert.deepEqual(dirtyPage.rows.map((row) => row.id).sort(), ['dirty-items-null','dirty-items-object','dirty-items-string']);
  assert.ok(dirtyPage.rows.every((row) => row.first_item === null && row.second_item === null));

  const dirtyRevenue = JSON.parse(asAuthenticated("SELECT public.bizflow_order_revenue('all')::text;"));
  assert.equal(dirtyRevenue.paid_count, cleanRevenue.paid_count + 3);
  assert.equal(dirtyRevenue.total_revenue, cleanRevenue.total_revenue + 306);
  assert.deepEqual(dirtyRevenue.products, cleanRevenue.products,
    "non-array items must still count invoice totals but contribute no product lines");
  assert.equal(Number(asAuthenticated("SELECT count(*) FROM public.bizflow_warranty_rows;")), cleanWarrantyCount,
    "non-array items must contribute no warranty lines");

  const dirtyHome = JSON.parse(asAuthenticated("SELECT public.bizflow_home_dashboard('30000000-0000-0000-0000-000000000001')::text;"));
  assert.equal(dirtyHome.counts.orders, cleanHome.counts.orders + 3);
  assert.equal(dirtyHome.revenue.paid_count, cleanHome.revenue.paid_count + 3);
  assert.equal(dirtyHome.revenue.total_revenue, cleanHome.revenue.total_revenue + 306);
  assert.deepEqual(dirtyHome.chart, cleanHome.chart,
    "non-array items must leave the Home item chart unchanged");
  const dirtyHomeOrders = dirtyHome.orders.filter((row) => ['#dirty-string','#dirty-object','#dirty-null'].includes(row.no));
  assert.equal(dirtyHomeOrders.length, 3);
  assert.ok(dirtyHomeOrders.every((row) => row.product === '—'),
    "Home recent orders must show no product for non-array items");

  const fixture = semanticFixture();
  const oldGroups = buildCustomerGroups(fixture).groups;
  assert.equal(oldGroups.length, 561,
    "the independent front-end oracle must retain the reviewed base groups plus every ECMAScript whitespace pair");
  reseedCustomers(`
    INSERT INTO public.customers(id,name,phone,phone_mainland,email,address,parent_id,merge_exclude) VALUES
    ${customerValues(fixture)}
  `);
  const sqlGroups = Number(asAuthenticated("SELECT public.bizflow_customer_group_count();"));
  assert.equal(sqlGroups, oldGroups.length, "SQL grouping must match the independent legacy JS oracle with dirty whitespace");
  const sqlPartition = normalizedPartition(JSON.parse(asAuthenticated(sqlPartitionQuery)).map((cids) => ({ cids })));
  assert.deepEqual(sqlPartition, normalizedPartition(oldGroups),
    "SQL grouping must match the independent legacy JS oracle group-by-group, not only by count");
  const fixtureById = new Map(fixture.map((row) => [String(row.id), row]));
  const customerIdsInLegacyFetchOrder = JSON.parse(asAuthenticated(
    "SELECT jsonb_agg(id::text ORDER BY name ASC NULLS LAST,id)::text FROM public.customers;"
  ));
  const legacyGrouping = buildCustomerGroups(customerIdsInLegacyFetchOrder.map((id) => fixtureById.get(id)));
  const sqlGroupMap = JSON.parse(asAuthenticated(`
    SELECT COALESCE(jsonb_agg(jsonb_build_array(member_id::text,primary_id::text) ORDER BY member_id),'[]'::jsonb)::text
    FROM public.bizflow_customer_group_map();
  `));
  const legacyGroupMap = [...legacyGrouping.idToGroup.entries()]
    .map(([memberId, primaryId]) => [String(memberId), String(primaryId)])
    .sort((left, right) => left[0].localeCompare(right[0]));
  assert.deepEqual(sqlGroupMap, legacyGroupMap,
    "the Home warranty membership/primary map must match the legacy JS grouper exactly");

  seedDirtyBook();
  const dirty = timedAuthenticated("SELECT public.bizflow_customer_group_count();");
  assert.equal(Number(dirty.value), 4400, "50 dirty three-person groups must each collapse to one group");
  assert.ok(dirty.elapsedMs < 1500,
    `ANALYZE'd dirty customer book must stay below 1.5s, got ${dirty.elapsedMs.toFixed(1)}ms`);

  seedLargeClusters();
  const largeClusters = timedAuthenticated("SELECT public.bizflow_customer_group_count();");
  assert.equal(Number(largeClusters.value), 4002, "the 300-name and 200-phone clusters must each collapse to one group");
  assert.ok(largeClusters.elapsedMs < 1500,
    `ANALYZE'd 300+200 large-cluster book must stay below 1.5s, got ${largeClusters.elapsedMs.toFixed(1)}ms`);

  const scale = [];
  for (const size of [255, 505, 1005, 2005, 3005, 4500]) {
    seedScaleBook(size);
    const measurement = timedAuthenticated("SELECT public.bizflow_customer_group_count();");
    assert.equal(Number(measurement.value), size - 4, `scale fixture ${size} must collapse only its five-person group`);
    assert.ok(measurement.elapsedMs < 1500,
      `ANALYZE'd authenticated scale fixture ${size} must stay below 1.5s, got ${measurement.elapsedMs.toFixed(1)}ms`);
    scale.push({ size, elapsedMs: measurement.elapsedMs });
  }
  const scale2005 = scale.find((entry) => entry.size === 2005);
  const scale4500 = scale.find((entry) => entry.size === 4500);
  assert.ok(scale4500.elapsedMs < scale2005.elapsedMs * 3.5,
    `255→4500 curve must stay far below quadratic growth: ${JSON.stringify(scale)}`);

  // Replay the reviewer's exact 34-invoice adversarial set. These expected
  // per-invoice row counts were produced independently by the legacy JS
  // buildWarrantySnapshot path; querying the active Home CTE catches parity
  // changes without copying the SQL under test into the oracle.
  sql(`
-- R8 adversarial warranty set: 12+ edge categories, old JS vs SQL@104
TRUNCATE public.invoices, public.customers, public.products, public.warranty_renewals, public.inventory_stock;

INSERT INTO public.customers(id,name,phone,phone_mainland,email,address,parent_id,merge_exclude) VALUES
 -- merge group: Alpha One is primary (name sorts first), Alpha Two merges by name+phone+mainland
 ('a0000000-0000-0000-0000-000000000001','Alpha One','852-1','86-1','a1@t','Addr A',NULL,'[]'),
 ('a0000000-0000-0000-0000-000000000002','Alpha One','852-1','86-1','a2@t','Addr A2',NULL,'[]'),
 -- physical child of Alpha One
 ('a0000000-0000-0000-0000-000000000003','Alpha Child','852-9','86-9','a3@t','Addr A3','a0000000-0000-0000-0000-000000000001','[]'),
 -- orphan physical child: parent_id points at a customer that does not exist
 ('a0000000-0000-0000-0000-000000000006','Orphan Child','852-6','86-6','a6@t','Addr A6','a0000000-0000-0000-0000-0000000000ff','[]'),
 -- plain customers for the rest
 ('b0000000-0000-0000-0000-000000000001','Bravo','852-b1','86-b1','b1@t','Addr B1',NULL,'[]'),
 ('b0000000-0000-0000-0000-000000000002','Charlie','852-b2','86-b2','b2@t','Addr B2',NULL,'[]'),
 -- merge_exclude pair (would otherwise merge on name+phone+mainland)
 ('c0000000-0000-0000-0000-000000000001','Excl','852-x','86-x','x1@t','Addr X1',NULL,'["c0000000-0000-0000-0000-000000000002"]'),
 ('c0000000-0000-0000-0000-000000000002','Excl','852-x','86-x','x2@t','Addr X2',NULL,'[]'),
 -- customer with empty name/phone -> display fallbacks
 ('d0000000-0000-0000-0000-000000000001','','','','d1@t','Addr D1',NULL,'[]');

INSERT INTO public.products(id,name,warranty_months,status) VALUES
 ('90000000-0000-0000-0000-000000000001','Widget',12,'active'),
 ('90000000-0000-0000-0000-000000000002','Gadget',0,'active'),
 ('90000000-0000-0000-0000-000000000003','NullMonths',NULL,'active'),
 ('90000000-0000-0000-0000-000000000004','NullMonths',12,'active'),   -- same name, months 12 (by_name twin)
 ('90000000-0000-0000-0000-000000000005','Renewable',12,'active');

-- helper: base purchase date is 12 months ago so a 12-month warranty lands ~today (inside -30/+365)
INSERT INTO public.invoices(id,invoice_number,customer_id,salesperson_id,date,created_at,total,status,shipping_status,items) VALUES
 -- adv-01 plain: product_id hit, months from product
 ('adv-01','adv-01','b0000000-0000-0000-0000-000000000001',NULL,(current_date-interval '12 months')::date,now()-interval '1 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]'),
 -- adv-02 item months override (24) -> expiry 12 months out, still inside window
 ('adv-02','adv-02','b0000000-0000-0000-0000-000000000001',NULL,(current_date-interval '12 months')::date,now()-interval '2 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1,"warranty_months":24}]'),
 -- adv-03 item months 0 -> excluded
 ('adv-03','adv-03','b0000000-0000-0000-0000-000000000001',NULL,(current_date-interval '12 months')::date,now()-interval '3 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1,"warranty_months":0}]'),
 -- adv-04 guest invoice (customer_id NULL) -> excluded
 ('adv-04','adv-04',NULL,NULL,(current_date-interval '12 months')::date,now()-interval '4 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]'),
 -- adv-05 invoice on the merged-away duplicate -> card must show GROUP PRIMARY name/phone
 ('adv-05','adv-05','a0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '5 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]'),
 -- adv-06 invoice on an orphan physical child (parent missing) -> excluded by old JS
 ('adv-06','adv-06','a0000000-0000-0000-0000-000000000006',NULL,(current_date-interval '12 months')::date,now()-interval '6 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]'),
 -- adv-07 invoice on a valid physical child -> included, mapped to parent group
 ('adv-07','adv-07','a0000000-0000-0000-0000-000000000003',NULL,(current_date-interval '12 months')::date,now()-interval '7 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]'),
 -- adv-08 no product_id, name resolves by name
 ('adv-08','adv-08','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '8 min',1,'Paid','x',
   '[{"name":"Widget","qty":1}]'),
 -- adv-09 unknown product entirely -> months 0 -> excluded
 ('adv-09','adv-09','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '9 min',1,'Paid','x',
   '[{"name":"Unknown Thing","qty":1}]'),
 -- adv-10 fee-ish names -> excluded by the name regex
 ('adv-10','adv-10','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '10 min',1,'Paid','x',
   '[{"name":"運費","product_id":"90000000-0000-0000-0000-000000000001","qty":1},{"name":"Shipping fee","product_id":"90000000-0000-0000-0000-000000000001","qty":1},{"name":"防水盒","product_id":"90000000-0000-0000-0000-000000000001","qty":1},{"name":"押金","product_id":"90000000-0000-0000-0000-000000000001","qty":1},{"name":"手續費","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]'),
 -- adv-11 warranty_months JSON null -> Number(null)=0 -> excluded
 ('adv-11','adv-11','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '11 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1,"warranty_months":null}]'),
 -- adv-12 warranty_months "" -> Number("")=0 -> excluded
 ('adv-12','adv-12','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '12 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1,"warranty_months":""}]'),
 -- adv-13 product_id resolves to a product with NULL months; same NAME also matches a 12-month twin
 ('adv-13','adv-13','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '13 min',1,'Paid','x',
   '[{"name":"NullMonths","product_id":"90000000-0000-0000-0000-000000000003","qty":1}]'),
 -- adv-14 renewal overlay
 ('adv-14','adv-14','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '14 min',1,'Paid','x',
   '[{"name":"Renewable","product_id":"90000000-0000-0000-0000-000000000005","qty":1}]'),
 -- adv-15 out of window (expiry 5 years out)
 ('adv-15','adv-15','b0000000-0000-0000-0000-000000000002',NULL,current_date::date,now()-interval '15 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1,"warranty_months":60}]'),
 -- adv-16a/16b duplicate invoice_number: older created_at wins in both engines
 ('adv-16a','adv-16','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '30 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]'),
 ('adv-16b','adv-16','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '16 min',1,'Paid','x',
   '[{"name":"Gadget","product_id":"90000000-0000-0000-0000-000000000002","qty":1,"warranty_months":12}]'),
 -- adv-17a/b/c non-array items
 ('adv-17a','adv-17a','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '17 min',1,'Paid','x','"legacy string"'),
 ('adv-17b','adv-17b','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '18 min',1,'Paid','x','{"name":"legacy object"}'),
 ('adv-17c','adv-17c','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '19 min',1,'Paid','x','null'),
 -- adv-18 numeric string months
 ('adv-18','adv-18','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '20 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1,"warranty_months":"12"}]'),
 -- adv-19 boolean true months -> JS Number(true)=1
 ('adv-19','adv-19','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '1 month')::date,now()-interval '21 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1,"warranty_months":true}]'),
 -- adv-20 fractional months "12.7"
 ('adv-20','adv-20','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '22 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1,"warranty_months":"12.7"}]'),
 -- adv-21 " - Default Title" suffix, resolved by name
 ('adv-21','adv-21','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '23 min',1,'Paid','x',
   '[{"name":"Widget - Default Title","qty":1}]'),
 -- adv-22 merge_exclude pair: two separate groups, both invoices count separately
 ('adv-22a','adv-22a','c0000000-0000-0000-0000-000000000001',NULL,(current_date-interval '12 months')::date,now()-interval '24 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]'),
 ('adv-22b','adv-22b','c0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '25 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]'),
 -- adv-23 empty item name
 ('adv-23','adv-23','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '26 min',1,'Paid','x',
   '[{"name":"","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]'),
 -- adv-24 negative months
 ('adv-24','adv-24','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '27 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1,"warranty_months":-6}]'),
 -- adv-25 months as an object -> Number({}) NaN -> asNumber falls back to product months
 ('adv-25','adv-25','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '28 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1,"warranty_months":{"a":1}}]'),
 -- adv-26 customer with empty name/phone -> card fallback text
 ('adv-26','adv-26','d0000000-0000-0000-0000-000000000001',NULL,(current_date-interval '12 months')::date,now()-interval '29 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]'),
 -- adv-27 dangling customer_id (customer row deleted)
 ('adv-27','adv-27','e0000000-0000-0000-0000-0000000000ee',NULL,(current_date-interval '12 months')::date,now()-interval '31 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]'),
 -- adv-28 date NULL -> dropped by both
 ('adv-28','adv-28','b0000000-0000-0000-0000-000000000002',NULL,NULL,now()-interval '32 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]'),
 -- adv-29 whitespace-padded product name (matches by name after trim/lower)
 ('adv-29','adv-29','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '33 min',1,'Paid','x',
   '[{"name":"  WIDGET  ","qty":1}]'),
 -- adv-30 two identical lines on one invoice -> two warranty rows
 ('adv-30','adv-30','b0000000-0000-0000-0000-000000000002',NULL,(current_date-interval '12 months')::date,now()-interval '34 min',1,'Paid','x',
   '[{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1},{"name":"Widget","product_id":"90000000-0000-0000-0000-000000000001","qty":1}]');

INSERT INTO public.warranty_renewals(id,invoice_id,product_id,months,paid_at,previous_end,new_end,created_at) VALUES
 ('f0000000-0000-0000-0000-000000000001','adv-14','90000000-0000-0000-0000-000000000005',6,current_date-1,current_date,current_date+180,now());

ANALYZE public.customers, public.invoices, public.products, public.warranty_renewals;
  `);
  let warrantyBody = activeFunctionBody("public.bizflow_home_dashboard(uuid)")
    .replace(/\bp_company_id\b/g, "NULL::uuid");
  const warrantySelectMarker = "\n  SELECT jsonb_build_object(\n    'generated_at', now(),";
  const warrantySelectOffset = warrantyBody.indexOf(warrantySelectMarker);
  assert.ok(warrantySelectOffset > 0, "the active Home function must expose its reviewed warranty CTEs");
  const warrantyCtes = warrantyBody.slice(0, warrantySelectOffset).replace(/,\s*$/, "");
  const warrantyParityRows = JSON.parse(asAuthenticated(`
    ${warrantyCtes}
    SELECT COALESCE(
      jsonb_agg(jsonb_build_array(invoice_id, product, customer, phone) ORDER BY invoice_id, position),
      '[]'::jsonb
    )::text
    FROM warranty;
  `));
  const expectedWarrantyRows = new Map([
    ["adv-01", 1], ["adv-02", 1], ["adv-03", 0], ["adv-04", 0],
    ["adv-05", 1], ["adv-06", 0], ["adv-07", 1], ["adv-08", 1],
    ["adv-09", 0], ["adv-10", 0], ["adv-11", 0], ["adv-12", 0],
    ["adv-13", 0], ["adv-14", 1], ["adv-15", 0],
    ["adv-16a", 1], ["adv-16b", 0],
    ["adv-17a", 0], ["adv-17b", 0], ["adv-17c", 0],
    ["adv-18", 1], ["adv-19", 1], ["adv-20", 1], ["adv-21", 1],
    ["adv-22a", 1], ["adv-22b", 1], ["adv-23", 0], ["adv-24", 0],
    ["adv-25", 1], ["adv-26", 1], ["adv-27", 0], ["adv-28", 0],
    ["adv-29", 1], ["adv-30", 2]
  ]);
  assert.equal(expectedWarrantyRows.size, 34, "the legacy differential oracle must retain all 34 reviewed cases");
  const actualWarrantyRows = new Map();
  for (const [invoiceId] of warrantyParityRows) {
    actualWarrantyRows.set(invoiceId, (actualWarrantyRows.get(invoiceId) || 0) + 1);
  }
  assert.deepEqual(
    [...expectedWarrantyRows].map(([invoiceId, expected]) => [invoiceId, actualWarrantyRows.get(invoiceId) || 0, expected]),
    [...expectedWarrantyRows].map(([invoiceId, expected]) => [invoiceId, expected, expected]),
    "all 34 warranty membership cases must remain row-for-row aligned with the legacy JS oracle"
  );
  const whitespaceWarranty = warrantyParityRows.find(([invoiceId]) => invoiceId === "adv-29");
  assert.deepEqual(whitespaceWarranty, ["adv-29", "  WIDGET  ", "Charlie", "852-b2"],
    "a whitespace-padded legacy item without product_id must resolve by trimmed product name");


  console.log(`DATA-phase1 PG: PASS (dirty JSON string/object/null=empty; post-ANALYZE authenticated order first/later ${orderPage.elapsedMs.toFixed(1)}/${laterPage.elapsedMs.toFixed(1)}ms, search ${orderSearch.elapsedMs.toFixed(1)}ms, unread ${unread.elapsedMs.toFixed(1)}ms, Home ${home.elapsedMs.toFixed(1)}ms, ${orderPayloadBytes}B from ${(rawInvoiceItemBytes / 1048576).toFixed(1)}MiB raw; EXPLAIN JSON loops first/search ${firstPageExpansionLoops}/${searchExpansionLoops}<=50; mutations M-A/M-A2 red at loops ${preLimitMutationLoops}/${revertedR5Loops}; flat ${group.elapsedMs.toFixed(1)}ms, dirty ${dirty.elapsedMs.toFixed(1)}ms, clusters ${largeClusters.elapsedMs.toFixed(1)}ms, revenue ${revenue.elapsedMs.toFixed(1)}ms + allow/deny gate, warranty scope ${cleanHome.counts.warranty}=${orphanHome.counts.warranty}=${secondUserWarranty}, warranty differential 34/34, parity ${oldGroups.length}=${sqlGroups} exact, scale ${scale.map(({ size, elapsedMs }) => `${size}:${elapsedMs.toFixed(1)}ms`).join("/")})`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "-m", "immediate", "stop"], { encoding: "utf8" });
  rmSync(probeRoot, { recursive: true, force: true });
}
