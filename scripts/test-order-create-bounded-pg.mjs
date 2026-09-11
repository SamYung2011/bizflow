import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import { createBoundedReadPg } from "./test-support/bounded-read-pg.mjs";
import { buildCustomerGroups } from "../root-site/data/customer-groups.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const pg = createBoundedReadPg(root);
const migration = readFileSync(new URL("../migrations/120_bizflow_order_customer_candidates.sql", import.meta.url), "utf8");
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
let passed = 0;
function check(label, run) { run(); console.log(`ok ${++passed} - ${label}`); }
const query = (term, offset = 0, user) => JSON.parse(pg.asUser(`SELECT bizflow_order_customer_candidates(${literal(term)},${offset});`,user));
try {
  pg.sql(migration); pg.sql(migration);
  pg.sql(`
    INSERT INTO customers(id,name,phone,email,address,car_make,car_model,created_at)
      SELECT md5('customer-'||i)::uuid,'Customer '||lpad(i::text,3,'0'),'852-'||i,'member-'||i||'@example.test','Address '||i,'Make '||i,'Model '||i,now()-i*interval '1 day'
      FROM generate_series(1,45)i;
    INSERT INTO customers(id,name,phone,email,address,created_at) VALUES
      (md5('virtual-a')::uuid,'Virtual','9123','v@example.test','Virtual address',now()),
      (md5('virtual-b')::uuid,'Virtual','9123','v@example.tes','Virtual address',now()),
      (md5('excluded')::uuid,'Virtual','9123','v@example.test','Virtual address',now()),
      (md5('literal')::uuid,'100%_literal','quote','o''ne@example.test','Back\\slash',now());
    UPDATE customers SET merge_exclude=jsonb_build_array(md5('excluded')::uuid) WHERE id IN(md5('virtual-a')::uuid,md5('virtual-b')::uuid);
    INSERT INTO customers(id,name,phone,email,parent_id) VALUES
      (md5('child')::uuid,'Child-only match','child-phone','child@example.test',md5('virtual-a')::uuid),
      (md5('orphan')::uuid,'Orphan','orphan','orphan@example.test',md5('missing')::uuid);
    INSERT INTO employees(id,user_id,name,email,role,active) VALUES
      (md5('inactive')::uuid,md5('inactive-user')::uuid,'Inactive','inactive@example.test','銷售',false),
      (md5('null-active')::uuid,md5('null-user')::uuid,'','fallback@example.test','銷售',null),
      (md5('other-role')::uuid,md5('other-user')::uuid,'Support','support@example.test','Support',true);
    INSERT INTO warehouses VALUES (md5('w1')::uuid,'First',1),(md5('w2')::uuid,'Second',2);
    INSERT INTO invoices(id,invoice_number) VALUES('n1','99'),('n2','100001'),('n3',NULL);
  `);
  const visible = JSON.parse(pg.asUser("SELECT jsonb_agg(to_jsonb(c) ORDER BY name ASC NULLS LAST,id) FROM customers c;"));
  const byId = new Map(visible.map((row)=>[row.id,row]));
  const groups = buildCustomerGroups(visible).groups;
  const expected = (term) => groups.filter((group)=>group.allCids.some((id)=>[byId.get(id).name,byId.get(id).phone,byId.get(id).email]
    .some((value)=>String(value??"").toLowerCase().includes(term.toLowerCase()))))
    .sort((a,b)=>String(a.primary.name).localeCompare(String(b.primary.name),'en') || a.id.localeCompare(b.id));
  check("empty and whitespace search never return customers",()=>{assert.deepEqual(query(''),{rows:[],hasMore:false});assert.equal(query('   ').rows.length,0);});
  for (const term of ['Customer','852-2','member-33','Virtual','child-only','100%_','%','_',"o'ne",'missing']) {
    check(`old RLS rows + 104 JS grouper vs RPC candidates: ${term}`,()=>{
      const wanted=expected(term);
      const actual=[];
      for(let offset=0;offset<wanted.length||offset===0;offset+=20){
        const page=query(term,offset);assert.ok(page.rows.length<=20);assert.equal(page.hasMore,wanted.length>offset+20);actual.push(...page.rows);
      }
      assert.deepEqual(actual.map(r=>r.id),wanted.map(g=>g.id));
      actual.forEach((row,index)=>{
        const group=wanted[index];assert.deepEqual(row.groupCids,group.allCids);
        assert.equal(row.primaryId,group.id);assert.equal(row.isGroupPrimary,true);
        assert.equal(row.name,group.primary.name||group.allNames[0]||'');
        assert.equal(row.phone,group.primary.phone||group.allPhones[0]||'');
        assert.equal(row.detail.email,group.primary.email||group.allEmails[0]||'');
        assert.equal(row.detail.shippingAddress,group.primary.address||group.allAddresses[0]||'');
      });
    });
  }
  check("physical orphan absent and excluded group kept separate",()=>{assert.equal(query('orphan').rows.length,0);assert.equal(query('Virtual').rows.length,2);});
  check("non-member receives no candidates",()=>assert.equal(query('Customer',0,'20000000-0000-0000-0000-000000000002').rows.length,0));
  check("anon denied; invoker stable and empty search_path",()=>{
    assert.throws(()=>pg.sql("SET ROLE anon; SELECT bizflow_order_customer_candidates('Customer');"),/permission denied/);
    assert.equal(pg.sql("SELECT NOT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=\"\"'] FROM pg_proc WHERE oid='bizflow_order_customer_candidates(text,integer)'::regprocedure;"),'t');
  });
  check("narrow salesperson rows preserve old role/active/email fallback",()=>{
    const old=JSON.parse(pg.asUser("SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at,id) FROM employees e;"))
      .filter(e=>e.role==='銷售'&&e.active!==false).map(e=>({id:e.id,name:e.name||e.email||'—'}));
    const next=JSON.parse(pg.asUser("SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at,id) FROM (SELECT id,name,email,created_at FROM employees WHERE role='銷售' AND (active IS NULL OR active=true))e;"))
      .map(e=>({id:e.id,name:e.name||e.email||'—'}));
    assert.deepEqual(next,old);
  });
  check("next invoice number remains existing one-row max logic",()=>assert.equal(pg.asUser("SELECT (SELECT invoice_number::integer FROM invoices WHERE invoice_number IS NOT NULL AND invoice_number::integer<100000 ORDER BY invoice_number::integer DESC LIMIT 1)+1;"),'100'));
  pg.sql("CREATE POLICY hide_matches ON customers AS RESTRICTIVE FOR SELECT TO authenticated USING (phone <> '852-2');");
  check("search cannot bypass restrictive customer RLS",()=>assert.equal(query('member-2@').rows.length,0));
  const start=performance.now();const sample=query('Customer');
  console.log(JSON.stringify({localPgMs:Math.round((performance.now()-start)*100)/100,rows:sample.rows.length,jsonBytes:Buffer.byteLength(JSON.stringify(sample)),gzipBytes:gzipSync(JSON.stringify(sample)).length}));
  pg.sql(readFileSync(new URL('./test-support/bounded-read-scale.sql',import.meta.url),'utf8'));
  const scaleStart=performance.now();const scale=query('Customer');
  check('4312 customers / 6603 invoices still return at most 20 candidates',()=>{assert.equal(pg.sql('SELECT count(*) FROM customers;'),'4312');assert.equal(scale.rows.length,20);});
  console.log(JSON.stringify({scalePgMs:Math.round((performance.now()-scaleStart)*100)/100,jsonBytes:Buffer.byteLength(JSON.stringify(scale)),gzipBytes:gzipSync(JSON.stringify(scale)).length}));
  console.log(`ORDER_CREATE_BOUNDED_PG=${passed}/${passed}`);
} finally { pg.close(); }
