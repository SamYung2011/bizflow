-- 2026-05-12 wa_pending_replies 加 location JSONB
-- 雲端 EPD 充電樁查詢需要：扩展傳來的 location { lat, lng, placeName, address } 存到 pending，
-- wa-ai-trigger 處理時拉 5 分鐘內最近一次 location → 查 EPD → 注入 system prompt

ALTER TABLE wa_pending_replies ADD COLUMN IF NOT EXISTS location JSONB;

CREATE INDEX IF NOT EXISTS wa_pending_location_idx ON wa_pending_replies(customer_id, received_at DESC)
  WHERE location IS NOT NULL;
