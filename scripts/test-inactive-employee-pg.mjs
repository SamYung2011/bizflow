import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { buildTeamTaskSnapshotsFromRows } from '../root-site/data/live-snapshots.js';
import { instrumentModule } from './test-support/bounded-page-runtime.mjs';
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
 ALTER TABLE employee_tasks ADD COLUMN department_id uuid, ADD COLUMN note text, ADD COLUMN attachments jsonb DEFAULT '[]', ADD COLUMN completed_at timestamptz, ADD COLUMN title_edited_by uuid, ADD COLUMN title_edited_at timestamptz, ADD COLUMN approved_by uuid, ADD COLUMN approved_at timestamptz;
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
 const before=JSON.parse(pg.asUser(`SELECT bizflow_team_task_page('${company}',NULL,true)::text;`));
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
 check('raw members and employee links match 116 including departed historical authors',()=>{
  for(const key of ['members','employeeDepartments','employeeCompanies'])assert.deepEqual(data[key],before[key]);
  assert.deepEqual(data.members.map(e=>e.id).sort(),[emp(1),emp(2),emp(3),emp(4)]);
 });
 check('sole inactive and legacy inactive hidden; unassigned, mixed and active kept',()=>assert.deepEqual(data.tasks.map(t=>t.id).sort(),[tid(2),tid(3),tid(5),tid(6)]));
 check('mixed task only returns active avatar/name and totals use filtered set',()=>{
  assert.deepEqual(data.assignees.filter(a=>a.task_id===tid(2)).map(a=>a.employee_id),[emp(4)]);
  assert.deepEqual(data.taskStats,{total:4,completed:1,open:3,abandoned:0});
  assert.equal(data.employeeCompanies.some(b=>[emp(2),emp(3)].includes(b.employee_id)),true);
 });
 check('hidden tasks and inactive owner links remain in database',()=>{
  assert.equal(pg.sql('SELECT count(*) FROM employee_tasks;'),'6');assert.equal(pg.sql('SELECT count(*) FROM task_assignees;'),'4');
 });
 check('inactive caller cannot read team tasks; RPC object/signature unchanged',()=>{
  assert.deepEqual(payload(2).tasks,[]);
  assert.equal(pg.sql(`SELECT '${signature}'::regprocedure::oid;`),oid);
  assert.equal(pg.sql(`SELECT NOT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='${signature}'::regprocedure;`),'t');
 });
 pg.sql(`UPDATE employee_tasks SET creator_employee_id='${emp(2)}', title_edited_by='${emp(2)}', approved_by='${emp(3)}' WHERE id='${tid(2)}';`);
 const historical=payload();
 const currentUser={employeeId:emp(1),name:'Main fixture',activeCompanyId:company};
 const {tasksSnapshot,membersSnapshot,teamExtrasSnapshot}=await buildTeamTaskSnapshotsFromRows(historical,currentUser);
 check('departed creator, title editor and approver names survive row mapping',()=>{
  const task=tasksSnapshot.tasks.find(t=>t.id===tid(2));
  const name=id=>historical.members.find(e=>e.id===id).name;
  assert.equal(task.creator,name(emp(2)));assert.equal(task.titleEditedBy,name(emp(2)));assert.equal(task.approvedBy,name(emp(3)));
  assert.equal(membersSnapshot.membersStats.left,2);
 });
 check('one provider mapping filters task pickers without removing historical signatures',()=>{
  const provider=instrumentModule(new URL('../root-site/data/provider.js',import.meta.url),{rootSiteUrl:path=>path,featureAiBatchForCompany:()=>false},'({buildTeamTaskData})');
  const page=provider.buildTeamTaskData({snap:tasksSnapshot,membersSnap:membersSnapshot,teamExtras:teamExtrasSnapshot,authUser:currentUser,unread:{}});
  assert.deepEqual(JSON.parse(JSON.stringify(page.members.filter(m=>m.id).map(m=>m.id))).sort(),[emp(1),emp(4)]);
  assert.equal(page.tasks.find(t=>t.id===tid(2)).creator,tasksSnapshot.tasks.find(t=>t.id===tid(2)).creator);
 });
 pg.sql(`
 INSERT INTO employees(id,user_id,name,active) VALUES('${emp(5)}','${user(5)}','Own RLS-invisible active owner',true),('${emp(6)}','${user(6)}','Own unknown-status owner',NULL);
 INSERT INTO employee_tasks(id,company_id,title,employee_id,status) VALUES
 ('${tid(7)}','${company}','Own unseen active sole owner','${emp(5)}','open'),
 ('${tid(8)}','${company}','Own unseen mixed owner','${emp(2)}','open'),
 ('${tid(9)}','${company}','Own unknown-status owner','${emp(6)}','open');
 INSERT INTO task_assignees(task_id,employee_id) VALUES('${tid(7)}','${emp(5)}'),('${tid(8)}','${emp(2)}'),('${tid(8)}','${emp(5)}'),('${tid(9)}','${emp(6)}');
 ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
 CREATE POLICY own_fixture_employee_visibility ON employees FOR SELECT TO authenticated USING(id <> '${emp(5)}');
 `);
 const scoped=payload();
 check('RLS-invisible active sole and mixed owners keep their tasks and assignee rows',()=>{
  assert.equal(scoped.members.some(e=>e.id===emp(5)),false);
  assert.ok(scoped.tasks.some(t=>t.id===tid(7)));assert.ok(scoped.tasks.some(t=>t.id===tid(8)));
  assert.deepEqual(scoped.assignees.filter(a=>a.task_id===tid(8)).map(a=>a.employee_id),[emp(5)]);
  assert.equal(scoped.taskStats.total,7);
 });
 check('only confirmed inactive owners are removed; null active is retained',()=>{
  assert.ok(scoped.tasks.some(t=>t.id===tid(9)));assert.equal(scoped.tasks.some(t=>t.id===tid(1)),false);
 });

 // 13: all three consumers use the same scope, including unread watermarks and Home feed.
 pg.sql(`
 UPDATE employee_tasks SET created_at='2026-01-01T00:00:00Z'::timestamptz + right(id::text,12)::integer * interval '1 hour';
 UPDATE employee_tasks SET created_at='2030-01-01'::timestamptz WHERE id IN ('${tid(1)}','${tid(4)}');
 INSERT INTO task_assignees(task_id,employee_id) VALUES('${tid(2)}','${emp(1)}');
 INSERT INTO employee_tasks(id,company_id,title,employee_id,status) VALUES('${tid(10)}',md5('own-other-company')::uuid,'Own inaccessible company task','${emp(1)}','open');
 `);
 const homeMigration=readFileSync(new URL('../migrations/128_bizflow_home_dashboard_materialized_reads_20261012.sql',import.meta.url),'utf8');
 pg.sql(homeMigration);
 const home=(cid=company)=>JSON.parse(pg.asUser(`SELECT bizflow_home_dashboard(${cid===null?'NULL':`'${cid}'`})::text;`));
 const unread=(cid=company,read=null)=>JSON.parse(pg.asUser(`SELECT bizflow_unread_summary(${cid===null?'NULL':`'${cid}'`},${read===null?'NULL':`'${read}'`})::text;`));
 const oldHome=home(),oldUnread=unread();
 const surfaces=readFileSync(new URL('../migrations/131_bizflow_departed_task_surfaces_20261013.sql',import.meta.url),'utf8');
 pg.sql(surfaces);pg.sql(surfaces);
 check('task unread count and watermark exclude sole/legacy inactive owners',()=>{
  assert.equal(oldUnread.unread.tasks,9);assert.equal(unread().unread.tasks,7);
  assert.equal(Date.parse(unread().watermarks.tasks),Date.parse('2026-01-01T09:00:00Z'));
  assert.equal(unread(company,'2028-01-01').unread.tasks,0);
  assert.equal(payload().unread.unread.tasks,7);
  for(const key of ['orders','inventory','updates']){
   assert.deepEqual(unread().unread[key],oldUnread.unread[key]);assert.deepEqual(unread().watermarks[key],oldUnread.watermarks[key]);
  }
 });
 check('Home task count/cards/feed share task-page scope without losing historic names or members',()=>{
  const value=home();assert.equal(oldHome.counts.tasks,9);assert.equal(value.counts.tasks,7);
  const hidden=['Own inactive only','Own legacy inactive'];
  assert.ok(oldHome.feed.some(t=>hidden.includes(t.title)));
  assert.ok(!value.feed.some(t=>hidden.includes(t.title)));assert.ok(!value.tasks.some(t=>hidden.includes(t.title)));
  assert.ok(value.tasks.some(t=>t.title==='Own mixed owners'));
  const strip=value=>{const copy=structuredClone(value);delete copy.generated_at;delete copy.tasks;delete copy.feed;delete copy.counts.tasks;copy.members=copy.members.map(({openTasks,...member})=>member);return copy;};
  assert.deepEqual(strip(value),strip(oldHome));
  assert.equal(payload().members.some(e=>e.id===emp(2)),true);
 });
 check('forced generic plans agree for explicit company, NULL scope and read watermark',()=>{
  const values=pg.asUser(`
   SET plan_cache_mode=force_generic_plan;
   PREPARE own_surface_check(uuid,timestamptz) AS SELECT jsonb_build_object(
     'unread',bizflow_unread_summary($1,$2), 'home',bizflow_home_dashboard($1),
     'page',bizflow_team_task_page($1,0,false,$2));
   EXECUTE own_surface_check('${company}',NULL);
   EXECUTE own_surface_check(NULL,NULL);
   EXECUTE own_surface_check('${company}','2028-01-01');
  `).split('\n').map(row=>JSON.parse(row));
  assert.equal(values.length,3);
  for(const [index,value] of values.entries()){
   assert.equal(value.home.counts.tasks,7);assert.equal(value.page.taskStats.total,7);
   assert.equal(value.unread.unread.tasks,index===2?0:7);assert.equal(value.page.unread.unread.tasks,index===2?0:7);
  }
 });
 check('the one scope helper and all three RPCs retain invoker ACL/signatures and materialize once',()=>{
  const helper='bizflow_task_owner_scope(uuid)';
  assert.equal(pg.sql(`SELECT NOT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',oid,'EXECUTE') AND has_function_privilege('authenticated',oid,'EXECUTE') FROM pg_proc WHERE oid='${helper}'::regprocedure;`),'t');
  assert.throws(()=>pg.sql("SET ROLE anon; SELECT * FROM bizflow_task_owner_scope(NULL);"),/42501/);
  for(const signature of ['bizflow_unread_summary(uuid,timestamp with time zone,timestamp with time zone,timestamp with time zone,text,timestamp with time zone)','bizflow_home_dashboard(uuid)','bizflow_team_task_page(uuid,integer,boolean,timestamp with time zone,timestamp with time zone,timestamp with time zone,text,timestamp with time zone)']){
   const body=pg.sql(`SELECT prosrc FROM pg_proc WHERE oid='${signature}'::regprocedure;`);
   assert.equal((body.match(/public\.bizflow_task_owner_scope\(/g)||[]).length,1);
   assert.match(body,/task_owner_scope AS MATERIALIZED/);
   assert.equal(pg.sql(`SELECT NOT prosecdef AND provolatile='s' FROM pg_proc WHERE oid='${signature}'::regprocedure;`),'t');
  }
 });
 check('missing unread/Home filters are each caught independently',()=>{
  const mutation=surfaces.replaceAll('    JOIN task_owner_scope AS owners ON owners.task_id = task.id AND owners.is_visible\n','');
  pg.sql(mutation);
  assert.throws(()=>assert.equal(unread().unread.tasks,7));assert.throws(()=>assert.equal(home().counts.tasks,7));
  pg.sql(surfaces);assert.equal(unread().unread.tasks,7);assert.equal(home().counts.tasks,7);
 });
 // Size/generic gate uses the production 031/043 indexes, absent from the minimal fixture.
 pg.sql(`
 ALTER TABLE task_assignees ADD PRIMARY KEY(task_id,employee_id);
 CREATE INDEX task_assignees_employee_idx ON task_assignees(employee_id);
 CREATE INDEX task_assignees_task_idx ON task_assignees(task_id);
 CREATE INDEX employee_tasks_company_id_idx ON employee_tasks(company_id);
 INSERT INTO employee_tasks(id,company_id,title,employee_id,status,created_at)
 SELECT md5('own-scope-scale-'||n)::uuid,'${company}','Own scope scale '||n,
        CASE WHEN n%4=0 THEN '${emp(2)}'::uuid ELSE '${emp(4)}'::uuid END,'done','2026-01-01'
 FROM generate_series(1,5000) AS n;
 INSERT INTO task_assignees(task_id,employee_id)
 SELECT id,employee_id FROM employee_tasks WHERE title LIKE 'Own scope scale %';
 ANALYZE employee_tasks;ANALYZE task_assignees;ANALYZE employees;
 `);
 check('5k tasks in a generic plan scan inactive employees and scoped assignees once',()=>{
  const body=pg.sql("SELECT prosrc FROM pg_proc WHERE oid='bizflow_task_owner_scope(uuid)'::regprocedure;").replaceAll('p_company_id','$1');
  const plan=JSON.parse(pg.asUser(`SET plan_cache_mode=force_generic_plan; PREPARE own_scope_plan(uuid) AS ${body} EXPLAIN (ANALYZE,VERBOSE,FORMAT JSON) EXECUTE own_scope_plan('${company}');`));
  const nodes=[];const visit=node=>{nodes.push(node);for(const child of node.Plans||[])visit(child);};visit(plan[0].Plan);
  const employees=nodes.filter(node=>node['Relation Name']==='employees');
  assert.ok(employees.length);assert.ok(employees.every(node=>node['Actual Loops']===1));
  const reads=nodes.filter(node=>node['Function Name']==='bizflow_scoped_task_assignees');
  assert.equal(reads.length,1);assert.equal(reads[0]['Actual Loops'],1);
  const started=performance.now();
  const value=JSON.parse(pg.asUser(`SET plan_cache_mode=force_generic_plan; PREPARE own_surface_scale(uuid) AS SELECT jsonb_build_object('unread',bizflow_unread_summary($1),'home',bizflow_home_dashboard($1),'page',bizflow_team_task_page($1,0,false));EXECUTE own_surface_scale('${company}');`));
  const elapsed=Math.round(performance.now()-started);
  for(const count of [value.unread.unread.tasks,value.home.counts.tasks,value.page.taskStats.total])assert.equal(count,3757);
  console.log(`TASK_OWNER_GENERIC_PLAN tasks=5000 employee_loops=1 assignee_helper_loops=1 scope_ms=${Math.round(plan[0]['Execution Time'])} three_surfaces_ms=${elapsed}`);
 });

 check('131 then 130 roll back cleanly and reapply restores all three filtered counts',()=>{
  const oldUnreadSource=readFileSync(new URL('../migrations/104_bizflow_data_phase1_r5.sql',import.meta.url),'utf8');
  const start=oldUnreadSource.indexOf('CREATE OR REPLACE FUNCTION public.bizflow_unread_summary(');
  pg.sql(oldUnreadSource.slice(start,oldUnreadSource.indexOf("NOTIFY pgrst, 'reload schema';",start)));pg.sql(homeMigration);
  assert.equal(unread().unread.tasks,5009);assert.equal(home().counts.tasks,5009);
  assert.equal(payload().taskStats.total,3757);
  const oldHelper=readFileSync(new URL('../migrations/064_bizflow_main_access.sql',import.meta.url),'utf8');
  const begin=oldHelper.indexOf('CREATE OR REPLACE FUNCTION has_bizflow_main_access()');
  pg.sql(oldHelper.slice(begin,oldHelper.indexOf('$$;',begin)+3));
  const oldPage=readFileSync(new URL('../migrations/116_task_scope_setbased_rls.sql',import.meta.url),'utf8');
  const pageStart=oldPage.indexOf('CREATE OR REPLACE FUNCTION public.bizflow_team_task_page(');
  pg.sql(oldPage.slice(pageStart,oldPage.indexOf("NOTIFY pgrst, 'reload schema';",pageStart)));
  pg.sql('DROP FUNCTION public.bizflow_task_owner_scope(uuid);');
  assert.equal(pg.sql("SELECT to_regprocedure('bizflow_task_owner_scope(uuid)') IS NULL;"),'t');
  assert.equal(payload().taskStats.total,5009);
  assert.equal(pg.sql('SELECT count(*) FROM employee_tasks;'),'5010');
  pg.sql(migration);pg.sql(surfaces);
  assert.equal(unread().unread.tasks,3757);assert.equal(home().counts.tasks,3757);assert.equal(payload().taskStats.total,3757);
 });
 console.log(`INACTIVE_EMPLOYEE_PG=${count}/${count}`);
}finally{pg.close();}
