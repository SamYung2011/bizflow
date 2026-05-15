-- 049: 刪除廢棄的 inventory 表
-- 背景：早期單品序列號式庫存（per-serial 一行），被 inventory_stock + inventory_movements 替代。
-- 0 行數據 + 代碼 0 處引用 + 煊煊 2026-05-15 確認可刪。
-- inventory 表只引用 customers / invoices / products（出方向 FK），無被引用，DROP 不影響別的表。

BEGIN;
DROP TABLE IF EXISTS public.inventory;
COMMIT;
