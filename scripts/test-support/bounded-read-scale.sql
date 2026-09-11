-- Synthetic cardinalities for local-only timing, not production data.
INSERT INTO customers(id,name,phone,email,address,created_at)
SELECT md5('scale-c-'||i)::uuid,'Scale '||lpad((i/2)::text,6,'0'),'scale-phone-'||(i/2),
  md5('mail-'||i)||'@example.test','Scale address '||(i/2),now()-i*interval '1 minute'
FROM generate_series(1,GREATEST(0,4312-(SELECT count(*) FROM customers)::integer))i;
INSERT INTO invoices(id,invoice_number,customer_id,date,created_at,total,status,items)
SELECT 'scale-i-'||i,'scale-no-'||i,md5('scale-c-'||(1+i%4200))::uuid,current_date-(i%500),
  now()-i*interval '1 minute',100,'Paid','[{"name":"Scale adapter","qty":1,"price":100,"warranty_months":12}]'::jsonb
FROM generate_series(1,GREATEST(0,6603-(SELECT count(*) FROM invoices)::integer))i;
ANALYZE;
