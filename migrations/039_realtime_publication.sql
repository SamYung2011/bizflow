-- 039: 把 team 子應用要訂閱的表加進 supabase_realtime publication
-- 之前 publication 是空的，導致 supabase.channel('...').on('postgres_changes', ...) 收不到事件。
-- 加進去後前端可即時收到 INSERT/UPDATE/DELETE，配合 invalidateQueries 即時刷新（取代 5s 輪詢）。

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.employee_tasks,
  public.task_assignees,
  public.employee_task_feedbacks,
  public.employees,
  public.companies,
  public.task_pending;
