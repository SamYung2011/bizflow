import { createClient } from "@supabase/supabase-js";
import { fetchAllTablePages } from "../../root-site/data/fetch-all-pages.js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// 全量拉取指定表（首個 GET 同時取 count，再並行分頁拉所有資料）
// secondaryOrder 默認用 id 保證跨頁穩定（同 ms 邊界去重，commit 2164502 加的）。
// 但某些表沒 id 字段（複合主鍵），調用方需顯式傳 null：
//   - task_assignees（主鍵 task_id+employee_id）
export async function fetchAllTable(table, orderCol, ascending = true, secondaryOrder = "id") {
  return fetchAllTablePages({ client: supabase, table, orderCol, ascending, secondaryOrder });
}
