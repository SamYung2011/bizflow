-- Minimal local RLS fixture, based on test-data-phase1-pg.mjs.
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
      AS $$ SELECT jsonb_build_object('email', NULLIF(current_setting('request.jwt.claim.email', true), '')) $$;
    GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated, anon;
    CREATE TABLE public.employees (
      id uuid PRIMARY KEY, user_id uuid, name text, created_at timestamptz DEFAULT now(),
      active boolean DEFAULT true, bizflow_main_access boolean DEFAULT false, is_admin boolean DEFAULT false,
      can_view_revenue boolean NOT NULL DEFAULT false, email text
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
      car_make text, car_model text, type text DEFAULT 'Regular', parent_id uuid,
      merge_exclude jsonb DEFAULT '[]'::jsonb, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.customer_devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, imei text UNIQUE,
      device_type text DEFAULT 'adapter_pro', created_at timestamptz DEFAULT now()
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
    CREATE TABLE public.wa_settings (id integer PRIMARY KEY, value text);
    CREATE TABLE public.wa_whitelist (id integer PRIMARY KEY, value text);
    CREATE TABLE public.wa_unresolved (id integer PRIMARY KEY, value text);
    INSERT INTO public.wa_settings VALUES (1, 'initial');
    INSERT INTO public.wa_whitelist VALUES (1, 'initial');
    INSERT INTO public.wa_unresolved VALUES (1, 'initial');
    ALTER TABLE public.wa_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.wa_whitelist ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.wa_unresolved ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, UPDATE ON public.wa_settings, public.wa_whitelist, public.wa_unresolved TO authenticated;

    DO $$
    DECLARE table_name text;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY['customers','customer_devices','invoices','products','inventory_stock','line_item_aliases','warranty_renewals'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
          'CREATE POLICY access ON public.%I FOR ALL TO authenticated USING (public.has_bizflow_main_access()) WITH CHECK (public.has_bizflow_main_access())',
          table_name
        );
      END LOOP;
    END $$;


ALTER TABLE public.employees ADD COLUMN role text;
ALTER TABLE public.invoices ADD COLUMN carrier text, ADD COLUMN delivered_at timestamptz;
CREATE TABLE public.warehouses (id uuid PRIMARY KEY, name text, sort_order integer);
CREATE TABLE public.shipment_events (id uuid PRIMARY KEY, invoice_id text, event_at timestamptz, description text);
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY access ON public.warehouses FOR SELECT TO authenticated USING(public.has_bizflow_main_access());
CREATE POLICY access ON public.shipment_events FOR SELECT TO authenticated USING(public.has_bizflow_main_access());
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
INSERT INTO public.employees(id,user_id,name,bizflow_main_access,can_view_revenue,role)
VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Sales One',true,true,'銷售');
INSERT INTO public.employees(id,user_id,name,bizflow_main_access,can_view_revenue)
VALUES ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','No access',false,false);
CREATE INDEX invoices_customer_bounded_idx ON public.invoices(customer_id);
CREATE INDEX devices_customer_bounded_idx ON public.customer_devices(customer_id);
