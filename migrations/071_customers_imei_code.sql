-- 071_customers_imei_code.sql
-- Store DC Adaptor Pro IMEI identifiers on customer records.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS imei_code text;
