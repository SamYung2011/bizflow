import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// 全量拉取指定表（HEAD 先取 count，再並行分頁拉所有資料）
// secondaryOrder 默認用 id 保證跨頁穩定（同 ms 邊界去重，commit 2164502 加的）。
// 但某些表沒 id 字段（複合主鍵），調用方需顯式傳 null：
//   - task_assignees（主鍵 task_id+employee_id）
export async function fetchAllTable(table, orderCol, ascending = true, secondaryOrder = "id") {
  const size = 1000;
  const { count, error: cErr } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (cErr) throw new Error(`${table} count: ${cErr.message || cErr}`);
  const totalPages = Math.max(1, Math.ceil((count || 0) / size));
  const pagePromises = [];
  for (let i = 0; i < totalPages; i++) {
    const from = i * size;
    let q = supabase.from(table).select("*").range(from, from + size - 1);
    if (orderCol) q = q.order(orderCol, { ascending });
    if (secondaryOrder) q = q.order(secondaryOrder, { ascending: true });
    pagePromises.push(q);
  }
  const results = await Promise.all(pagePromises);
  const seen = new Set();
  const all = [];
  for (const r of results) {
    if (r.error) throw new Error(`${table}: ${r.error.message || r.error}`);
    if (!r.data) continue;
    for (const row of r.data) {
      if (row?.id != null) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
      }
      all.push(row);
    }
  }
  return all;
}
