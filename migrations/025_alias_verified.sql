-- migration 025: line_item_aliases 加 verified 字段，取代靠 note 字符判斷待校對
-- 已存在的 30 條 seed：含 "AI 推測" / "待校對" / "需處理" note 的 = 未校對；其餘 = 已校對

ALTER TABLE line_item_aliases ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT true;

-- 把當前帶 AI 推測 / 待校對 標記的設成未校對
UPDATE line_item_aliases SET verified = false
WHERE note ~ 'AI 推測|待校對';

-- 驗收：
-- SELECT verified, COUNT(*) FROM line_item_aliases GROUP BY verified;
