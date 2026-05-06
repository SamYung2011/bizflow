-- migration 019: 物流追踪
-- 给 invoices 加 6 字段 + 新建 shipment_events 轨迹表
-- 部署：在自托管 Supabase SQL Editor 整段跑

BEGIN;

-- 1. invoices 加 6 字段
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS carrier TEXT DEFAULT 'SF HK',
  ADD COLUMN IF NOT EXISTS tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS shipping_status TEXT,    -- 待發貨 / 已發貨 / 在途 / 派送中 / 已簽收 / 異常
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipping_last_synced_at TIMESTAMPTZ;

-- 单号唯一索引（同一个 SF 单号不该挂在两个发票上）
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_tracking_number
  ON invoices(tracking_number)
  WHERE tracking_number IS NOT NULL;

-- 给 cron 用：快速找出「需要拉 API 的发票」
CREATE INDEX IF NOT EXISTS idx_invoices_need_tracking
  ON invoices(shipping_status, shipping_last_synced_at)
  WHERE tracking_number IS NOT NULL
    AND shipping_status NOT IN ('已簽收', '异常');

-- 2. shipment_events 轨迹表（append-only）
CREATE TABLE IF NOT EXISTS shipment_events (
  id          BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  invoice_id  TEXT REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  event_at    TIMESTAMPTZ NOT NULL,           -- 顺丰这条事件的实际时间
  location    TEXT,                           -- "深圳福田中心" / "九龙湾营业点"
  description TEXT,                           -- "已揽收" / "派送中" / "已簽收"
  op_code     TEXT,                           -- 顺丰原始 opCode（30=干线/50=派件/80=签收 等）
  raw         JSONB,                          -- 原始 API 返回，调试用
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 同一 invoice + event_at + op_code 去重，避免 cron 重复拉同一事件
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_events_dedup
  ON shipment_events(invoice_id, event_at, COALESCE(op_code, ''));

CREATE INDEX IF NOT EXISTS idx_shipment_events_invoice
  ON shipment_events(invoice_id, event_at DESC);

-- 3. RLS — 沿用 bizflow 整体「authenticated 全权」策略
ALTER TABLE shipment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipment_events_authenticated_all" ON shipment_events;
CREATE POLICY "shipment_events_authenticated_all" ON shipment_events
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- service_role 走系统 BYPASS RLS，无需额外 policy

-- 4. 自动状态切换 trigger：填了单号自动 set shipped_at + status='已發貨'
CREATE OR REPLACE FUNCTION fn_invoice_tracking_autofill()
RETURNS TRIGGER AS $$
BEGIN
  -- 首次填单号：标已發貨
  IF NEW.tracking_number IS NOT NULL
     AND (OLD.tracking_number IS NULL OR OLD.tracking_number = '')
     AND NEW.shipped_at IS NULL THEN
    NEW.shipped_at := NOW();
    IF NEW.shipping_status IS NULL OR NEW.shipping_status = '待發貨' THEN
      NEW.shipping_status := '已發貨';
    END IF;
  END IF;

  -- 狀態切到「已簽收」自動寫 delivered_at
  IF NEW.shipping_status = '已簽收'
     AND OLD.shipping_status IS DISTINCT FROM '已簽收'
     AND NEW.delivered_at IS NULL THEN
    NEW.delivered_at := NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_tracking_autofill ON invoices;
CREATE TRIGGER trg_invoice_tracking_autofill
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION fn_invoice_tracking_autofill();

COMMIT;

-- 5. employees 加发货权限字段
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS can_ship BOOLEAN NOT NULL DEFAULT false;

-- 给 admin（is_admin=true）+ 客服 hhanmna + 朝哥 lexus.cheng1994 设发货权限
UPDATE employees SET can_ship = true WHERE is_admin = true;

UPDATE employees SET can_ship = true
  WHERE user_id IN (
    SELECT id FROM auth.users
    WHERE email IN ('hhanmna@gmail.com', 'lexus.cheng1994@gmail.com')
  );

-- 验收 SQL（migration 跑完手动跑这几条，看输出对不对）：
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name='invoices' AND (column_name LIKE 'shipping%' OR column_name IN ('carrier','tracking_number','shipped_at','delivered_at'));
-- SELECT * FROM shipment_events LIMIT 1;
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'invoices'::regclass;
-- SELECT name, is_admin, can_ship FROM employees ORDER BY can_ship DESC, name;
