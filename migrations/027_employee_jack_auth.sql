-- migration 027: 新增員工 Jack 的 auth 賬號 + 綁定 employees.user_id
-- 跑：自托管 Supabase Studio → SQL Editor 貼整段執行
-- 安全：可重跑（檢查 auth.users.email 已存在則跳過建賬號，只重做綁定）
--
-- 新增資訊：
--   email:    jacklam199408@gmail.com
--   password: qwertyuiop123456
--   name:     Jack（綁到 employees.name='Jack' 那行）
--   role:     普通員工（is_admin = false 不變）
--   首次登入強制改密碼（must_change_password = true）

DO $$
DECLARE
  v_uid uuid;
  v_existing uuid;
  v_emp_count int;
BEGIN
  -- 1. 員工表必須有 Jack
  SELECT count(*) INTO v_emp_count FROM employees WHERE name = 'Jack';
  IF v_emp_count = 0 THEN
    RAISE EXCEPTION 'employees 表沒有 name=Jack 的記錄，請先在 dashboard 建好員工再跑此 migration';
  END IF;
  IF v_emp_count > 1 THEN
    RAISE EXCEPTION 'employees 表有 % 條 name=Jack，請先去重再跑', v_emp_count;
  END IF;

  -- 2. 建 auth user（已存在則復用）
  SELECT id INTO v_existing FROM auth.users WHERE email = 'jacklam199408@gmail.com' LIMIT 1;

  IF v_existing IS NOT NULL THEN
    v_uid := v_existing;
    RAISE NOTICE 'auth.users 已存在 jacklam199408@gmail.com (uid=%)，跳過建賬號', v_uid;
  ELSE
    v_uid := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_uid,
      'authenticated',
      'authenticated',
      'jacklam199408@gmail.com',
      crypt('qwertyuiop123456', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(), now(),
      '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'jacklam199408@gmail.com', 'email_verified', true),
      'email',
      v_uid::text,
      now(), now(), now()
    );

    RAISE NOTICE '已建 auth.users: jacklam199408@gmail.com (uid=%)', v_uid;
  END IF;

  -- 3. 綁定 employees.user_id + 強制首登改密
  UPDATE employees
     SET user_id = v_uid,
         must_change_password = true
   WHERE name = 'Jack'
     AND (user_id IS NULL OR user_id IS DISTINCT FROM v_uid);

  RAISE NOTICE '已綁 employees.name=Jack → user_id=%', v_uid;
END $$;
