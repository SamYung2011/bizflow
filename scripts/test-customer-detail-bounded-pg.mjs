import { legacyCustomerDetails } from './test-support/legacy-customer-detail-oracle.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import { createBoundedReadPg } from "./test-support/bounded-read-pg.mjs";
import { buildCustomerGroups } from "../root-site/data/customer-groups.js";

const pg=createBoundedReadPg(fileURLToPath(new URL("../",import.meta.url)));
const migration=readFileSync(new URL("../migrations/119_bizflow_customer_detail.sql",import.meta.url),"utf8");
const read=(sql,user)=>JSON.parse(pg.asUser(sql,user)||'null');
const detail=(id,user)=>read(`SELECT bizflow_customer_detail('${id}'::uuid);`,user);
const policyFingerprint=()=>pg.sql("SELECT md5(string_agg(row_to_json(p)::text,'' ORDER BY schemaname,tablename,policyname)) FROM pg_policies p;");
let passed=0;
function check(label,run){run();console.log(`ok ${++passed} - ${label}`);}
try{
  const policies=policyFingerprint();pg.sql(migration);pg.sql(migration);
  pg.sql(`
    INSERT INTO customers(id,name,phone,email,address,car_make,car_model,created_at) VALUES
      (md5('root')::uuid,'Group','852-111','root@example.test','Address','Make A','Model A',now()-interval '100 days'),
      (md5('virtual')::uuid,'Group','852-111','root@example.tes','Address','Make B','Model B',now()-interval '99 days'),
      (md5('excluded')::uuid,'Group','852-111','root@example.test','Address','','',now()-interval '98 days'),
      (md5('name-only')::uuid,'Name only','','','','','',now());
    UPDATE customers SET merge_exclude=jsonb_build_array(md5('excluded')::uuid) WHERE id IN(md5('root')::uuid,md5('virtual')::uuid);
    INSERT INTO customers(id,name,phone,email,parent_id,created_at) VALUES
      (md5('child')::uuid,'Child','852-child','child@example.test',md5('root')::uuid,now()-interval '97 days'),
      (md5('orphan')::uuid,'Orphan','','',md5('missing')::uuid,now());
    INSERT INTO products(id,name,warranty_months) VALUES(md5('product')::uuid,'Adapter',12);
    INSERT INTO invoices(id,invoice_number,customer_id,date,created_at,total,status,notes,shipping_status,items)
      SELECT 'invoice-'||i,i::text,CASE WHEN i%2=0 THEN md5('child')::uuid ELSE md5('virtual')::uuid END,
      current_date-(i%180),now()-i*interval '1 hour',100+i,CASE WHEN i%2=0 THEN 'Paid' ELSE 'Unpaid' END,
      CASE WHEN i%3=0 THEN '__FORMS_BUY__' WHEN i%3=1 THEN '__BROADWAY__' ELSE 'Note' END,'unshipped',
      jsonb_build_array(jsonb_build_object('name','Adapter','qty',1,'price',100,'product_id',md5('product')::uuid,'warranty_months',12))
      FROM generate_series(1,85)i;
    INSERT INTO invoices(id,invoice_number,customer_id,date,created_at,total,status,items) VALUES
      ('duplicate-later','1',md5('root')::uuid,current_date,now(),999,'Paid','[{"name":"Duplicate"}]'),
      ('invalid-items','invalid',md5('root')::uuid,current_date,now(),999,'Paid','{}'),
      ('null-date','nodate',md5('root')::uuid,NULL,now(),999,'Paid','[]'),
      ('null-number',NULL,md5('root')::uuid,current_date,now(),12,'Paid','[{"name":"Adapter","qty":null,"warranty_months":12}]');
    UPDATE invoices SET date=current_date-250 WHERE id='invoice-3';
    INSERT INTO customer_devices(id,customer_id,imei,created_at) VALUES
      (md5('d1')::uuid,md5('root')::uuid,'123456789012345',now()),
      (md5('d2')::uuid,md5('child')::uuid,'123456789012346',now()-interval '1 hour'),
      (md5('d3')::uuid,md5('excluded')::uuid,'123456789012347',now());
    INSERT INTO warranty_renewals(id,invoice_id,product_id,months,paid_at,previous_end,new_end,created_at) VALUES
      (md5('renewal')::uuid,'invoice-1',md5('product')::uuid,12,current_date,current_date-10,current_date+200,now());
  `);
  const visible=read("SELECT jsonb_agg(to_jsonb(c) ORDER BY name ASC NULLS LAST,id) FROM customers c;");
  const groups=buildCustomerGroups(visible).groups;
  const oldPage=read("SELECT bizflow_customer_page(p_limit=>50);");
  const oldWarranty=[];
  for(let offset=0;;offset+=50){
    const page=read(`SELECT bizflow_warranty_page(p_limit=>50,p_offset=>${offset});`);
    oldWarranty.push(...page.rows);if(oldWarranty.length>=page.total_count)break;
  }
  check("migration reapplies and no table policy changes",()=>assert.equal(policyFingerprint(),policies));
  check("invoker stable ACL with empty search_path",()=>{
    assert.equal(pg.sql("SELECT NOT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=\"\"'] FROM pg_proc WHERE oid='bizflow_customer_detail(uuid)'::regprocedure;"),'t');
    assert.throws(()=>pg.sql("SET ROLE anon; SELECT bizflow_customer_detail(md5('root')::uuid);"),/permission denied/);
  });
  for(const group of groups){
    check(`104 JS group members and all member entry IDs: ${group.primary.name}`,()=>{
      const canonical=detail(group.id);
      assert.deepEqual([...canonical.customer.groupCids].sort(),[...group.allCids].sort());
      assert.deepEqual(canonical.members.map(m=>m.member_id).sort(),[...group.allCids].sort());
      for(const id of group.allCids)assert.deepEqual(detail(id),canonical);
    });
    const old=oldPage.rows.find(r=>r.id===group.id);
    if(old)check(`group/contact fields equal 108 oracle: ${group.primary.name}`,()=>{
      const withoutDisplay=({detail,source,...rest})=>rest;
      assert.deepEqual(withoutDisplay(detail(group.id).customer),withoutDisplay(old));
    });
    check(`full warranty payload equals all 108 pages: ${group.primary.name}`,()=>assert.deepEqual(detail(group.id).warranties,oldWarranty.filter(row=>row.customerId===group.id)));
  }
  const legacy=await legacyCustomerDetails(Object.fromEntries(['customers','invoices','customer_devices'].map(table=>[table,read(`SELECT jsonb_agg(to_jsonb(t)) FROM ${table} t;`)])));
  for(const old of legacy.scoped){
    check(`actual legacy detail field equality within 104 group: ${old.name}`,()=>{
      const {deviceCount,...fresh}=detail(old.id).customer;
      assert.deepEqual(fresh,old);
    });
  }
  check('legacy second grouping conflict is confined to membership/device scope',()=>{
    const old=legacy.detail.find(row=>row.name==='Group');
    assert.ok(old);
    assert.notDeepEqual(old.groupCids,detail(old.id).customer.groupCids);
    assert.deepEqual(legacy.detail.find(row=>row.name==='Name only'),legacy.scoped.find(row=>row.name==='Name only'));
  });
  const rootId=pg.sql("SELECT primary_id FROM bizflow_customer_group_map() WHERE member_id=md5('root')::uuid;");
  const payload=detail(rootId);
  check("all 86 valid historical orders, global dedup, no list-page truncation",()=>{assert.equal(payload.customer.detail.orders.length,86);assert.equal(payload.customer.orderCount,86);assert.equal(payload.customer.detail.orders.some(o=>o.productName==='Duplicate'),false);});
  check("device list includes physical child and excludes other group",()=>{assert.equal(payload.devices.length,2);assert.deepEqual(payload.customer.imeiCodes,['123456789012345','123456789012346']);});
  check("renewal overlay survives",()=>assert.equal(payload.warranties.find(w=>w.invoiceId==='invoice-1').latestRenewal.months,12));
  check("missing and orphan customer do not create synthetic groups",()=>{assert.equal(read("SELECT bizflow_customer_detail(md5('missing')::uuid);"),null);assert.equal(read("SELECT bizflow_customer_detail(md5('orphan')::uuid);"),null);});
  check("non-member is denied by existing table RLS",()=>assert.equal(detail(rootId,'20000000-0000-0000-0000-000000000002'),null));
  pg.sql("UPDATE employees SET can_view_revenue=false WHERE user_id='20000000-0000-0000-0000-000000000001';");
  check("legacy detail money fields unchanged for RLS-authorized non-revenue user",()=>{
    const p=detail(rootId);
    assert.equal(p.customer.detail.totalAmount,payload.customer.detail.totalAmount);
    assert.deepEqual(p.customer.detail.orders,payload.customer.detail.orders);
  });
  pg.sql("UPDATE employees SET can_view_revenue=true WHERE user_id='20000000-0000-0000-0000-000000000001';");
  pg.sql("CREATE POLICY hide_child_device ON customer_devices AS RESTRICTIVE FOR SELECT TO authenticated USING (imei <> '123456789012346');");
  check("restrictive device RLS remains effective",()=>assert.equal(detail(rootId).devices.length,1));
  pg.sql(readFileSync(new URL('./test-support/bounded-read-scale.sql',import.meta.url),'utf8'));
  check('4312 customers / 6603 invoices do not widen group payload',()=>{assert.equal(pg.sql('SELECT count(*) FROM customers;'),'4312');assert.equal(detail(rootId).customer.detail.orders.length,86);});
  const start=performance.now();const sample=detail(rootId);
  console.log(JSON.stringify({localPgMs:Math.round((performance.now()-start)*100)/100,orders:sample.customer.detail.orders.length,warranties:sample.warranties.length,jsonBytes:Buffer.byteLength(JSON.stringify(sample)),gzipBytes:gzipSync(JSON.stringify(sample)).length}));
  console.log(`CUSTOMER_DETAIL_BOUNDED_PG=${passed}/${passed}`);
}finally{pg.close();}
