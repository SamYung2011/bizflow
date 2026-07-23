-- 097: realtime publication 补 customers + charger_leads
-- Framer webhook 服务端写表,客户端实时链漏订致新表单顾客信息不随动(orders join 打空)。
-- 2026-07-23 已在生产执行,本文件为记账+可重放。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='customers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='charger_leads') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.charger_leads;
  END IF;
END $$;
