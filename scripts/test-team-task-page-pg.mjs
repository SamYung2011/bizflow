import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationPath = join(repoRoot, "migrations/111_bizflow_team_task_page.sql");

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
const probeRoot = mkdtempSync(join(tmpdir(), "bizflow-team-task-page-"));
const dataDir = join(probeRoot, "data");
const socketDir = join(probeRoot, "socket");
mkdirSync(socketDir);
let started = false;
let passed = 0;

function run(command, args, { input = undefined, quiet = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  if (!quiet && result.stderr) process.stderr.write(result.stderr);
  return result;
}

function psqlArgs() {
  return ["-X", "-qAt", "-h", socketDir, "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
}

function sql(input) {
  return run(psql, psqlArgs(), { input, quiet: true }).stdout.trim();
}

function asUser(userId, statement) {
  return sql(`
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '${userId}';
    SET statement_timeout = '8s';
    ${statement}
  `).split("\n").filter(Boolean).at(-1);
}

function payload(userId, company = "'30000000-0000-0000-0000-000000000001'::uuid", limit = 10, detail = true) {
  return JSON.parse(asUser(userId,
    `SELECT public.bizflow_team_task_page(${company}, ${limit}, ${detail})::text;`));
}

function scenario(callback) {
  callback();
  passed += 1;
}

function compare(left, right) {
  const a = left == null ? "" : String(left);
  const b = right == null ? "" : String(right);
  return a.localeCompare(b);
}

function assertSorted(rows, keys, directions, label) {
  for (let index = 1; index < rows.length; index += 1) {
    const left = rows[index - 1];
    const right = rows[index];
    let ordering = 0;
    for (let keyIndex = 0; keyIndex < keys.length && ordering === 0; keyIndex += 1) {
      ordering = compare(left[keys[keyIndex]], right[keys[keyIndex]]) * directions[keyIndex];
    }
    assert.ok(ordering <= 0, `${label} must preserve its explicit ORDER BY at index ${index}`);
  }
}

const ADMIN_USER = "20000000-0000-0000-0000-000000000001";
const MEMBER_USER = "20000000-0000-0000-0000-000000000002";
const OTHER_USER = "20000000-0000-0000-0000-000000000003";
const ZERO_USER = "20000000-0000-0000-0000-000000000004";
const ARRAY_KEYS = [
  "tasks", "assignees", "feedbacks", "members", "departments", "employeeDepartments",
  "employeeCompanies", "roles", "companies", "taskPending", "companyJoinPending",
  "updateLogs", "updateLogComments"
];

try {
  run(initdb, ["-D", dataDir, "-A", "trust", "--no-locale", "--encoding=UTF8"], { quiet: true });
  const start = spawnSync(
    pgCtl,
    ["-D", dataDir, "-o", `-k ${socketDir} -c listen_addresses=''`, "-w", "start"],
    { cwd: repoRoot, encoding: "utf8", stdio: "ignore" }
  );
  if (start.status !== 0) throw new Error(`pg_ctl start failed (${start.status})`);
  started = true;

  sql(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

    CREATE TABLE public.companies (
      id uuid PRIMARY KEY, name text, feature_ai_batch boolean DEFAULT false, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.employees (
      id uuid PRIMARY KEY, user_id uuid, name text, email text, phone text, role text,
      active boolean DEFAULT true, is_admin boolean DEFAULT false, is_super_admin boolean DEFAULT false,
      bizflow_main_access boolean DEFAULT true, can_view_revenue boolean DEFAULT false, can_ship boolean DEFAULT false,
      deactivated_at date, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.roles (
      id uuid PRIMARY KEY, company_id uuid, name text, permissions jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.employee_companies (
      id uuid PRIMARY KEY, employee_id uuid, company_id uuid, role_id uuid,
      is_company_admin boolean DEFAULT false, joined_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.departments (
      id uuid PRIMARY KEY, company_id uuid, name text, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.employee_departments (
      id uuid PRIMARY KEY, employee_id uuid, department_id uuid, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.employee_tasks (
      id uuid PRIMARY KEY, company_id uuid, department_id uuid, creator_employee_id uuid, employee_id uuid,
      title text, note text, attachments jsonb DEFAULT '[]'::jsonb, status text DEFAULT 'open',
      priority text DEFAULT 'none', due_date date, start_date date, created_at timestamptz DEFAULT now(),
      completed_at timestamptz, parent_task_id uuid, needs_approval boolean DEFAULT false,
      completion_mode text DEFAULT 'ratio', approved_at timestamptz, approved_by uuid,
      title_edited_by uuid, title_edited_at timestamptz
    );
    CREATE TABLE public.task_assignees (
      id uuid PRIMARY KEY, task_id uuid, employee_id uuid, created_at timestamptz DEFAULT now(),
      completed_at timestamptz, abandoned_at timestamptz
    );
    CREATE TABLE public.employee_task_feedbacks (
      id uuid PRIMARY KEY, task_id uuid, author_name text, author_user_id uuid, body text,
      parent_feedback_id uuid, mentioned_user_ids jsonb DEFAULT '[]'::jsonb,
      attachments jsonb DEFAULT '[]'::jsonb, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.task_pending (
      id uuid PRIMARY KEY, name text, email text, company_name text, note text,
      requested_at timestamptz, reviewed_at timestamptz, approved boolean, reject_reason text
    );
    CREATE TABLE public.company_join_pending (
      id uuid PRIMARY KEY, employee_id uuid, company_id uuid, note text,
      requested_at timestamptz, reviewed_at timestamptz, approved boolean, reject_reason text
    );
    CREATE TABLE public.team_update_logs (
      id uuid PRIMARY KEY, author_user_id uuid, summary text, detail text,
      created_at timestamptz, updated_at timestamptz
    );
    CREATE TABLE public.team_update_log_comments (
      id uuid PRIMARY KEY, update_log_id uuid, author_user_id uuid, author_name text, body text,
      parent_comment_id uuid, created_at timestamptz, updated_at timestamptz
    );

    CREATE FUNCTION public.bizflow_jsonb_array(value jsonb) RETURNS jsonb
      LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=''
      AS $$ SELECT CASE WHEN jsonb_typeof(value) = 'array' THEN value ELSE '[]'::jsonb END $$;
    CREATE FUNCTION public.is_bf_admin() RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.employees employee
        WHERE employee.user_id = auth.uid() AND employee.is_super_admin
      ) $$;
    CREATE FUNCTION public.is_member_of_company(target_company uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.employee_companies link
        JOIN public.employees employee ON employee.id = link.employee_id
        WHERE employee.user_id = auth.uid() AND link.company_id = target_company
      ) $$;
    CREATE FUNCTION public.is_member_of_department(target_department uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.employee_departments link
        JOIN public.employees employee ON employee.id = link.employee_id
        WHERE employee.user_id = auth.uid() AND link.department_id = target_department
      ) $$;
    CREATE FUNCTION public.can_select_employee(target_employee uuid, target_user uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
      AS $$ SELECT public.is_bf_admin() OR target_user = auth.uid() OR EXISTS (
        SELECT 1
        FROM public.employee_companies mine
        JOIN public.employees me ON me.id = mine.employee_id AND me.user_id = auth.uid()
        JOIN public.employee_companies theirs ON theirs.company_id = mine.company_id
        WHERE theirs.employee_id = target_employee
      ) $$;
    CREATE FUNCTION public.can_select_employee_task(
      target_company uuid, target_department uuid, target_creator uuid
    ) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
      AS $$ SELECT public.is_bf_admin() OR (
        public.is_member_of_company(target_company)
        AND (target_department IS NULL OR public.is_member_of_department(target_department))
      ) $$;
    CREATE FUNCTION public.can_select_employee_task_by_id(target_task uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.employee_tasks task
        WHERE task.id = target_task
          AND public.can_select_employee_task(task.company_id, task.department_id, task.creator_employee_id)
      ) $$;
    CREATE FUNCTION public.has_company_permission(target_company uuid, permission_key text) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
      AS $$ SELECT public.is_bf_admin() OR EXISTS (
        SELECT 1
        FROM public.employee_companies link
        JOIN public.employees employee ON employee.id = link.employee_id
        LEFT JOIN public.roles role ON role.id = link.role_id
        WHERE employee.user_id = auth.uid() AND link.company_id = target_company
          AND (link.is_company_admin OR COALESCE((role.permissions ->> permission_key)::boolean, false))
      ) $$;
    CREATE FUNCTION public.bizflow_unread_summary(
      p_company_id uuid DEFAULT NULL,
      p_tasks_read timestamptz DEFAULT NULL,
      p_orders_read timestamptz DEFAULT NULL,
      p_messages_read timestamptz DEFAULT NULL,
      p_inventory_read text DEFAULT NULL,
      p_updates_read timestamptz DEFAULT NULL
    ) RETURNS jsonb
      LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
      AS $$ SELECT jsonb_build_object(
        'unread', jsonb_build_object(
          'tasks', count(*), 'orders', 0, 'messages', 0, 'inventory', 0, 'updates', 0
        ),
        'watermarks', jsonb_build_object(
          'tasks', COALESCE(max(task.created_at)::text, ''), 'orders', '', 'messages', '', 'inventory', '', 'updates', ''
        )
      ) FROM public.employee_tasks task
      WHERE p_company_id IS NULL OR task.company_id = p_company_id $$;

    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

    ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.employee_companies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.employee_departments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.employee_tasks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.employee_task_feedbacks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.task_pending ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.company_join_pending ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.team_update_logs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.team_update_log_comments ENABLE ROW LEVEL SECURITY;

    CREATE POLICY company_read ON public.companies FOR SELECT TO authenticated
      USING (public.is_bf_admin() OR public.is_member_of_company(id));
    CREATE POLICY employee_read ON public.employees FOR SELECT TO authenticated
      USING (public.can_select_employee(id, user_id));
    CREATE POLICY role_read ON public.roles FOR SELECT TO authenticated
      USING (public.is_bf_admin() OR public.is_member_of_company(company_id));
    CREATE POLICY employee_company_read ON public.employee_companies FOR SELECT TO authenticated
      USING (public.is_bf_admin() OR public.is_member_of_company(company_id));
    CREATE POLICY department_read ON public.departments FOR SELECT TO authenticated
      USING (public.is_bf_admin() OR public.is_member_of_company(company_id));
    CREATE POLICY employee_department_read ON public.employee_departments FOR SELECT TO authenticated
      USING (public.is_bf_admin() OR EXISTS (
        SELECT 1 FROM public.departments department
        WHERE department.id = department_id AND public.is_member_of_company(department.company_id)
      ));
    CREATE POLICY task_read ON public.employee_tasks FOR SELECT TO authenticated
      USING (public.can_select_employee_task(company_id, department_id, creator_employee_id));
    CREATE POLICY assignee_read ON public.task_assignees FOR SELECT TO authenticated
      USING (public.can_select_employee_task_by_id(task_id));
    CREATE POLICY feedback_read ON public.employee_task_feedbacks FOR SELECT TO authenticated
      USING (public.can_select_employee_task_by_id(task_id));
    CREATE POLICY task_pending_read ON public.task_pending FOR SELECT TO authenticated
      USING (public.is_bf_admin());
    CREATE POLICY join_pending_read ON public.company_join_pending FOR SELECT TO authenticated
      USING (public.is_bf_admin() OR public.is_member_of_company(company_id));
    CREATE POLICY update_log_read ON public.team_update_logs FOR SELECT TO authenticated USING (true);
    CREATE POLICY update_comment_read ON public.team_update_log_comments FOR SELECT TO authenticated USING (true);
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

    INSERT INTO public.companies(id,name,feature_ai_batch,created_at) VALUES
      ('30000000-0000-0000-0000-000000000002','Beta',false,'2026-01-02'),
      ('30000000-0000-0000-0000-000000000001','Alpha',true,'2026-01-01'),
      ('30000000-0000-0000-0000-000000000003','Zero',false,'2026-01-03');
    INSERT INTO public.employees(id,user_id,name,is_super_admin,created_at) VALUES
      ('10000000-0000-0000-0000-000000000003','${OTHER_USER}','Other',false,'2026-01-03'),
      ('10000000-0000-0000-0000-000000000001','${ADMIN_USER}','Admin',true,'2026-01-01'),
      ('10000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000005','Colleague',false,'2026-01-05'),
      ('10000000-0000-0000-0000-000000000002','${MEMBER_USER}','Member',false,'2026-01-02'),
      ('10000000-0000-0000-0000-000000000004','${ZERO_USER}','Zero',false,'2026-01-04');
    INSERT INTO public.roles(id,company_id,name,permissions,created_at) VALUES
      ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Member','{}','2026-01-02'),
      ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Admin','{"can_delete_others_tasks":true}','2026-01-01'),
      ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','Beta','{}','2026-01-03');
    INSERT INTO public.employee_companies(id,employee_id,company_id,role_id,is_company_admin,joined_at) VALUES
      ('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003',false,'2026-01-03'),
      ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',true,'2026-01-01'),
      ('50000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',false,'2026-01-05'),
      ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',false,'2026-01-02'),
      ('50000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000003',NULL,false,'2026-01-04');
    INSERT INTO public.departments(id,company_id,name,created_at) VALUES
      ('60000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Hidden','2026-01-02'),
      ('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Allowed','2026-01-01'),
      ('60000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','Beta','2026-01-03');
    INSERT INTO public.employee_departments(id,employee_id,department_id,created_at) VALUES
      ('70000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','60000000-0000-0000-0000-000000000002','2026-01-02'),
      ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000001','2026-01-01');

    INSERT INTO public.employee_tasks(
      id,company_id,department_id,creator_employee_id,employee_id,title,note,attachments,status,priority,created_at,completed_at
    )
    SELECT md5('done-'||i)::uuid,'30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',
      'Done '||i,'detail '||i,'[]','done','mid',
      '2026-08-30 12:00+00'::timestamptz-(i||' minutes')::interval,
      '2026-08-31 12:00+00'::timestamptz-(i||' hours')::interval
    FROM generate_series(1,12) i;
    INSERT INTO public.employee_tasks(id,company_id,department_id,creator_employee_id,employee_id,title,note,attachments,status,priority,created_at) VALUES
      ('80000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Open allowed','full note','[{"url":"https://example.test/a"}]','open','high','2026-08-31 12:00+00'),
      ('80000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',NULL,'10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Open company','company note','{}','open','low','2026-08-31 11:00+00'),
      ('80000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','Hidden task','secret','[]','open','high','2026-08-31 10:00+00'),
      ('80000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','Other task','other','[]','open','high','2026-08-31 09:00+00');
    INSERT INTO public.task_assignees(id,task_id,employee_id,created_at) VALUES
      ('90000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','2026-08-31 11:02+00'),
      ('90000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','2026-08-31 11:01+00');
    INSERT INTO public.employee_task_feedbacks(id,task_id,author_name,body,created_at) VALUES
      ('91000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000002','Member','Second','2026-08-31 11:04+00'),
      ('91000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','Member','First','2026-08-31 11:03+00');
    INSERT INTO public.task_pending(id,name,requested_at) VALUES
      ('92000000-0000-0000-0000-000000000001','Older','2026-08-30'),
      ('92000000-0000-0000-0000-000000000002','Newer','2026-08-31');
    INSERT INTO public.company_join_pending(id,employee_id,company_id,note,requested_at) VALUES
      ('93000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Older','2026-08-30'),
      ('93000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','Newer','2026-08-31');
    INSERT INTO public.team_update_logs(id,author_user_id,summary,detail,created_at,updated_at) VALUES
      ('94000000-0000-0000-0000-000000000001','${MEMBER_USER}','Older','x','2026-08-30','2026-08-30'),
      ('94000000-0000-0000-0000-000000000002','${MEMBER_USER}','Newer','x','2026-08-31','2026-08-31');
    INSERT INTO public.team_update_log_comments(id,update_log_id,author_user_id,author_name,body,created_at,updated_at) VALUES
      ('95000000-0000-0000-0000-000000000002','94000000-0000-0000-0000-000000000002','${MEMBER_USER}','Member','Later','2026-08-31 11:02+00','2026-08-31 11:02+00'),
      ('95000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000002','${MEMBER_USER}','Member','Earlier','2026-08-31 11:01+00','2026-08-31 11:01+00');
  `);

  const policiesBefore = sql("SELECT count(*) FROM pg_policies WHERE schemaname='public';");
  run(psql, [...psqlArgs(), "-f", migrationPath], { quiet: true });
  run(psql, [...psqlArgs(), "-f", migrationPath], { quiet: true });
  const policiesAfter = sql("SELECT count(*) FROM pg_policies WHERE schemaname='public';");

  scenario(() => {
    const admin = payload(ADMIN_USER);
    assert.equal(sql("SELECT prosecdef FROM pg_proc WHERE oid='public.bizflow_team_task_page(uuid,integer,boolean)'::regprocedure;"), "f");
    assert.equal(policiesAfter, policiesBefore, "the read RPC migration must not add, alter, or remove RLS policies");
    assert.equal(sql("SELECT has_function_privilege('authenticated','public.bizflow_team_task_page(uuid,integer,boolean)','EXECUTE');"), "t");
    assert.equal(sql("SELECT has_function_privilege('anon','public.bizflow_team_task_page(uuid,integer,boolean)','EXECUTE');"), "f");
    assert.deepEqual(ARRAY_KEYS.filter((key) => !Array.isArray(admin[key])), []);
    assert.equal(admin.permissions.isBfAdmin, true);
  });

  scenario(() => {
    const member = payload(MEMBER_USER);
    assert.deepEqual(ARRAY_KEYS.filter((key) => !Array.isArray(member[key])), []);
    assert.equal(member.permissions.isBfAdmin, false);
    assert.equal(member.permissions.canDeleteOthersTasks, false);
    assert.ok(member.tasks.some((task) => task.title === "Open allowed"));
    assert.ok(member.tasks.some((task) => task.title === "Open company"));
    assert.ok(!member.tasks.some((task) => task.title === "Hidden task" || task.title === "Other task"));
  });

  scenario(() => {
    const crossCompany = payload(MEMBER_USER, "'30000000-0000-0000-0000-000000000002'::uuid");
    assert.deepEqual(crossCompany.tasks, []);
    assert.equal(crossCompany.permissions.canDeleteOthersTasks, false);
  });

  scenario(() => {
    const inferred = payload(MEMBER_USER, "NULL::uuid");
    assert.equal(inferred.currentUser.activeCompanyId, "30000000-0000-0000-0000-000000000001");
    assert.ok(inferred.tasks.some((task) => task.title === "Open allowed"));
  });

  scenario(() => {
    const emptyTenant = payload(ZERO_USER, "NULL::uuid");
    assert.ok(emptyTenant && typeof emptyTenant === "object");
    assert.equal(emptyTenant.currentUser.activeCompanyId, "30000000-0000-0000-0000-000000000003");
    assert.deepEqual(emptyTenant.tasks, []);
    assert.deepEqual(ARRAY_KEYS.filter((key) => !Array.isArray(emptyTenant[key])), []);
  });

  scenario(() => {
    const limited = payload(MEMBER_USER, undefined, 10);
    const done = limited.tasks.filter((task) => task.status === "done");
    assert.equal(done.length, 10);
    assert.deepEqual(new Set(done.map((task) => task.title)), new Set(Array.from({ length: 10 }, (_, index) => `Done ${index + 1}`)));
  });

  scenario(() => {
    const detailed = payload(MEMBER_USER, undefined, 10, true);
    const compact = payload(MEMBER_USER, undefined, 10, false);
    const detailedTask = detailed.tasks.find((task) => task.title === "Open allowed");
    const compactTask = compact.tasks.find((task) => task.title === "Open allowed");
    assert.equal(detailedTask.note, "full note");
    assert.ok(Array.isArray(detailedTask.attachments));
    assert.equal("note" in compactTask, false);
    assert.equal("attachments" in compactTask, false);
    assert.equal(compactTask.has_note, true);
    assert.equal(compactTask.attachment_count, 1);
  });

  scenario(() => {
    const compact = payload(MEMBER_USER, undefined, 10, false);
    const dirty = compact.tasks.find((task) => task.title === "Open company");
    assert.equal(dirty.attachment_count, 0);
  });

  scenario(() => {
    const denied = run(psql, psqlArgs(), {
      input: "SET ROLE anon; SELECT public.bizflow_team_task_page(NULL,10,true);",
      quiet: true,
      allowFailure: true
    });
    assert.notEqual(denied.status, 0);
    assert.match(`${denied.stdout}\n${denied.stderr}`, /permission denied for function bizflow_team_task_page/);
  });

  scenario(() => {
    const admin = payload(ADMIN_USER);
    assertSorted(admin.tasks, ["created_at", "id"], [-1, 1], "tasks");
    assertSorted(admin.assignees, ["created_at"], [1], "assignees");
    assertSorted(admin.feedbacks, ["created_at", "id"], [1, 1], "feedbacks");
    assertSorted(admin.members, ["created_at", "id"], [1, 1], "members");
    assertSorted(admin.departments, ["name", "id"], [1, 1], "departments");
    assertSorted(admin.employeeDepartments, ["created_at"], [1], "employeeDepartments");
    assertSorted(admin.employeeCompanies, ["joined_at", "id"], [1, 1], "employeeCompanies");
    assertSorted(admin.roles, ["name", "id"], [1, 1], "roles");
    assertSorted(admin.companies, ["created_at", "id"], [1, 1], "companies");
    assertSorted(admin.taskPending, ["requested_at", "id"], [-1, 1], "taskPending");
    assertSorted(admin.companyJoinPending, ["requested_at", "id"], [-1, 1], "companyJoinPending");
    assertSorted(admin.updateLogs, ["created_at", "id"], [-1, 1], "updateLogs");
    assertSorted(admin.updateLogComments, ["created_at", "id"], [1, 1], "updateLogComments");
  });

  scenario(() => {
    sql("ANALYZE;");
    const startedAt = performance.now();
    payload(ADMIN_USER);
    const elapsedMs = performance.now() - startedAt;
    assert.ok(elapsedMs < 1500, `authenticated packed task RPC must stay below 1500ms, got ${elapsedMs.toFixed(1)}ms`);
  });

  assert.equal(passed, 11);
  console.log(`TEAM_TASK_PAGE_PG=11/11 (SECURITY INVOKER/RLS, shape, scope, limit, detail, dirty JSON, anon deny, 13 sorts, <1500ms)`);
} finally {
  if (started) run(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "stop"], { quiet: true, allowFailure: true });
  rmSync(probeRoot, { recursive: true, force: true });
}
