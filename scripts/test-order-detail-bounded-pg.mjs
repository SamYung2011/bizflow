import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { createBoundedReadPg } from "./test-support/bounded-read-pg.mjs";
import * as utils from "../root-site/data/live-snapshot-utils.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const pg = createBoundedReadPg(root);
const migration = readFileSync(new URL("../migrations/121_bizflow_order_detail.sql", import.meta.url), "utf8");
const querySource = readFileSync(new URL("../root-site/data/live-orders-query.js", import.meta.url), "utf8");
const source = querySource.replace(/import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];/g, "").replace(/^export /gm, "");
const map = vm.runInNewContext(`${source}; mapDetail`, { ...utils });
const plain = (value) => JSON.parse(JSON.stringify(value));
const policies = () => pg.sql("SELECT md5(string_agg(row_to_json(p)::text, '' ORDER BY schemaname,tablename,policyname)) FROM pg_policies p;");
const read = (sql, user) => JSON.parse(pg.asUser(sql, user) || "null");
const oldPayload = (id) => read(`SELECT jsonb_build_object(
  'invoice',(SELECT to_jsonb(i) FROM invoices i WHERE id='${id}'),
  'customer',(SELECT to_jsonb(c) FROM customers c JOIN invoices i ON c.id=i.customer_id WHERE i.id='${id}'),
  'salesperson',(SELECT to_jsonb(e) FROM employees e JOIN invoices i ON e.id=i.salesperson_id WHERE i.id='${id}'),
  'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.event_at DESC),'[]') FROM (SELECT e.* FROM shipment_events e WHERE invoice_id='${id}' ORDER BY event_at DESC LIMIT 6)e),
  'devices',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC),'[]') FROM customer_devices d JOIN invoices i ON i.customer_id=d.customer_id WHERE i.id='${id}')
);`);
const mapped = (p) => plain(map(p.invoice,p.customer,p.salesperson,p.events,p.devices));
let passed = 0;
function check(label, run) { run(); passed += 1; console.log(`ok ${passed} - ${label}`); }
try {
  const beforePolicies = policies();
  pg.sql(migration); pg.sql(migration);
  pg.sql(`
    INSERT INTO customers(id,name,phone,email,address,car_make,car_model) VALUES
      (md5('one')::uuid,'One','91234567','one@example.test','Address','Brand','Model'),
      (md5('other')::uuid,'Other','90000000','other@example.test','Other','','');
    INSERT INTO invoices(id,invoice_number,customer_id,salesperson_id,date,total,status,notes,items,created_at,carrier,tracking_number)
    SELECT 'order-'||i, i::text, md5('one')::uuid, '10000000-0000-0000-0000-000000000001',current_date,777,
      CASE WHEN i%2=0 THEN 'Paid' ELSE 'Unpaid' END,
      CASE WHEN i%3=0 THEN '__FORMS_BUY__ Promo code OK' WHEN i%3=1 THEN '__BROADWAY__' ELSE 'Manual note' END,
      jsonb_build_array(jsonb_build_object('name','Adapter','qty',2,'price',300,'imei_code','123456789012345','warranty_months',12,'shopify_payload',repeat('x',100000)),
        jsonb_build_object('name','shipping','qty',1,'price',77)), now(), 'carrier','tracking' FROM generate_series(1,4)i;
    UPDATE invoices SET items='null'::jsonb, customer_id=NULL,salesperson_id=NULL WHERE id='order-4';
    INSERT INTO shipment_events(id,invoice_id,event_at,description)
      SELECT md5('event-'||i)::uuid, 'order-1',now()-i*interval '1 minute','Event '||i FROM generate_series(1,9)i;
    INSERT INTO customer_devices(id,customer_id,imei,device_type,created_at)
      SELECT md5('device-'||i)::uuid,md5('one')::uuid,lpad(i::text,15,'0'),'adapter',now()-i*interval '1 minute' FROM generate_series(1,25)i;
  `);
  check("migration idempotent and policy fingerprints unchanged", () => assert.equal(policies(),beforePolicies));
  check("STABLE SECURITY INVOKER with empty search_path", () => assert.equal(pg.sql("SELECT provolatile::text||':'||prosecdef::text||':'||proconfig::text FROM pg_proc WHERE oid='bizflow_order_detail(text)'::regprocedure;"),'s:false:{"search_path=\\"\\""}'));
  check("anon cannot execute (42501)", () => assert.throws(()=>pg.sql("SET ROLE anon; SELECT bizflow_order_detail('order-1');"), /permission denied/));
  check("non-member cannot read invoice or relations", () => assert.equal(read("SELECT bizflow_order_detail('order-1');",'20000000-0000-0000-0000-000000000002'),null));
  check("missing id returns null", () => assert.equal(read("SELECT bizflow_order_detail('missing');"),null));
  for (let i=1;i<=4;i+=1) check(`old five-read payload vs packed RPC: order-${i}`, () => {
    assert.deepEqual(mapped(read(`SELECT bizflow_order_detail('order-${i}');`)),mapped(oldPayload(`order-${i}`)));
  });
  const payload=read("SELECT bizflow_order_detail('order-1');");
  check("all 25 devices and six latest events retained", () => {assert.equal(payload.devices.length,25);assert.equal(payload.events.length,6);});
  check("irrelevant nested Shopify data is omitted without losing display fields",()=>{assert.equal(payload.invoice.items[0].shopify_payload,undefined);assert.equal(payload.invoice.items[0].imei_code,'123456789012345');assert.ok(Buffer.byteLength(JSON.stringify(payload))<100000);});
  pg.sql("CREATE POLICY hide_customer ON customers AS RESTRICTIVE FOR SELECT TO authenticated USING (name <> 'One');");
  check("related customer RLS remains effective",()=>{const p=read("SELECT bizflow_order_detail('order-1');");assert.equal(p.customer,null);assert.deepEqual(mapped(p),mapped(oldPayload('order-1')));});
  pg.sql("CREATE POLICY hide_device ON customer_devices AS RESTRICTIVE FOR SELECT TO authenticated USING (imei <> '000000000000001');");
  check("related device RLS remains effective",()=>assert.equal(read("SELECT bizflow_order_detail('order-1');").devices.length,24));
  pg.sql(readFileSync(new URL('./test-support/bounded-read-scale.sql',import.meta.url),'utf8'));
  check('4312 customers / 6603 invoices do not widen invoice payload',()=>{assert.equal(pg.sql('SELECT count(*) FROM customers;'),'4312');assert.deepEqual(mapped(read("SELECT bizflow_order_detail('order-1');")),mapped(oldPayload('order-1')));});
  const start=performance.now(); const probe=read("SELECT bizflow_order_detail('order-1');");
  console.log(JSON.stringify({localPgMs:Math.round((performance.now()-start)*100)/100,jsonBytes:Buffer.byteLength(JSON.stringify(probe)),gzipBytes:gzipSync(JSON.stringify(probe)).length}));
  console.log(`ORDER_DETAIL_BOUNDED_PG=${passed}/${passed}`);
} finally { pg.close(); }
