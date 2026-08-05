-- 101: 任務驗收方式 employee_tasks.completion_mode (批3件D)
-- 煊煊 2026-08-05 12:04 拍板逐字:「噢噢，那这样在发布任务的那个页面加上一个选项吧。可以选
-- "严格验收/宽松验收"然后放个注释说明：严格验收必须所有人全部勾选任务才会消失，宽松验收就
-- 按比例完成任务。」
--   strict = 嚴格驗收: 所有負責人全部勾選任務才會收起(只走既有全員規則)
--   ratio  = 寬鬆驗收: 按比例收起(件C: 勾完成數 ≥ max(1, round(0.8×負責人數)))
-- DEFAULT 'ratio' = 小屿默认(新任务默认寬鬆 + 存量 legacy 行全部回填寬鬆,讓 #269 清掃能收掉
-- 存量單),煊煊未修正但已頻道告知。
-- 防篡改: 083 的 prevent_task_field_hijack 觸發器對普通 assignee 只放行 status/completed_at,
-- 新列天然在白名單外;creator/公司 admin/can_edit_others 本就全字段可改——無需新觸發器/新 policy。
-- Safe to rerun.

BEGIN;

ALTER TABLE public.employee_tasks
  ADD COLUMN IF NOT EXISTS completion_mode text NOT NULL DEFAULT 'ratio';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employee_tasks_completion_mode_check'
      AND conrelid = 'public.employee_tasks'::regclass
  ) THEN
    ALTER TABLE public.employee_tasks
      ADD CONSTRAINT employee_tasks_completion_mode_check
      CHECK (completion_mode IN ('strict', 'ratio'));
  END IF;
END $$;

COMMENT ON COLUMN public.employee_tasks.completion_mode IS
  '驗收方式: strict=嚴格驗收(全員勾選才收) / ratio=寬鬆驗收(按 max(1, round(0.8×N)) 比例收, 批3件C)';

NOTIFY pgrst, 'reload schema';

COMMIT;
