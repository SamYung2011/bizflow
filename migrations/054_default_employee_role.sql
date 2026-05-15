-- 054: 給沒綁職位的員工默認填「普通員工」角色
-- 背景：commit 10c153f 之後 RBAC 9 個權限點真正生效，沒綁職位 = 沒任何權限。
-- 但歷史所有 employee_companies.role_id 都是 NULL，導致非 admin 員工
-- 在 team subapp 裡連分配任務、創建任務都做不了。
-- 修：每個公司確保有「普通員工」role，然後 backfill 所有 null role_id。

BEGIN;

-- 1. 每個公司確保有「普通員工」角色（沒有就建）
--    預設權限：can_create_task + can_assign_others + can_validate_task
--    （跟 Honnmono 既有「普通員工」對齊，是「同事可互相分配任務」的最小集）
DO $$
DECLARE
  co RECORD;
  r_id uuid;
  default_perms jsonb := jsonb_build_object(
    'can_create_task', true,
    'can_assign_others', true,
    'can_edit_others_tasks', false,
    'can_delete_others_tasks', false,
    'can_validate_task', true,
    'can_manage_employees', false,
    'can_approve_registration', false,
    'can_view_commission', false,
    'can_manage_roles', false
  );
BEGIN
  FOR co IN SELECT id FROM public.companies LOOP
    SELECT id INTO r_id FROM public.roles WHERE company_id = co.id AND name = '普通員工';
    IF r_id IS NULL THEN
      INSERT INTO public.roles (company_id, name, permissions)
      VALUES (co.id, '普通員工', default_perms);
    END IF;
  END LOOP;
END $$;

-- 2. backfill：所有 role_id IS NULL 的 binding，填本公司的「普通員工」role id
UPDATE public.employee_companies ec
SET role_id = r.id
FROM public.roles r
WHERE ec.role_id IS NULL
  AND r.company_id = ec.company_id
  AND r.name = '普通員工';

-- 3. 驗收：應該 0 行
DO $$
DECLARE
  null_count integer;
BEGIN
  SELECT COUNT(*) INTO null_count FROM public.employee_companies WHERE role_id IS NULL;
  IF null_count > 0 THEN
    RAISE WARNING 'Still % bindings with NULL role_id after backfill — check companies without 普通員工 role', null_count;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
