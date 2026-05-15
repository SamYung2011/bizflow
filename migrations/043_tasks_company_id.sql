-- 043: employee_tasks 加 company_id 顯式字段
-- 背景：合作者跨公司場景需要嚴格按任務所屬公司隔離。
-- 之前靠 getTaskCompanyId() 從 assignees 推斷，合作者多公司時推不準。
-- 改造：tasks.company_id 顯式存儲，新建時必須指定，RLS 按此過濾。

BEGIN;

-- 1. 加字段（先 nullable 方便 backfill）
ALTER TABLE public.employee_tasks
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

CREATE INDEX IF NOT EXISTS employee_tasks_company_id_idx
  ON public.employee_tasks(company_id);

-- 2. backfill：優先級 creator → 第一個 assignee → fallback Honnmono
-- 2a. creator 的 default company（employee_companies.is_default=true）
UPDATE public.employee_tasks t
SET company_id = ec.company_id
FROM public.employee_companies ec
WHERE t.company_id IS NULL
  AND ec.employee_id = t.creator_employee_id
  AND ec.is_default = true;

-- 2b. 還沒填的：取第一個 assignee 的 default company
UPDATE public.employee_tasks t
SET company_id = ec.company_id
FROM public.task_assignees ta
JOIN public.employee_companies ec ON ec.employee_id = ta.employee_id AND ec.is_default = true
WHERE t.company_id IS NULL
  AND ta.task_id = t.id;

-- 2c. 還沒填的：兜底 Honnmono
UPDATE public.employee_tasks t
SET company_id = (SELECT id FROM public.companies WHERE name = 'Honnmono' LIMIT 1)
WHERE t.company_id IS NULL;

-- 3. 改成 not null
ALTER TABLE public.employee_tasks
  ALTER COLUMN company_id SET NOT NULL;

COMMIT;

-- 驗證：按 company 分組看分佈
SELECT
  COALESCE(c.name, '(NULL)') AS company,
  COUNT(*) AS task_count
FROM public.employee_tasks t
LEFT JOIN public.companies c ON c.id = t.company_id
GROUP BY c.name
ORDER BY task_count DESC;
