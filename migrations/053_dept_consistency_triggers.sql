-- 053: 部門一致性 trigger — 防跨公司錯配
-- 背景：migration 052 之後 employee_tasks.department_id 和 employee_departments
-- 在 DB 層沒有約束保證「部門所屬公司」跟「任務所屬公司 / 員工所屬公司」一致。
-- UI 已經 filter 死，但 hardening 一下避免後續新代碼路徑漏 filter 留隱患。
-- CHECK 不能寫 subquery，所以用 trigger 兜底。

BEGIN;

-- 1. employee_tasks：department_id 對應 dept 的 company_id 必須等於 task 的 company_id
CREATE OR REPLACE FUNCTION public.check_task_dept_company_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  dept_company uuid;
BEGIN
  IF NEW.department_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT company_id INTO dept_company FROM public.departments WHERE id = NEW.department_id;
  IF dept_company IS NULL THEN
    RAISE EXCEPTION '部門不存在: %', NEW.department_id;
  END IF;
  IF dept_company <> NEW.company_id THEN
    RAISE EXCEPTION '部門 % 屬於公司 %，與任務公司 % 不匹配', NEW.department_id, dept_company, NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_task_dept_company ON public.employee_tasks;
CREATE TRIGGER trg_check_task_dept_company
  BEFORE INSERT OR UPDATE OF company_id, department_id ON public.employee_tasks
  FOR EACH ROW EXECUTE FUNCTION public.check_task_dept_company_match();

-- 2. employee_departments：員工必須屬於該部門所在公司（employee_companies 裡有 binding）
CREATE OR REPLACE FUNCTION public.check_emp_dept_company_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  dept_company uuid;
BEGIN
  SELECT company_id INTO dept_company FROM public.departments WHERE id = NEW.department_id;
  IF dept_company IS NULL THEN
    RAISE EXCEPTION '部門不存在: %', NEW.department_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.employee_companies
    WHERE employee_id = NEW.employee_id AND company_id = dept_company
  ) THEN
    RAISE EXCEPTION '員工 % 不在公司 %（部門 % 所屬），無法加入該部門', NEW.employee_id, dept_company, NEW.department_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_emp_dept_company ON public.employee_departments;
CREATE TRIGGER trg_check_emp_dept_company
  BEFORE INSERT OR UPDATE ON public.employee_departments
  FOR EACH ROW EXECUTE FUNCTION public.check_emp_dept_company_match();

-- 3. employee_companies 解綁時，順便清掉該員工在該公司所有部門的 binding
-- （否則員工被移出公司但 employee_departments 殘留，雖然 RLS 卡住但數據不一致）
CREATE OR REPLACE FUNCTION public.cleanup_emp_depts_on_company_unbind() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.employee_departments ed
  USING public.departments d
  WHERE ed.employee_id = OLD.employee_id
    AND ed.department_id = d.id
    AND d.company_id = OLD.company_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_emp_depts ON public.employee_companies;
CREATE TRIGGER trg_cleanup_emp_depts
  AFTER DELETE ON public.employee_companies
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_emp_depts_on_company_unbind();

NOTIFY pgrst, 'reload schema';

COMMIT;
