import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationPath = join(repoRoot, "migrations/111_bizflow_team_task_page.sql");
const source036 = readFileSync(join(repoRoot, "migrations/036_employees_kind_and_pending.sql"), "utf8");
const source052 = readFileSync(join(repoRoot, "migrations/052_departments.sql"), "utf8");
const source055 = readFileSync(join(repoRoot, "migrations/055_task_pending_company_admin.sql"), "utf8");
const source082 = readFileSync(join(repoRoot, "migrations/082_team_rls_hardening.sql"), "utf8");

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

function typedRead(value, type) {
  if (!value) return `NULL::${type}`;
  return `'${String(value).replaceAll("'", "''")}'::${type}`;
}

function payload(
  userId,
  company = "'30000000-0000-0000-0000-000000000001'::uuid",
  limit = "NULL",
  detail = true,
  read = {}
) {
  return JSON.parse(asUser(userId,
    `SELECT public.bizflow_team_task_page(
      ${company}, ${limit}, ${detail},
      ${typedRead(read.tasks, "timestamptz")},
      ${typedRead(read.orders, "timestamptz")},
      ${typedRead(read.messages, "timestamptz")},
      ${typedRead(read.inventory, "text")},
      ${typedRead(read.updates, "timestamptz")}
    )::text;`));
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
      id uuid PRIMARY KEY, name text, note text, created_at timestamptz DEFAULT now(), created_by uuid,
      feature_ai_batch boolean DEFAULT false NOT NULL
    );
    CREATE TABLE public.employees (
      id uuid PRIMARY KEY, user_id uuid, name text, email text, phone text, role text, note text,
      active boolean DEFAULT true, is_admin boolean DEFAULT false, is_super_admin boolean DEFAULT false,
      must_change_password boolean DEFAULT false, show_update_log boolean DEFAULT false,
      kind text DEFAULT 'employee' NOT NULL, company_id uuid,
      bizflow_main_access boolean DEFAULT true, can_view_revenue boolean DEFAULT false, can_ship boolean DEFAULT false,
      deactivated_at timestamptz, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.roles (
      id uuid PRIMARY KEY, company_id uuid, name text, permissions jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.employee_companies (
      id uuid PRIMARY KEY, employee_id uuid, company_id uuid, role_id uuid,
      is_company_admin boolean DEFAULT false, is_default boolean DEFAULT false, joined_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.departments (
      id uuid PRIMARY KEY, company_id uuid, name text, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.employee_departments (
      employee_id uuid, department_id uuid, created_at timestamptz DEFAULT now(),
      PRIMARY KEY (employee_id, department_id)
    );
    CREATE TABLE public.employee_tasks (
      id uuid PRIMARY KEY, company_id uuid, department_id uuid, creator_employee_id uuid, employee_id uuid,
      title text, note text, attachments jsonb DEFAULT '[]'::jsonb, status text DEFAULT 'open',
      priority text DEFAULT 'none', feedback text, sort_order integer DEFAULT 0,
      due_date date, start_date date, created_at timestamptz DEFAULT now(),
      completed_at timestamptz, parent_task_id uuid, needs_approval boolean DEFAULT false,
      completion_mode text DEFAULT 'ratio', approved_at timestamptz, approved_by uuid,
      title_edited_by uuid, title_edited_at timestamptz
    );
    CREATE TABLE public.task_assignees (
      task_id uuid, employee_id uuid, created_at timestamptz DEFAULT now(),
      completed_at timestamptz, abandoned_at timestamptz, PRIMARY KEY (task_id, employee_id)
    );
    CREATE TABLE public.employee_task_feedbacks (
      id uuid PRIMARY KEY, task_id uuid, author_name text, author_user_id uuid, body text,
      parent_feedback_id uuid, mentioned_user_ids jsonb DEFAULT '[]'::jsonb,
      attachments jsonb DEFAULT '[]'::jsonb, created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.task_pending (
      id uuid PRIMARY KEY, name text, email text, company_name text, note text,
      user_id uuid, requested_at timestamptz, reviewed_at timestamptz, reviewed_by uuid,
      approved boolean, reject_reason text
    );
    CREATE TABLE public.company_join_pending (
      id uuid PRIMARY KEY, employee_id uuid, company_id uuid, note text,
      requested_at timestamptz, reviewed_at timestamptz, reviewed_by uuid,
      approved boolean, reject_reason text
    );
    CREATE TABLE public.team_update_logs (
      id uuid PRIMARY KEY, author_user_id uuid, summary text, detail text,
      created_at timestamptz, updated_at timestamptz
    );
    CREATE TABLE public.team_update_log_comments (
      id uuid PRIMARY KEY, update_log_id uuid, author_user_id uuid, author_name text, body text,
      parent_comment_id uuid, created_at timestamptz, updated_at timestamptz
    );

    CREATE FUNCTION public.bizflow_jsonb_array(input_value jsonb) RETURNS jsonb
      LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=''
      AS $$ SELECT CASE WHEN jsonb_typeof(input_value) = 'array' THEN input_value ELSE '[]'::jsonb END $$;
    CREATE FUNCTION public.current_employee_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT id FROM public.employees
        WHERE user_id = auth.uid() AND active = true LIMIT 1 $$;
    CREATE FUNCTION public.is_bf_admin() RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT COALESCE((SELECT is_super_admin FROM public.employees
        WHERE user_id = auth.uid() AND active = true LIMIT 1), false) $$;
    CREATE FUNCTION public.is_member_of_company(comp_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.employee_companies ec
        JOIN public.employees e ON e.id = ec.employee_id
        WHERE e.user_id = auth.uid() AND e.active = true AND ec.company_id = comp_id
      ) $$;
    CREATE FUNCTION public.is_admin_of_company(comp_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.employee_companies ec
        JOIN public.employees e ON e.id = ec.employee_id
        WHERE e.user_id = auth.uid() AND e.active = true AND ec.company_id = comp_id
          AND ec.is_company_admin = true
      ) $$;
    CREATE FUNCTION public.is_member_of_department(dept_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.employee_departments ed
        WHERE ed.employee_id = public.current_employee_id() AND ed.department_id = dept_id
      ) $$;
    CREATE FUNCTION public.is_admin_of_company_by_name(comp_name text) RETURNS boolean
      LANGUAGE sql STABLE
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.employee_companies ec
        JOIN public.employees e ON e.id = ec.employee_id
        JOIN public.companies co ON co.id = ec.company_id
        WHERE e.user_id = auth.uid() AND ec.is_company_admin = true
          AND lower(trim(co.name)) = lower(trim(comp_name))
      ) $$;
    CREATE FUNCTION public.can_select_employee(emp_id uuid, emp_user_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT public.is_bf_admin() OR emp_user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.employee_companies target
        JOIN public.employee_companies mine ON mine.company_id = target.company_id
        JOIN public.employees me ON me.id = mine.employee_id
        WHERE target.employee_id = emp_id AND me.user_id = auth.uid() AND me.active = true
      ) $$;
    CREATE FUNCTION public.can_select_employee_task(
      task_company_id uuid, task_department_id uuid, task_creator_employee_id uuid
    ) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT public.is_bf_admin()
        OR public.is_admin_of_company(task_company_id)
        OR task_creator_employee_id = public.current_employee_id()
        OR (public.is_member_of_company(task_company_id) AND (
          task_department_id IS NULL OR public.is_member_of_department(task_department_id)
        )) $$;
    CREATE FUNCTION public.can_select_employee_task_by_id(p_task_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.employee_tasks t
        WHERE t.id = p_task_id
          AND public.can_select_employee_task(t.company_id, t.department_id, t.creator_employee_id)
      ) $$;
    CREATE FUNCTION public.has_company_permission(comp_id uuid, permission_key text) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT public.is_bf_admin() OR public.is_admin_of_company(comp_id) OR EXISTS (
        SELECT 1 FROM public.employee_companies ec
        JOIN public.employees e ON e.id = ec.employee_id
        JOIN public.roles r ON r.id = ec.role_id
        WHERE e.user_id = auth.uid() AND e.active = true AND ec.company_id = comp_id
          AND r.company_id = comp_id AND r.permissions ->> permission_key = 'true'
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
          'tasks', count(*) FILTER (WHERE p_tasks_read IS NULL OR task.created_at > p_tasks_read),
          'orders', 0, 'messages', 0, 'inventory', 0, 'updates', 0
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

    CREATE POLICY companies_read_all ON public.companies FOR SELECT TO authenticated USING (true);
    CREATE POLICY employees_select_by_company ON public.employees FOR SELECT TO authenticated
      USING (public.can_select_employee(id, user_id));
    CREATE POLICY roles_select_by_company ON public.roles FOR SELECT TO authenticated
      USING (public.is_bf_admin() OR public.is_member_of_company(company_id));
    CREATE POLICY employee_companies_select_by_company ON public.employee_companies FOR SELECT TO authenticated
      USING (public.is_bf_admin() OR employee_id = public.current_employee_id()
        OR public.is_member_of_company(company_id));
    CREATE POLICY dept_select ON public.departments FOR SELECT TO authenticated
      USING (public.is_bf_admin() OR public.is_member_of_company(company_id));
    CREATE POLICY emp_dept_select ON public.employee_departments FOR SELECT TO authenticated
      USING (public.is_bf_admin() OR EXISTS (
        SELECT 1 FROM public.departments department
        WHERE department.id = department_id AND public.is_member_of_company(department.company_id)
      ));
    CREATE POLICY tasks_select_by_company ON public.employee_tasks FOR SELECT TO authenticated
      USING (public.can_select_employee_task(company_id, department_id, creator_employee_id));
    CREATE POLICY task_assignees_select ON public.task_assignees FOR SELECT TO authenticated
      USING (public.can_select_employee_task_by_id(task_id));
    CREATE POLICY fb_select_by_task_scope ON public.employee_task_feedbacks FOR SELECT TO authenticated
      USING (public.can_select_employee_task_by_id(task_id));
    CREATE POLICY task_pending_admin_all ON public.task_pending FOR ALL TO authenticated
      USING (public.is_bf_admin()) WITH CHECK (public.is_bf_admin());
    CREATE POLICY task_pending_anon_insert ON public.task_pending FOR INSERT TO anon
      WITH CHECK (true);
    CREATE POLICY task_pending_self_read ON public.task_pending FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
    CREATE POLICY task_pending_company_admin_select ON public.task_pending FOR SELECT TO authenticated
      USING (public.is_admin_of_company_by_name(company_name));
    CREATE POLICY task_pending_company_admin_update ON public.task_pending FOR UPDATE TO authenticated
      USING (public.is_admin_of_company_by_name(company_name))
      WITH CHECK (public.is_admin_of_company_by_name(company_name));
    CREATE POLICY company_join_pending_select ON public.company_join_pending FOR SELECT TO authenticated
      USING (public.is_bf_admin()
        OR EXISTS (SELECT 1 FROM public.employees e
          WHERE e.id = company_join_pending.employee_id AND e.user_id = auth.uid())
        OR public.is_admin_of_company(company_id));
    CREATE POLICY team_log_select_all ON public.team_update_logs FOR SELECT TO authenticated USING (true);
    CREATE POLICY team_log_comment_select_all ON public.team_update_log_comments FOR SELECT TO authenticated USING (true);
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
    INSERT INTO public.employee_departments(employee_id,department_id,created_at) VALUES
      ('10000000-0000-0000-0000-000000000005','60000000-0000-0000-0000-000000000002','2026-01-02'),
      ('10000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000001','2026-01-01');

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
    INSERT INTO public.task_assignees(task_id,employee_id,created_at) VALUES
      ('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','2026-08-31 11:02+00'),
      ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','2026-08-31 11:01+00');
    INSERT INTO public.employee_task_feedbacks(id,task_id,author_name,body,created_at) VALUES
      ('91000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000002','Member','Second','2026-08-31 11:04+00'),
      ('91000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','Member','First','2026-08-31 11:03+00');
    INSERT INTO public.task_pending(id,name,email,company_name,user_id,requested_at) VALUES
      ('92000000-0000-0000-0000-000000000001','Older','member@example.test','Alpha','${MEMBER_USER}','2026-08-30'),
      ('92000000-0000-0000-0000-000000000002','Newer','other@example.test','Beta','${OTHER_USER}','2026-08-31');
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
    const signature = "public.bizflow_team_task_page(uuid,integer,boolean,timestamptz,timestamptz,timestamptz,text,timestamptz)";
    assert.equal(sql(`SELECT prosecdef FROM pg_proc WHERE oid='${signature}'::regprocedure;`), "f");
    assert.equal(policiesAfter, policiesBefore, "the read RPC migration must not add, alter, or remove RLS policies");
    assert.equal(sql(`SELECT has_function_privilege('authenticated','${signature}','EXECUTE');`), "t");
    assert.equal(sql(`SELECT has_function_privilege('anon','${signature}','EXECUTE');`), "f");
    assert.deepEqual(ARRAY_KEYS.filter((key) => !Array.isArray(admin[key])), []);
    assert.equal(admin.permissions.isBfAdmin, true);
    assert.deepEqual(admin.taskStats, { total: 15, completed: 12, open: 3, abandoned: 0 });
  });

  scenario(() => {
    assert.match(source052,
      /CREATE OR REPLACE FUNCTION public\.is_member_of_department\(dept_id uuid\) RETURNS boolean\s+LANGUAGE sql STABLE SECURITY DEFINER AS \$\$/);
    assert.match(source055,
      /CREATE OR REPLACE FUNCTION public\.is_admin_of_company_by_name\(comp_name text\)[\s\S]*?LANGUAGE sql STABLE\s+AS \$\$/);
    assert.match(source082,
      /CREATE OR REPLACE FUNCTION public\.is_bf_admin\(\) RETURNS boolean\s+LANGUAGE sql STABLE SECURITY DEFINER\s+SET search_path = public/);
    assert.match(source036,
      /CREATE POLICY task_pending_self_read ON task_pending[\s\S]*?USING \(auth\.uid\(\) = user_id\)/);
    assert.equal(sql(`SELECT prosecdef::text || '|' || COALESCE(array_to_string(proconfig, ','), '')
      FROM pg_proc WHERE oid = 'public.is_member_of_department(uuid)'::regprocedure;`), "true|");
    assert.equal(sql(`SELECT prosecdef::text || '|' || COALESCE(array_to_string(proconfig, ','), '')
      FROM pg_proc WHERE oid = 'public.is_admin_of_company_by_name(text)'::regprocedure;`), "false|");
    assert.equal(sql(`SELECT prosecdef::text || '|' || COALESCE(array_to_string(proconfig, ','), '')
      FROM pg_proc WHERE oid = 'public.is_bf_admin()'::regprocedure;`), "true|search_path=public");
    assert.equal(sql(`SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'task_pending';`),
      "task_pending_admin_all,task_pending_anon_insert,task_pending_company_admin_select,task_pending_company_admin_update,task_pending_self_read");
    assert.deepEqual(payload(MEMBER_USER).taskPending.map((row) => row.id),
      ["92000000-0000-0000-0000-000000000001"],
      "the real self_read policy must expose only the caller's own pending row");
    assert.equal(payload(ADMIN_USER).taskPending.length, 2,
      "the real admin-all policy must expose every pending row to a BF admin");
  });

  scenario(() => {
    const member = payload(MEMBER_USER);
    assert.deepEqual(ARRAY_KEYS.filter((key) => !Array.isArray(member[key])), []);
    assert.equal(member.permissions.isBfAdmin, false);
    assert.equal(member.permissions.canDeleteOthersTasks, false);
    assert.deepEqual(member.taskStats, { total: 14, completed: 12, open: 2, abandoned: 0 });
    assert.equal(member.tasks.filter((task) => task.status === "done").length, 12,
      "the phase-one NULL limit must keep every completed row reachable");
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
    assert.deepEqual(emptyTenant.taskStats, { total: 0, completed: 0, open: 0, abandoned: 0 });
    assert.deepEqual(ARRAY_KEYS.filter((key) => !Array.isArray(emptyTenant[key])), []);
  });

  scenario(() => {
    const limited = payload(MEMBER_USER, undefined, 10);
    const done = limited.tasks.filter((task) => task.status === "done");
    assert.equal(done.length, 10);
    assert.deepEqual(limited.taskStats, { total: 14, completed: 12, open: 2, abandoned: 0 },
      "a bounded row set must retain full RLS-visible summary counts");
    assert.deepEqual(new Set(done.map((task) => task.title)), new Set(Array.from({ length: 10 }, (_, index) => `Done ${index + 1}`)));
    const unlimited = payload(MEMBER_USER, undefined, "NULL");
    assert.equal(unlimited.tasks.filter((task) => task.status === "done").length, 12,
      "p_completed_limit NULL must expose the full completed history");
    assert.deepEqual(unlimited.taskStats, limited.taskStats);
  });

  scenario(() => {
    const neverRead = payload(MEMBER_USER);
    const partiallyRead = payload(MEMBER_USER, undefined, "NULL", true, {
      tasks: "2026-08-31 10:30:00+00"
    });
    assert.equal(neverRead.unread.unread.tasks, 14);
    assert.equal(partiallyRead.unread.unread.tasks, 2,
      "a partial read watermark must count only newer visible tasks instead of the all-time total");
    assert.equal(partiallyRead.unread.watermarks.tasks, neverRead.unread.watermarks.tasks);
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

  assert.equal(passed, 13);
  console.log(`TEAM_TASK_PAGE_PG=13/13 (production helper/search_path + pending policies, INVOKER/RLS, NULL=full completed, full taskStats, partial-read exact unread, detail, dirty JSON, anon deny, 13 sorts, <1500ms)`);
} finally {
  if (started) run(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "stop"], { quiet: true, allowFailure: true });
  rmSync(probeRoot, { recursive: true, force: true });
}
