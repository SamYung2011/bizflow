import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBoundedReadPg } from './test-support/bounded-read-pg.mjs';
const pg=createBoundedReadPg(fileURLToPath(new URL('../',import.meta.url)));
const emp=n=>`10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const user=n=>`20000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const company='30000000-0000-0000-0000-000000000001';
const tid=n=>`40000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let count=0;const check=(label,fn)=>{fn();console.log(`ok ${++count} - ${label}`);};
try {
 pg.sql(`
 ALTER TABLE employees ADD COLUMN is_super_admin boolean DEFAULT false;
 ALTER TABLE employee_companies ADD COLUMN id uuid DEFAULT gen_random_uuid();
 ALTER TABLE employee_tasks ADD COLUMN department_id uuid, ADD COLUMN note text, ADD COLUMN attachments jsonb DEFAULT '[]', ADD COLUMN completed_at timestamptz;
 ALTER TABLE task_assignees ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN completed_at timestamptz;
 ALTER TABLE employee_task_feedbacks ADD COLUMN id uuid DEFAULT gen_random_uuid(), ADD COLUMN created_at timestamptz DEFAULT now();
 ALTER TABLE employee_departments ADD COLUMN created_at timestamptz DEFAULT now();
 ALTER TABLE task_pending ADD COLUMN id uuid DEFAULT gen_random_uuid(), ADD COLUMN requested_at timestamptz DEFAULT now();
 ALTER TABLE team_update_logs ADD COLUMN id uuid DEFAULT gen_random_uuid();
 CREATE TABLE companies(id uuid PRIMARY KEY,name text,feature_ai_batch boolean DEFAULT false,created_at timestamptz DEFAULT now());
 CREATE TABLE company_join_pending(id uuid DEFAULT gen_random_uuid(),employee_id uuid,company_id uuid,requested_at timestamptz DEFAULT now());
 CREATE TABLE team_update_log_comments(id uuid DEFAULT gen_random_uuid(),created_at timestamptz DEFAULT now());
 CREATE FUNCTION is_bf_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$ SELECT EXISTS(SELECT 1 FROM employees WHERE user_id=auth.uid() AND active=true AND is_admin=true) $$;
 CREATE FUNCTION is_member_of_company(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$ SELECT EXISTS(SELECT 1 FROM employees e JOIN employee_companies b ON b.employee_id=e.id WHERE e.user_id=auth.uid() AND e.active=true AND b.company_id=cid) $$;
 CREATE FUNCTION is_admin_of_company(cid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.is_bf_admin() $$;
 CREATE FUNCTION is_member_of_department(did uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
 CREATE FUNCTION has_company_permission(cid uuid, perm text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
 INSERT INTO companies(id,name) VALUES('${company}','Own fixture company');
 UPDATE employees SET bizflow_main_access=true,active=false WHERE id='${emp(2)}';
 INSERT INTO employees(id,user_id,name,active,is_admin,bizflow_main_access) VALUES('${emp(3)}','${user(3)}','Own inactive admin',false,true,true),('${emp(4)}','${user(4)}','Own active teammate',true,false,true);
 INSERT INTO employee_companies(employee_id,company_id) SELECT id,'${company}' FROM employees;
 ALTER TABLE employee_tasks ENABLE ROW LEVEL SECURITY;
 CREATE POLICY team_access ON employee_tasks FOR SELECT TO authenticated USING(is_bf_admin() OR is_member_of_company(company_id));
 GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
 GRANT INSERT ON customers TO authenticated;
 INSERT INTO customers(id,name) VALUES(md5('own-customer')::uuid,'Own customer');
 INSERT INTO employee_tasks(id,company_id,title,employee_id,status) VALUES
 ('${tid(1)}','${company}','Own inactive only','${emp(2)}','open'),
 ('${tid(2)}','${company}','Own mixed owners','${emp(2)}','open'),
 ('${tid(3)}','${company}','Own unassigned',NULL,'open'),
 ('${tid(4)}','${company}','Own legacy inactive','${emp(2)}','done'),
 ('${tid(5)}','${company}','Own legacy active','${emp(1)}','done'),
 ('${tid(6)}','${company}','Own active owners','${emp(4)}','open');
 INSERT INTO task_assignees(task_id,employee_id) VALUES('${tid(1)}','${emp(2)}'),('${tid(2)}','${emp(2)}'),('${tid(2)}','${emp(4)}'),('${tid(6)}','${emp(4)}');
 `);
 pg.sql(readFileSync(new URL('../migrations/116_task_scope_setbased_rls.sql',import.meta.url),'utf8'));
 const migration=readFileSync(new URL('../migrations/130_has_bizflow_main_access_active_20261013.sql',import.meta.url),'utf8');
 const signature='bizflow_team_task_page(uuid,integer,boolean,timestamp with time zone,timestamp with time zone,timestamp with time zone,text,timestamp with time zone)';
 const oid=pg.sql(`SELECT '${signature}'::regprocedure::oid;`);
 pg.sql(migration);pg.sql(migration);
 check('inactive main employee and admin lose main permission; active stays allowed',()=>{
  for(const n of [2,3])assert.equal(pg.asUser('SELECT has_bizflow_main_access();',user(n)),'f');
  assert.equal(pg.asUser('SELECT has_bizflow_main_access();'),'t');
 });
 check('inactive RLS SELECT is empty and write is 42501',()=>{
  for(const n of [2,3]){
   assert.equal(pg.asUser('SELECT count(*) FROM customers;',user(n)),'0');
   assert.throws(()=>pg.asUser("INSERT INTO customers(id,name) VALUES(gen_random_uuid(),'Denied');",user(n)),/42501/);
  }
  assert.equal(pg.asUser('SELECT count(*) FROM customers;'),'1');
 });
 const payload=(n=1)=>JSON.parse(pg.asUser(`SELECT bizflow_team_task_page('${company}',NULL,true)::text;`,user(n)));
 const data=payload();
 check('one active roster serves team member and assignment screens',()=>assert.deepEqual(data.members.map(e=>e.id).sort(),[emp(1),emp(4)]));
 check('sole inactive and legacy inactive hidden; unassigned, mixed and active kept',()=>assert.deepEqual(data.tasks.map(t=>t.id).sort(),[tid(2),tid(3),tid(5),tid(6)]));
 check('mixed task only returns active avatar/name and totals use filtered set',()=>{
  assert.deepEqual(data.assignees.filter(a=>a.task_id===tid(2)).map(a=>a.employee_id),[emp(4)]);
  assert.deepEqual(data.taskStats,{total:4,completed:1,open:3,abandoned:0});
  assert.equal(data.employeeCompanies.some(b=>[emp(2),emp(3)].includes(b.employee_id)),false);
 });
 check('hidden tasks and inactive owner links remain in database',()=>{
  assert.equal(pg.sql('SELECT count(*) FROM employee_tasks;'),'6');assert.equal(pg.sql('SELECT count(*) FROM task_assignees;'),'4');
 });
 check('inactive caller cannot read team tasks; RPC object/signature unchanged',()=>{
  assert.deepEqual(payload(2).tasks,[]);
  assert.equal(pg.sql(`SELECT '${signature}'::regprocedure::oid;`),oid);
  assert.equal(pg.sql(`SELECT NOT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='${signature}'::regprocedure;`),'t');
 });
 console.log(`INACTIVE_EMPLOYEE_PG=${count}/${count}`);
}finally{pg.close();}
