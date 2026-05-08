-- migration 028: 顺丰物流追踪 — 修 upsert 唯一约束 + 配 pg_cron 6h 拉取
-- 跑：自托管 Supabase SQL Editor 整段执行（或 docker exec psql < 此文件）
-- 安全：可重跑（IF [NOT] EXISTS / unschedule 防重）
--
-- 前置依赖（已就位）：
--   - migration 019_shipment_tracking.sql
--   - Edge Function track-shipments 已部署到 volumes/functions/
--   - .env 已配 SF_PARTNER_ID_*/SF_CHECKWORD_*/SF_API_BASE_*/SF_ENV
--   - docker-compose.yml functions 服务的 environment 已映射 SF_*

-- ============================
-- 1. 修 shipment_events 唯一索引
-- ============================
-- 老索引基于 COALESCE(op_code, '') 表达式，Supabase JS upsert 的
-- onConflict 不认表达式索引，会报「no unique or exclusion constraint matching」
-- 顺丰 EXP_RECE_SEARCH_ROUTES 的 opCode 永远有值，改成普通唯一索引

DROP INDEX IF EXISTS uq_shipment_events_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_events_dedup
  ON shipment_events(invoice_id, event_at, op_code);

-- ============================
-- 2. pg_cron job：每 6 小时拉一次
-- ============================
-- 仿 wa_ai_trigger_30s 的写法（同套 anon JWT）
-- schedule '0 */6 * * *' = 每天 0/6/12/18 点

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sf_tracking_pull_6h') THEN
    PERFORM cron.unschedule('sf_tracking_pull_6h');
  END IF;
END $$;

SELECT cron.schedule(
  'sf_tracking_pull_6h',
  '0 */6 * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://bizflow.honnmono.top/functions/v1/track-shipments',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc3NDUyMzQ5LCJleHAiOjE5MzUxMzIzNDl9.MUSPKYLYD74rvqogokIpPcBEldA_RTbNBbMeDW_AZxs"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);

-- 验收
-- SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'sf_%';
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'shipment_events';
