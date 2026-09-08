-- Extra columns and empty read tables for the real 111 RPC + 104 unread function.
-- Task-table policies and write helpers are installed by the main RLS harness.
ALTER TABLE public.companies ADD COLUMN feature_ai_batch boolean DEFAULT false,
  ADD COLUMN created_at timestamptz DEFAULT '2026-09-08';
ALTER TABLE public.employees ADD COLUMN name text DEFAULT '',
  ADD COLUMN created_at timestamptz DEFAULT '2026-09-08';
ALTER TABLE public.roles ADD COLUMN name text DEFAULT '';
ALTER TABLE public.employee_companies ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY,
  ADD COLUMN joined_at timestamptz DEFAULT '2026-09-08';
ALTER TABLE public.employee_departments ADD COLUMN created_at timestamptz DEFAULT '2026-09-08';
ALTER TABLE public.employee_tasks ADD COLUMN created_at timestamptz DEFAULT '2026-09-08',
  ADD COLUMN completed_at timestamptz, ADD COLUMN status text DEFAULT 'open',
  ADD COLUMN note text, ADD COLUMN attachments jsonb DEFAULT '[]';
ALTER TABLE public.task_assignees ADD COLUMN created_at timestamptz DEFAULT '2026-09-08';
ALTER TABLE public.employee_task_feedbacks ADD COLUMN created_at timestamptz DEFAULT '2026-09-08';
CREATE TABLE public.departments (id uuid PRIMARY KEY, company_id uuid, name text);
INSERT INTO public.departments VALUES
  ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','A-D1'),
  ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','A-D2'),
  ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','B-D1'),
  ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000002','B-D2');
CREATE TABLE public.task_pending (id uuid PRIMARY KEY, requested_at timestamptz);
CREATE TABLE public.company_join_pending (id uuid PRIMARY KEY, requested_at timestamptz);
CREATE TABLE public.team_update_logs (id uuid PRIMARY KEY, created_at timestamptz);
CREATE TABLE public.team_update_log_comments (id uuid PRIMARY KEY, created_at timestamptz);
CREATE TABLE public.invoices (id uuid PRIMARY KEY, invoice_number text, items jsonb, date date, created_at timestamptz);
CREATE TABLE public.products (id uuid PRIMARY KEY, parent_product_id uuid, status text, is_virtual boolean, category text);
CREATE TABLE public.inventory_stock (product_id uuid, qty integer);

GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY companies_read_all ON public.companies FOR SELECT TO authenticated USING (true);
-- Remaining populated metadata policies are copied from 082 / 052 by the harness.
-- Empty ancillary tables are fail-closed fixtures; their production write rules are outside this test.
ALTER TABLE public.task_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_join_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_update_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_update_log_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_stock ENABLE ROW LEVEL SECURITY;
