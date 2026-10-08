-- migration 125: 阿潤 / 阿芳 開 bizflow 主站權限（使用者 2026-10-08 12:11 拍「開主站權限吧」）
-- 目的：兩位銷售要用 Honnmono APP 頁的 設備解綁 / APP客服 / APP北上 / APP車保（流量卡分頁另改碼）
-- 生產庫已於 2026-10-08 12:1x 用 psql 直接執行同一句；本檔為留痕，可重跑（已是 true 則 0 行）。
UPDATE public.employees
   SET bizflow_main_access = true
 WHERE email IN ('1175352733@qq.com', '1937065153@qq.com')
   AND kind = 'employee'
   AND active
   AND NOT bizflow_main_access;
