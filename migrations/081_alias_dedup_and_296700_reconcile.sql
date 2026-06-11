-- 081: 2026-06-11 库存复查两项数据修复（已于当日直接 psql 执行，本文件为留档可重放）
-- 背景：煊煊报「扣库存逻辑不对劲」复查，详见 memory bizflow_inventory_deduction_fix 2026-06-11 段
-- A) alias「AC Adaptor Pro」products 数组重复挂了两条同一 SKU（2026-05-14 起），
--    人工审核期被操作员兜住未实际多扣，但 Phase 2 自动扣 / Shopify RPC 路径会 1 件扣 2 件
-- B) 发票 296700（5/22 漏扣事故单）已由 migration 073 用 adjust 补扣（无 invoice_id），
--    但待扣库存队列按「无 sale movement」判定仍列它为未扣 → 在队列里再点会双扣，标记跳过

-- A: alias 去重（幂等：仅当仍是 2 条时收敛为 1 条）
UPDATE line_item_aliases
SET products = '[{"qty": 1, "product_id": "7043a62d-d553-4bb1-b3d7-42dc9ef9a40c"}]'::jsonb,
    updated_at = now()
WHERE alias_name = 'AC Adaptor Pro'
  AND jsonb_array_length(products) = 2;

-- B: 296700 标记已补扣（幂等：已标记则跳过）
UPDATE invoices
SET legacy_skip_deduct = true,
    notes = COALESCE(notes,'') || E'\n__DEDUCT_RECONCILED__ 2026-06-11 標記：庫存已於 2026-06-01 migration 073 以 adjust 補扣，跳過待扣隊列防雙扣'
WHERE invoice_number = '296700'
  AND legacy_skip_deduct IS NOT TRUE;
