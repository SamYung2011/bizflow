import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBoundedReadPg } from './test-support/bounded-read-pg.mjs';
const pg = createBoundedReadPg(fileURLToPath(new URL('../', import.meta.url)));
const id = '6063', legacy = '30000000-0000-0000-0000-000000000102';
let count = 0;
function check(label, run) { run(); console.log(`ok ${++count} - ${label}`); }
try {
  pg.sql(`
    ALTER TABLE invoices ADD COLUMN legacy_skip_deduct boolean DEFAULT false;
    ALTER TABLE inventory_stock ADD COLUMN warehouse_id uuid REFERENCES warehouses(id), ADD COLUMN updated_at timestamptz DEFAULT now();
    CREATE UNIQUE INDEX stock_pair ON inventory_stock(product_id,warehouse_id);
    CREATE TABLE inventory_movements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid REFERENCES products(id), warehouse_id uuid REFERENCES warehouses(id), delta integer NOT NULL, type text, reason text, invoice_id text REFERENCES invoices(id) ON DELETE SET NULL);
    CREATE TABLE inventory(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), imei text, status text, customer_id uuid, sold_date date, warranty_end date, invoice_id text REFERENCES invoices(id) ON DELETE SET NULL);
    ALTER TABLE warranty_renewals ADD CONSTRAINT warranty_order_fk FOREIGN KEY(invoice_id) REFERENCES invoices(id);
    ALTER TABLE shipment_events ADD CONSTRAINT shipment_order_fk FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
    CREATE TABLE stock_deduction_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id text REFERENCES invoices(id) ON DELETE CASCADE);
    CREATE TABLE deletion_blocker(invoice_id text REFERENCES invoices(id));
    INSERT INTO products(id,name) VALUES(md5('product')::uuid,'Own test SKU');
    INSERT INTO warehouses(id,name) VALUES(md5('warehouse')::uuid,'Own test warehouse');
    INSERT INTO invoices(id,invoice_number) VALUES('${id}','129');
    INSERT INTO inventory_stock(product_id,warehouse_id,qty) VALUES(md5('product')::uuid,md5('warehouse')::uuid,2);
    INSERT INTO inventory_movements(product_id,warehouse_id,delta,type,invoice_id) VALUES(md5('product')::uuid,md5('warehouse')::uuid,-2,'sale','${id}'),(md5('product')::uuid,md5('warehouse')::uuid,-1,'sale','${id}');
    INSERT INTO inventory(imei,status,customer_id,sold_date,warranty_end,invoice_id) VALUES('123456789012345','Sold',md5('customer')::uuid,'2026-10-13','2027-10-13','${id}');
    INSERT INTO warranty_renewals(id,invoice_id) VALUES(md5('renewal')::uuid,'${id}');
    INSERT INTO shipment_events(id,invoice_id) VALUES(md5('shipment')::uuid,'${id}');
    INSERT INTO stock_deduction_audit(invoice_id) VALUES('${id}');
    INSERT INTO deletion_blocker VALUES('${id}');
  `);
  const migration = readFileSync(new URL('../migrations/129_bizflow_delete_order_20261013.sql', import.meta.url),'utf8');
  pg.sql(migration); pg.sql(migration);
  check('main access required; anon cannot execute', () => {
    assert.throws(()=>pg.asUser(`SELECT bizflow_delete_order('${id}');`,'20000000-0000-0000-0000-000000000002'),/42501/);
    assert.throws(()=>pg.sql(`SET ROLE anon; SELECT bizflow_delete_order('${id}');`),/42501/);
  });
  check('failed final deletion rolls back stock, reversal, IMEI and warranty together', () => {
    assert.throws(()=>pg.asUser(`SELECT bizflow_delete_order('${id}');`),/23503/);
    assert.equal(pg.sql('SELECT qty FROM inventory_stock;'),'2');
    assert.equal(pg.sql("SELECT count(*) FROM inventory_movements WHERE type='sale_reverse';"),'0');
    assert.equal(pg.sql("SELECT status||'|'||(invoice_id IS NOT NULL)::text FROM inventory;"),'Sold|true');
    assert.equal(pg.sql('SELECT count(*) FROM warranty_renewals;'),'1');
  });
  pg.sql('DELETE FROM deletion_blocker;');
  pg.asUser(`SELECT bizflow_delete_order('${id}');`);
  check('aggregated sale stock returned once and one reversal retained after FK nulling', () => {
    assert.equal(pg.sql('SELECT qty FROM inventory_stock;'),'5');
    assert.equal(pg.sql("SELECT reason FROM inventory_movements WHERE type='sale_reverse';"),'發票 #129 刪除返還');
    assert.equal(pg.sql("SELECT delta||'|'||(invoice_id IS NULL)::text FROM inventory_movements WHERE type='sale_reverse';"),'3|true');
  });
  check('IMEI restored, warranty removed and cascading children removed', () => {
    assert.equal(pg.sql('SELECT count(*) FROM invoices;'),'0');
    assert.equal(pg.sql("SELECT status||'|'||(customer_id IS NULL AND sold_date IS NULL AND warranty_end IS NULL AND invoice_id IS NULL)::text FROM inventory;"),'In Stock|true');
    for (const table of ['warranty_renewals','shipment_events','stock_deduction_audit']) assert.equal(pg.sql(`SELECT count(*) FROM ${table};`),'0');
  });
  check('repeat or absent deletion raises not-found without returning stock twice', () => {
    assert.throws(()=>pg.asUser(`SELECT bizflow_delete_order('${id}');`),/P0002/);
    assert.equal(pg.sql('SELECT qty FROM inventory_stock;'),'5');
  });
  check('UUID-text legacy order without deductions can be deleted directly', () => {
    pg.sql(`INSERT INTO invoices(id,legacy_skip_deduct) VALUES('${legacy}',true);`);
    pg.asUser(`SELECT bizflow_delete_order('${legacy}');`);
    assert.equal(pg.sql('SELECT count(*) FROM invoices;'),'0');
    assert.equal(pg.sql('SELECT qty FROM inventory_stock;'),'5');
  });
  check('security definer has fixed search_path and no public/anon grant', () => {
    assert.equal(pg.sql("SELECT prosecdef AND proconfig=ARRAY['search_path=public'] AND NOT has_function_privilege('anon',oid,'EXECUTE') AND has_function_privilege('authenticated',oid,'EXECUTE') FROM pg_proc WHERE oid='bizflow_delete_order(text)'::regprocedure;"),'t');
  });
  check('old uuid overload is removed and schema reload notification is included',()=>{
    assert.equal(pg.sql("SELECT to_regprocedure('bizflow_delete_order(uuid)') IS NULL;"),'t');
    assert.ok(migration.includes("NOTIFY pgrst, 'reload schema'"));
  });
  console.log(`ORDER_DELETE_PG=${count}/${count}`);
} finally { pg.close(); }
