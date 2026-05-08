-- migration 029: 新增銷售員工 阿潤 + 阿芳 + auth 賬號 + 綁定
-- 跑：自托管 Supabase Studio → SQL Editor 貼整段執行
-- 安全：可重跑（IF NOT EXISTS / 檢查 auth.users 是否已建）
--
-- 新增資訊：
--   阿潤 1175352733@qq.com / asdfghjkl123456 / 銷售 / must_change_password=true
--   阿芳 1937065153@qq.com / asdfghjkl123456 / 銷售 / must_change_password=true
--   role='銷售' 為將來銷售佣金功能識別用

-- ============================
-- 1. employees 表插 2 條（重跑安全：用 email 查重）
-- ============================
INSERT INTO employees (name, role, email, active, is_admin, must_change_password)
SELECT '阿潤', '銷售', '1175352733@qq.com', true, false, true
 WHERE NOT EXISTS (SELECT 1 FROM employees WHERE email = '1175352733@qq.com');

INSERT INTO employees (name, role, email, active, is_admin, must_change_password)
SELECT '阿芳', '銷售', '1937065153@qq.com', true, false, true
 WHERE NOT EXISTS (SELECT 1 FROM employees WHERE email = '1937065153@qq.com');

-- ============================
-- 2. 建 auth.users + auth.identities + 綁 employees.user_id
-- ============================
DO $$
DECLARE
  v_uid uuid;
  v_existing uuid;
  emp record;
BEGIN
  FOR emp IN
    SELECT name, email
      FROM (VALUES
        ('阿潤', '1175352733@qq.com'),
        ('阿芳', '1937065153@qq.com')
      ) AS t(name, email)
  LOOP
    -- 查或建 auth user
    SELECT id INTO v_existing FROM auth.users WHERE email = emp.email LIMIT 1;
    IF v_existing IS NOT NULL THEN
      v_uid := v_existing;
      RAISE NOTICE 'auth.users 已存在 % (uid=%)，跳過建賬號', emp.email, v_uid;
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
        emp.email,
        crypt('asdfghjkl123456', gen_salt('bf')),
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
        jsonb_build_object('sub', v_uid::text, 'email', emp.email, 'email_verified', true),
        'email',
        v_uid::text,
        now(), now(), now()
      );

      RAISE NOTICE '已建 auth.users: % (uid=%)', emp.email, v_uid;
    END IF;

    -- 綁 employees.user_id（按 email 找對應 employee 行）
    UPDATE employees
       SET user_id = v_uid,
           must_change_password = true
     WHERE email = emp.email
       AND (user_id IS NULL OR user_id IS DISTINCT FROM v_uid);

    RAISE NOTICE '已綁 employees.email=% → user_id=%', emp.email, v_uid;
  END LOOP;
END $$;
