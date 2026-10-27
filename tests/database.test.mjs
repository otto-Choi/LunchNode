import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {databasePools} from './postgres-rpc.mjs';
import {createBackend} from '../lib/backend/service.ts';
import {hashPin,digest} from '../lib/backend/security.ts';
import {ROSTER} from '../lib/roster.ts';
const db=databasePools();after(()=>db.close());
const files=(await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='20261023090100_global_tables.sql'&&!f.endsWith('_group_node.sql')&&!f.endsWith('_tmt_headquarters.sql')&&!f.endsWith('_continuous_operation.sql')&&!f.endsWith('_persistent_clubs.sql')&&!f.endsWith('_headquarters_administrators.sql')&&!f.endsWith('_four_person_strict_meals.sql')).sort();
// Explicit test-only opt-in is checked before any destructive setup.
await db.admin.query('drop schema public cascade; create schema public;');
await db.admin.query(`do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end$$;`);
for(const file of files)await db.admin.query(await fs.readFile('supabase/migrations/'+file,'utf8'));
await db.admin.query("update lunch_settings set start_date=(now() at time zone 'Asia/Seoul')::date-7,end_date=(now() at time zone 'Asia/Seoul')::date+7");
const {rows:[{date}]}=await db.admin.query("select to_char(d,'YYYY-MM-DD') as date from generate_series((now() at time zone 'Asia/Seoul')::date+1,(now() at time zone 'Asia/Seoul')::date+7,interval '1 day') d where extract(isodow from d)<6 order by d limit 1");
const backend=createBackend({rpc:db.rpc,inviteCode:'ci-invitation',cronSecret:'ci-cron',adminSecret:'ci-operator-secret-at-least-32-chars',secureCookies:true,retryDelay:async()=>{}});
const req=(path,body,cookie='')=>new Request('https://lunch.test/api/'+path,{method:body?'POST':'GET',headers:{origin:'https://lunch.test','content-type':'application/json',cookie},...(body?{body:JSON.stringify(body)}:{})});
const call=(path,body,cookie)=>backend.handle(path,req(path,body,cookie));
const tokens=[];
test('fresh SQL applies and all 20 real registrations plus concurrent updates succeed',async()=>{
 const result=await Promise.all(ROSTER.map(p=>call('auth',{action:'register',name:p.name,pin:'123456',invite:'ci-invitation'})));
 for(const r of result){assert.equal(r.status,200,await r.clone().text());tokens.push(r.headers.get('set-cookie').split(';')[0]);}
 const writes=await Promise.all(tokens.map(cookie=>call('state',{dates:[date],choice:{status:'join',meal:'any'}},cookie)));
 for(const r of writes)assert.equal(r.status,200,await r.clone().text());
 const saved=await db.admin.query('select data from lunch_state where id=1');assert.equal(Object.values(saved.rows[0].data.choices[date]).filter(c=>c.status==='join').length,20);
});
test('Postgres enforces roster, canonical affiliations and browser-role isolation',async()=>{
 await assert.rejects(db.admin.query("insert into lunch_roster values(gen_random_uuid(),'홍길동','4반','unset')"),e=>e.code==='23514');
 const grants=await db.admin.query("select has_table_privilege('anon','lunch_users','select') as tables,has_function_privilege('anon','lunch_snapshot(text,boolean)','execute') as functions,has_table_privilege('service_role','lunch_users','select') as direct");
 assert.deepEqual(grants.rows[0],{tables:false,functions:false,direct:false});assert.equal(await db.rpc('lunch_health',{}),true);
});
test('DB time rejects stale writes and final snapshots cannot be rewritten',async()=>{
 const snap=await db.rpc('lunch_snapshot',{p_token_hash:digest(tokens[0].split('=')[1]),p_cron:false});
 const {rows:[{past}]}=await db.admin.query("select to_char(d,'YYYY-MM-DD') as past from generate_series((now() at time zone 'Asia/Seoul')::date-7,(now() at time zone 'Asia/Seoul')::date-1,interval '1 day') d where extract(isodow from d)<6 order by d limit 1");
 await assert.rejects(db.rpc('lunch_commit_state',{p_token_hash:digest(tokens[0].split('=')[1]),p_expected_version:snap.version,p_data:snap.state,p_write_dates:[past],p_cron:false}),e=>e.code==='LN409');
 snap.state.days[past].groups.push({id:'tampered',meal:'outside',members:[]});
 await assert.rejects(db.rpc('lunch_commit_state',{p_token_hash:'',p_expected_version:snap.version,p_data:snap.state,p_write_dates:[],p_cron:true}),e=>e.code==='LN409');
});
test('PIN replacement and revocation are atomic and defeat a concurrent stale login',async()=>{
 const credential=await db.rpc('lunch_credentials',{p_name:ROSTER[0].name});const oldToken=digest(tokens[0].split('=')[1]);
 const response=await call('profile',{currentPin:'123456',newPin:'654321'},tokens[0]);assert.equal(response.status,200,await response.clone().text());
 assert.equal(await db.rpc('lunch_identity',{p_token_hash:oldToken}),null);
 await assert.rejects(db.rpc('lunch_open_session',{p_user_id:credential.id,p_expected_hash:credential.pin_hash,p_token_hash:digest('stale-session')}),e=>e.code==='LN401');
});
test('a failing registration/session transaction leaves no orphan account',async()=>{
 const person=ROSTER.at(-1);await db.admin.query('delete from lunch_users where id=$1',[person.id]);
 const existing=digest(tokens[1].split('=')[1]);
 await assert.rejects(db.rpc('lunch_register',{p_name:person.name,p_pin_hash:await hashPin('123456'),p_token_hash:existing}));
 const result=await db.admin.query('select count(*)::int as n from lunch_users where id=$1',[person.id]);assert.equal(result.rows[0].n,0);
});
test('reapplying migrations preserves accounts, settings, state and PIN hashes',async()=>{
 const before=await db.admin.query('select data,version from lunch_state');const users=await db.admin.query('select id,pin_hash from lunch_users order by id');
 for(const file of files)await db.admin.query(await fs.readFile('supabase/migrations/'+file,'utf8'));
 assert.deepEqual((await db.admin.query('select data,version from lunch_state')).rows,before.rows);assert.deepEqual((await db.admin.query('select id,pin_hash from lunch_users order by id')).rows,users.rows);
});

test('all five menu values round-trip through the real database RPC unchanged',async()=>{
 const login=await call('auth',{action:'login',name:ROSTER[0].name,pin:'654321'});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 for(const meal of ['lunchbox','prefer_lunchbox','any','prefer_outside','outside']){
  const result=await call('state',{dates:[date],choice:{status:'join',meal}},cookie);assert.equal(result.status,200,await result.clone().text());
  const saved=await (await call('state',undefined,cookie)).json();assert.equal(saved.state.choices[date][ROSTER[0].id].meal,meal);
 }
});


test('operator account recovery is atomic, audited, service-only and preserves lunch state',async()=>{
 const actor=(await call('auth',{action:'login',name:ROSTER[0].name,pin:'654321'})).headers.get('set-cookie').split(';')[0];
 const target=ROSTER[1];const credential=await db.rpc('lunch_credentials',{p_name:target.name});const before=(await db.admin.query('select data,version from lunch_state')).rows;
 const reset=await call('admin',{key:'ci-operator-secret-at-least-32-chars',action:'reset_pin',name:target.name,newPin:'987654'},actor);assert.equal(reset.status,200,await reset.clone().text());
 assert.equal(await db.rpc('lunch_identity',{p_token_hash:digest(tokens[1].split('=')[1])}),null);
 await assert.rejects(db.rpc('lunch_open_session',{p_user_id:target.id,p_expected_hash:credential.pin_hash,p_token_hash:digest('stale-admin-login')}),e=>e.code==='LN401');
 const login=await call('auth',{action:'login',name:target.name,pin:'987654'});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('admin',{key:'ci-operator-secret-at-least-32-chars',action:'revoke',name:target.name},actor)).status,200);
 assert.equal((await call('state',undefined,cookie)).status,401);assert.deepEqual((await db.admin.query('select data,version from lunch_state')).rows,before);
 const audit=await db.admin.query("select action,actor_id,target_id from lunch_admin_events order by id");assert.deepEqual(audit.rows.map(r=>r.action),['reset_pin','revoke']);assert.ok(audit.rows.every(r=>r.actor_id===ROSTER[0].id&&r.target_id===target.id));
 const grants=(await db.admin.query("select has_function_privilege('anon','lunch_admin_account(text,text,text)','execute') as a,has_function_privilege('authenticated','lunch_admin_account(text,text,text)','execute') as b,has_table_privilege('service_role','lunch_admin_events','select') as c")).rows[0];assert.deepEqual(grants,{a:false,b:false,c:false});
});

test('operator rematch replaces provisional groups atomically, checks DB cutoff after locking, and logs no encounters',async()=>{
 const actor=(await call('auth',{action:'login',name:ROSTER[0].name,pin:'654321'})).headers.get('set-cookie').split(';')[0];
 const actorHash=digest(actor.split('=')[1]);
 // Freeze only this RPC's clock in the disposable DB. Production uses clock_timestamp().
 const original=(await db.admin.query("select pg_get_functiondef('lunch_admin_rematch(text,integer,text,jsonb)'::regprocedure) as sql")).rows[0].sql;
 await db.admin.query('create table public.lunch_rematch_test_clock(value timestamptz)');
 await db.admin.query('insert into lunch_rematch_test_clock values($1)',[`${date}T10:00:00+09:00`]);
 await db.admin.query(original.replace('check_time:=clock_timestamp();','check_time:=(select value from public.lunch_rematch_test_clock);'));
 try{
  let snap=await db.rpc('lunch_snapshot',{p_token_hash:actorHash,p_cron:false});
  const people=ROSTER.slice(0,8);for(const p of ROSTER)snap.state.choices[date][p.id]={status:people.some(x=>x.id===p.id)?'join':'absent',meal:'outside'};
  snap.state.days[date]={phase:'matched',matchedAt:`${date}T00:00:00+09:00`,groups:[{id:'old-1',meal:'outside',members:people.slice(0,5)},{id:'old-2',meal:'outside',members:people.slice(5)}]};
  await db.admin.query('update lunch_state set data=$1,version=version+1 where id=1',[snap.state]);
  const before=(await db.admin.query('select data from lunch_state')).rows[0].data;
  const testBackend=createBackend({rpc:async(n,a)=>{const result=await db.rpc(n,a);return n==='lunch_snapshot'?{...result,now:`${date}T10:00:00+09:00`}:result;},inviteCode:'ci-invitation',cronSecret:'ci-cron',adminSecret:'ci-operator-secret-at-least-32-chars',secureCookies:true});
  const result=await testBackend.handle('admin',req('admin',{key:'ci-operator-secret-at-least-32-chars',action:'rematch',date},actor));assert.equal(result.status,200,await result.clone().text());
  snap=await db.rpc('lunch_snapshot',{p_token_hash:actorHash,p_cron:false});
  assert.deepEqual(snap.state.choices,before.choices);assert.deepEqual(snap.state.days[date].groups.map(g=>g.members.length),[4,4]);assert.ok(snap.state.days[date].rematchedAt);assert.equal(snap.state.days[date].phase,'matched');
  for(const [d,day]of Object.entries(before.days))if(d!==date)assert.deepEqual(snap.state.days[d],day);
  assert.equal((await db.admin.query("select count(*)::int as n from lunch_admin_events where action='rematch' and target_date=$1 and actor_id=$2",[date,ROSTER[0].id])).rows[0].n,1);
  const args={p_actor_token:actorHash,p_expected_version:snap.version,p_date:date,p_groups:snap.state.days[date].groups};
  assert.equal(await db.rpc('lunch_admin_rematch',{...args,p_expected_version:snap.version-1}),false);
  const wrong=structuredClone(args.p_groups);wrong[0].members.pop();await assert.rejects(db.rpc('lunch_admin_rematch',{...args,p_groups:wrong}),e=>e.code==='LN409');
  const wrongMeal=structuredClone(args.p_groups);wrongMeal[0].meal='lunchbox';await assert.rejects(db.rpc('lunch_admin_rematch',{...args,p_groups:wrongMeal}),e=>e.code==='LN400');
  const grants=(await db.admin.query("select has_function_privilege('anon','lunch_admin_rematch(text,integer,text,jsonb)','execute') as a,has_function_privilege('authenticated','lunch_admin_rematch(text,integer,text,jsonb)','execute') as b")).rows[0];assert.deepEqual(grants,{a:false,b:false});
  // A request that starts before cutoff but waits on the state lock must fail.
  const locker=await db.admin.connect();await locker.query('begin');await locker.query('select id from lunch_state where id=1 for update');
  let pending;
  try{
   pending=db.rpc('lunch_admin_rematch',args).then(()=>({ok:true}),error=>({error}));
   let blocked=false;for(let i=0;i<100;i++){const r=await db.admin.query("select 1 from pg_stat_activity where wait_event_type='Lock' and query like 'select public.lunch_admin_rematch(%' limit 1");if(r.rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(blocked,'rematch should wait for row lock');
   await db.admin.query('update lunch_rematch_test_clock set value=$1',[`${date}T11:00:00+09:00`]);
  }finally{await locker.query('rollback');locker.release();}
  const locked=await pending;assert.equal(locked.error?.code,'LN409');
  const saved=(await db.admin.query('select data,version from lunch_state')).rows[0];assert.equal(saved.version,snap.version);assert.deepEqual(saved.data,snap.state);
  assert.equal((await db.admin.query("select count(*)::int as n from lunch_admin_events where action='rematch'")).rows[0].n,1);
  await db.admin.query('update lunch_rematch_test_clock set value=$1',[`${date}T10:00:00+09:00`]);
  await db.admin.query("update lunch_state set data=jsonb_set(data,array['days',$1,'phase'],'\"final\"'::jsonb) where id=1",[date]);
  await assert.rejects(db.rpc('lunch_admin_rematch',args),e=>e.code==='LN409');
 }finally{await db.admin.query(original);await db.admin.query('drop table lunch_rematch_test_clock');}
});

test('same-database Global tables preserve all AX data and isolate auth, choices, matching and operator writes',async()=>{
 const axUsers=(await db.admin.query('select id,pin_hash from lunch_users order by id')).rows;
 const axState=(await db.admin.query('select data,version from lunch_state')).rows;
 const {tenantRpc}=await import('../lib/backend/tenant-rpc.ts');
 const global={admin:db.admin,rpc:tenantRpc(db.rpc,'global')};
 const axTables=['lunch_roster','lunch_users','lunch_sessions','lunch_state','lunch_auth_buckets','lunch_settings','lunch_admin_events','lunch_job_runs'];
 const snapshotAX=async()=>Object.fromEntries(await Promise.all(axTables.map(async table=>[table,(await db.admin.query(`select coalesce(jsonb_agg(t order by to_jsonb(t)::text),'[]') as data from public.${table} t`)).rows[0].data])));
 const beforeAX=await snapshotAX();
 try{
  // Freeze only this disposable installation to test an opening morning, independent of CI's date.
  const installer=(await fs.readFile('supabase/global-schema.sql','utf8')).replaceAll('clock_timestamp()',"'2026-10-23T09:00:00+09:00'::timestamptz");
  await global.admin.query(installer);
  const info=await global.rpc('lunch_tenant_info',{});assert.equal(info.tenant,'global');assert.equal(info.startDate,'2026-10-23');assert.equal(info.endDate,'2026-11-30');
  const {GLOBAL_ROSTER}=await import('../lib/backend/global-roster.ts');const {tenantConfig}=await import('../lib/backend/tenant-config.ts');
  const people=(await global.admin.query('select id,name,class_name as "className",default_status as "defaultStatus" from global_lunch_roster order by id')).rows;assert.deepEqual(people,GLOBAL_ROSTER);
  assert.equal(people.filter(p=>p.className==='IOA').length,12);assert.ok(people.every(p=>p.defaultStatus==='unset'));assert.deepEqual(tenantConfig('global').policy.genderByName,{});
  const backend=createBackend({rpc:global.rpc,tenantId:'global',roster:GLOBAL_ROSTER,policy:tenantConfig('global').policy,inviteCode:'global-only',adminSecret:'global-operator-key-at-least-32-chars',cronSecret:'global-cron',secureCookies:false,cookieStyle:'namespaced'});
  const callGlobal=(endpoint,body,cookie='')=>backend.handle(endpoint,req(endpoint,body,cookie));
  const registered=await callGlobal('auth',{action:'register',name:'박인홍',pin:'123456',invite:'global-only'});assert.equal(registered.status,200,await registered.clone().text());const cookie=registered.headers.get('set-cookie').split(';')[0];
  assert.match(cookie,/^global_lunch_session=/);assert.equal((await callGlobal('auth',{action:'register',name:'최철원',pin:'123456',invite:'global-only'})).status,400);
  const attendees=[...GLOBAL_ROSTER.slice(0,4),...GLOBAL_ROSTER.slice(12,16)];
  for(const p of attendees)if(p.name!=='박인홍'){const r=await callGlobal('auth',{action:'register',name:p.name,pin:'123456',invite:'global-only'});assert.equal(r.status,200,await r.clone().text());}
  const choices=Object.fromEntries(attendees.map(p=>[p.id,{status:'join',meal:'any'}]));
  await global.admin.query("update global_lunch_state set data=jsonb_set(data,'{choices}', $1::jsonb),version=version+1 where id=1",[JSON.stringify({'2026-10-23':choices})]);
  const initial=await callGlobal('admin',{action:'initial_match',date:'2026-10-23',key:'global-operator-key-at-least-32-chars'},cookie);assert.equal(initial.status,200,await initial.clone().text());
  const state=(await global.admin.query('select data from global_lunch_state')).rows[0].data;assert.equal(state.days['2026-10-23'].phase,'matched');assert.equal(state.days['2026-10-23'].groups.length,2);assert.deepEqual(state.days['2026-10-23'].groups.flatMap(g=>g.members.map(p=>p.id)).sort(),attendees.map(p=>p.id).sort());assert.ok(state.days['2026-10-23'].groups.every(g=>g.members.length===4&&g.members.filter(p=>p.className==='IOA').length===2));
  assert.equal((await callGlobal('admin',{action:'initial_match',date:'2026-10-23',key:'global-operator-key-at-least-32-chars'},cookie)).status,409);
  await global.rpc('lunch_record_job',{p_ok:true,p_code:null});const status=await global.rpc('lunch_system_status',{});assert.equal(status.lastOk,true);assert.ok(status.lastSuccessAt);assert.equal(status.registered,8);
  const {createApplication}=await import('../lib/backend/application.ts');
  const application=createApplication({env:{SUPABASE_URL:'https://shared.test',SUPABASE_SERVICE_ROLE_KEY:'shared-key',INVITE_CODE:'ax-only',ADMIN_SECRET:'ax-operator-key-at-least-32-characters',GLOBAL_INVITE_CODE:'global-only',GLOBAL_ADMIN_SECRET:'global-operator-key-at-least-32-chars'},rpcFactory:(url,key)=>{assert.equal(url,'https://shared.test');assert.equal(key,'shared-key');return db.rpc;}});
  const appCall=(endpoint,tenant,body,cookieValue)=>{const request=req(endpoint,body,cookieValue);request.headers.set('x-lunch-tenant',tenant);return application.handle(endpoint,request);};
  assert.equal((await appCall('state','ax',undefined,cookie)).status,401);
  assert.equal((await appCall('state','ax',undefined,cookie.replace('global_lunch_session=','lunch_session='))).status,401);
  assert.equal((await appCall('state','global',undefined,tokens[1].replace('lunch_session=','global_lunch_session='))).status,401);
  const globalState=await appCall('state','global',undefined,cookie);assert.equal(globalState.status,200,await globalState.clone().text());assert.equal((await globalState.json()).people.length,20);
  assert.equal((await appCall('admin','global',{action:'status',key:'ax-operator-key-at-least-32-characters'},cookie)).status,403);
  const savedChoice=await appCall('state','global',{dates:['2026-10-23'],choice:{status:'join',meal:'outside'}},cookie);assert.equal(savedChoice.status,200,await savedChoice.clone().text());
  const snapshotGlobal=async()=>Object.fromEntries(await Promise.all(axTables.map(async table=>[table,(await db.admin.query(`select coalesce(jsonb_agg(t order by to_jsonb(t)::text),'[]') as data from public.global_${table} t`)).rows[0].data])));
  const savedGlobal=await snapshotGlobal();
  await global.admin.query(installer);assert.deepEqual(await snapshotGlobal(),savedGlobal);
  assert.deepEqual(await snapshotAX(),beforeAX);
  // Browser roles cannot access either namespace; service calls cannot accidentally accept the other session.
  for(const prefix of ['', 'global_']){const permissions=(await db.admin.query(`select has_table_privilege('anon','${prefix}lunch_users','select') as a,has_table_privilege('authenticated','${prefix}lunch_state','select') as b,has_function_privilege('anon','${prefix}lunch_snapshot(text,boolean)','execute') as c`)).rows[0];assert.deepEqual(permissions,{a:false,b:false,c:false});}
  // Record all AX rows and table OIDs: rename must preserve identity and every stored value.
  const oldOids=(await db.admin.query("select relname,oid::int from pg_class where relnamespace='public'::regnamespace and relname=any($1)",[axTables])).rows;
  const upgrade=await fs.readFile('supabase/upgrade-shared-db.sql','utf8');await db.admin.query(upgrade);
  for(const item of oldOids)assert.equal((await db.admin.query('select to_regclass($1)::oid::int as oid',['public.ax_'+item.relname])).rows[0].oid,item.oid);
  const snapshotRenamed=async()=>Object.fromEntries(await Promise.all(axTables.map(async table=>[table,(await db.admin.query(`select coalesce(jsonb_agg(t order by to_jsonb(t)::text),'[]') as data from public.ax_${table} t`)).rows[0].data])));
  assert.deepEqual(await snapshotRenamed(),beforeAX);assert.deepEqual(await snapshotGlobal(),savedGlobal);
  assert.equal((await db.admin.query("select to_regclass('public.lunch_users') as legacy")).rows[0].legacy,null);
  // Old browser cookies no longer authenticate after cutover; existing PINs still work.
  const login=await appCall('auth','ax',{action:'unlock',invite:'ax-only'},'');assert.equal(login.status,200);const gate=login.headers.get('set-cookie').split(';')[0];
  const signedIn=await appCall('auth','ax',{action:'login',name:ROSTER[0].name,pin:'654321'},gate);assert.equal(signedIn.status,200,await signedIn.clone().text());assert.match(signedIn.headers.get('set-cookie'),/^ax_lunch_session=/);
  const axCookie=signedIn.headers.get('set-cookie').split(';')[0];assert.equal((await appCall('state','ax',undefined,tokens[1])).status,401);
  assert.equal((await appCall('state','ax',undefined,axCookie)).status,200);
  const rawAX=db.rpc;const preserved=(await db.admin.query('select data from ax_lunch_state')).rows[0].data;
  // Global tokens and operator keys cannot write into renamed AX tables.
  assert.equal((await appCall('state','ax',undefined,cookie.replace('global_lunch_session=','ax_lunch_session='))).status,401);
  assert.equal((await appCall('admin','ax',{action:'status',key:'global-operator-key-at-least-32-chars'},axCookie)).status,403);
  await rawAX('ax_lunch_record_job',{p_ok:true,p_code:null});assert.equal((await rawAX('ax_lunch_system_status',{})).tenant,'ax');
  assert.deepEqual((await db.admin.query('select data from ax_lunch_state')).rows[0].data,preserved);
  const afterAX=await snapshotRenamed(),afterGlobal=await snapshotGlobal();await db.admin.query(upgrade);assert.deepEqual(await snapshotRenamed(),afterAX);assert.deepEqual(await snapshotGlobal(),afterGlobal);
  // An interrupted old/new deployment can never silently create an empty AX account table.
  await db.admin.query('create table lunch_users(id uuid)');await assert.rejects(db.admin.query(upgrade),/Both legacy and AX-prefixed/);await db.admin.query('rollback');await db.admin.query('drop table lunch_users');
  assert.deepEqual(await snapshotRenamed(),afterAX);
 }finally{/* Both headquarters intentionally use the same pool and database. */}
});

test('single cutover upgrades an original pre-admin DB without any earlier rollout SQL',async()=>{
 const databaseName='lunch_original_ax_cutover_test';await db.admin.query(`create database ${databaseName}`);
 const url=new URL(process.env.DATABASE_URL);url.pathname='/'+databaseName;const legacy=databasePools(url.toString());
 try{
  for(const file of files.slice(0,3))await legacy.admin.query(await fs.readFile('supabase/migrations/'+file,'utf8'));
  const token='f'.repeat(64),pinHash=await hashPin('123456');
  await legacy.rpc('lunch_register',{p_name:ROSTER[0].name,p_pin_hash:pinHash,p_token_hash:digest(token)});
  const stored={choices:{'2026-10-23':{[ROSTER[0].id]:{status:'join',meal:'outside'}}},days:{'2026-10-22':{phase:'final',matchedAt:'2026-10-21T22:00:00+09:00',groups:[{id:'preserved-final-group',meal:'outside',members:[ROSTER[0]]}]}},events:[]};
  await legacy.admin.query('update lunch_state set data=$1,version=17 where id=1',[stored]);
  const before=(await legacy.admin.query('select id,pin_hash,created_at from lunch_users order by id')).rows;
  await legacy.admin.query(await fs.readFile('supabase/upgrade-before-cutover.sql','utf8'));
  assert.deepEqual((await legacy.admin.query('select id,pin_hash,created_at from ax_lunch_users order by id')).rows,before);
  assert.deepEqual((await legacy.admin.query('select data,version from ax_lunch_state')).rows,[{data:stored,version:17}]);
  assert.equal((await legacy.rpc('ax_lunch_identity',{p_token_hash:digest(token)})).id,ROSTER[0].id);
  const info=await legacy.rpc('ax_lunch_tenant_info',{});assert.equal(info.startDate,'2026-10-22');assert.equal(info.endDate,'2026-11-30');
  assert.equal((await legacy.admin.query('select count(*)::int as n from global_lunch_roster')).rows[0].n,20);
  const {GLOBAL_ROSTER}=await import('../lib/backend/global-roster.ts');
  assert.deepEqual((await legacy.admin.query('select id,name,class_name as "className",default_status as "defaultStatus" from global_lunch_roster order by id')).rows,GLOBAL_ROSTER);
  const registeredGlobal=await legacy.rpc('global_lunch_register',{p_name:'박인홍',p_pin_hash:await hashPin('654321'),p_token_hash:digest('global:first')});assert.equal(registeredGlobal.name,'박인홍');
  const globalSnapshot=await legacy.rpc('global_lunch_snapshot',{p_token_hash:digest('global:first'),p_cron:false});assert.equal(globalSnapshot.people.length,20);assert.ok(globalSnapshot.people.every(p=>p.defaultStatus==='unset'));assert.ok(globalSnapshot.dates.length>0);
  assert.equal(await legacy.rpc('ax_lunch_identity',{p_token_hash:digest('global:first')}),null);
  for(const prefix of ['ax_','global_'])assert.equal((await legacy.admin.query(`select has_function_privilege('anon','${prefix}lunch_snapshot(text,boolean)','execute') as allowed`)).rows[0].allowed,false);
  const signedState=(await legacy.admin.query('select data,version from ax_lunch_state')).rows;await legacy.admin.query(await fs.readFile('supabase/upgrade-shared-db.sql','utf8'));assert.deepEqual((await legacy.admin.query('select data,version from ax_lunch_state')).rows,signedState);

  const leftovers=(await legacy.admin.query("select proname from pg_proc where pronamespace='public'::regnamespace and starts_with(proname,'lunch_')")).rows;assert.deepEqual(leftovers,[]);
  // Verify a brand-new install uses the final namespaces from the outset.
  await legacy.admin.query('drop schema public cascade;create schema public');
  await legacy.admin.query(await fs.readFile('supabase/schema.sql','utf8'));
  assert.equal((await legacy.rpc('ax_lunch_tenant_info',{})).tenant,'ax');assert.equal((await legacy.rpc('global_lunch_tenant_info',{})).tenant,'global');
 }finally{await legacy.close();await db.admin.query(`drop database ${databaseName}`);}
});

test('Global spelling correction preserves registered identity, PIN, sessions, choices and AX data; reruns safely',async()=>{
 const databaseName='lunch_global_name_correction_test';await db.admin.query(`create database ${databaseName}`);
 const url=new URL(process.env.DATABASE_URL);url.pathname='/'+databaseName;const original=databasePools(url.toString());
 try{
  // Reproduce the already deployed, immutable historical Global installation.
  for(const file of files)await original.admin.query(await fs.readFile('supabase/migrations/'+file,'utf8'));
  const installer=(await fs.readFile('supabase/migrations/20261023090100_global_tables.sql','utf8')).replaceAll('clock_timestamp()',"'2026-10-23T09:00:00+09:00'::timestamptz");
  await original.admin.query(installer);
  const token='e'.repeat(64),pinHash=await hashPin('123456');
  const person=await original.rpc('global_lunch_register',{p_name:'이윤서',p_pin_hash:pinHash,p_token_hash:digest('global:'+token)});
  const state={choices:{'2026-10-23':{[person.id]:{status:'join',meal:'any'}}},days:{'2026-10-23':{phase:'final',matchedAt:'2026-10-22T22:00:00+09:00',groups:[{id:'unchanged-group',meal:'outside',members:[person]}]}},events:[]};
  await original.admin.query('update global_lunch_state set data=$1,version=37 where id=1',[state]);
  const beforeAccount=(await original.admin.query('select id,pin_hash,created_at from global_lunch_users')).rows;
  const beforeSession=(await original.admin.query('select * from global_lunch_sessions')).rows;
  const beforeAX=(await original.admin.query('select * from lunch_state')).rows;
  const migration=await fs.readFile('supabase/migrations/20261024090000_global_name_correction.sql','utf8');
  await original.admin.query(migration);
  assert.deepEqual((await original.admin.query('select id,pin_hash,created_at from global_lunch_users')).rows,beforeAccount);
  assert.deepEqual((await original.admin.query('select * from global_lunch_sessions')).rows,beforeSession);
  assert.deepEqual((await original.admin.query('select * from lunch_state')).rows,beforeAX);
  assert.equal((await original.rpc('global_lunch_identity',{p_token_hash:digest('global:'+token)})).name,'이은서');
  assert.equal((await original.rpc('global_lunch_credentials',{p_name:'이은서'})).pin_hash,pinHash);
  assert.equal(await original.rpc('global_lunch_credentials',{p_name:'이윤서'}),null);
  const expected=structuredClone(state);expected.days['2026-10-23'].groups[0].members[0].name='이은서';
  assert.deepEqual((await original.admin.query('select data,version from global_lunch_state')).rows,[{data:expected,version:38}]);
  assert.equal((await original.rpc('global_lunch_tenant_info',{})).globalRosterRevision,1);
  await original.admin.query(migration);
  assert.deepEqual((await original.admin.query('select data,version from global_lunch_state')).rows,[{data:expected,version:38}]);
  // The current rerunnable installer must retain corrected accounts and settings.
  await original.admin.query(await fs.readFile('supabase/global-schema.sql','utf8'));
  assert.deepEqual((await original.admin.query('select id,pin_hash,created_at from global_lunch_users')).rows,beforeAccount);
  assert.equal((await original.rpc('global_lunch_credentials',{p_name:'이은서'})).pin_hash,pinHash);
  await assert.rejects(original.admin.query("update global_lunch_roster set name='이윤서' where name='이은서'"));
  const fk=(await original.admin.query("select count(*)::int as n from pg_constraint where conrelid='global_lunch_users'::regclass and confrelid='global_lunch_roster'::regclass and contype='f'")).rows[0].n;
  assert.ok(fk>=2);
 }finally{await original.close();await db.admin.query(`drop database ${databaseName}`);}
});

test('Global correction before first registration retains the participant ID and invalidates stale empty snapshots',async()=>{
 const databaseName='lunch_global_unregistered_name_test';await db.admin.query(`create database ${databaseName}`);
 const url=new URL(process.env.DATABASE_URL);url.pathname='/'+databaseName;const original=databasePools(url.toString());
 try{
  for(const file of files)await original.admin.query(await fs.readFile('supabase/migrations/'+file,'utf8'));
  await original.admin.query((await fs.readFile('supabase/migrations/20261023090100_global_tables.sql','utf8')).replaceAll('clock_timestamp()',"'2026-10-23T09:00:00+09:00'::timestamptz"));
  const before=(await original.admin.query('select id from global_lunch_roster where name=$1',['이윤서'])).rows[0];
  const state=(await original.admin.query('select data from global_lunch_state')).rows[0].data;
  const correction=await fs.readFile('supabase/migrations/20261024090000_global_name_correction.sql','utf8');await original.admin.query(correction);
  assert.deepEqual((await original.admin.query('select id from global_lunch_roster where name=$1',['이은서'])).rows[0],before);
  assert.deepEqual((await original.admin.query('select data,version from global_lunch_state')).rows,[{data:state,version:1}]);
  await original.admin.query(correction);assert.equal((await original.admin.query('select version from global_lunch_state')).rows[0].version,1);
  const registered=await original.rpc('global_lunch_register',{p_name:'이은서',p_pin_hash:await hashPin('123456'),p_token_hash:digest('new-name-session')});assert.equal(registered.id,before.id);
 }finally{await original.close();await db.admin.query(`drop database ${databaseName}`);}
});

test('Group Node shares public meetups across headquarters but isolates private meetings and all ownership writes',async()=>{
 await db.admin.query(await fs.readFile('supabase/migrations/20261026124241_group_node.sql','utf8'));
 const axHash=digest('group-ax'),globalHash=digest('group-global'),otherHash=digest('group-other');
 for(const [prefix,name,hash] of [['ax',ROSTER[0].name,axHash],['ax',ROSTER[1].name,otherHash],['global','류지환',globalHash]]){
  const c=await db.rpc(prefix+'_lunch_credentials',{p_name:name});assert.ok(c);
  await db.rpc(prefix+'_lunch_open_session',{p_user_id:c.id,p_expected_hash:c.pin_hash,p_token_hash:hash});
 }
 const group=(tenant,hash,action,payload={})=>db.rpc('group_node_api',{p_tenant:tenant,p_token_hash:hash,p_action:action,p_payload:payload});
 const ax=(a,p)=>group('ax',axHash,a,p),global=(a,p)=>group('global',globalHash,a,p),other=(a,p)=>group('ax',otherHash,a,p);
 const beforeAX=(await db.admin.query('select data,version from ax_lunch_state')).rows,beforeGlobal=(await db.admin.query('select data,version from global_lunch_state')).rows;
 const next=new Date(date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);
 const input={title:'본부 교류',description:'DB 통합 테스트',category:'food',minPeople:2,visibility:'all',dates:[{date,time:'12:00'},{date:next.toISOString().slice(0,10),time:null}]};
 let m;let privateMeetup;
 try{
  await assert.rejects(group('global',axHash,'list',{}),e=>e.status===401);
  const countBefore=(await db.admin.query('select count(*)::int as n from group_node_meetups')).rows[0].n;
  await assert.rejects(ax('create',{...input,dates:[{date:'2000-01-01',time:null}]}),e=>e.status===400);
  assert.equal((await db.admin.query('select count(*)::int as n from group_node_meetups')).rows[0].n,countBefore);
  m=await ax('create',input);assert.equal(m.participants.length,1);assert.equal(m.proposer.tenant,'ax');
  assert.ok((await global('list',{})).meetups.some(x=>x.id===m.id));
  privateMeetup=await ax('create',{...input,title:'AX 전용',visibility:'headquarters'});
  assert.ok(!(await global('list',{})).meetups.some(x=>x.id===privateMeetup.id));
  for(const action of ['detail','join','comment','delete'])await assert.rejects(global(action,{id:privateMeetup.id,body:'no',version:0}),e=>e.status===404);
  m=await global('join',{id:m.id});assert.equal(m.participants.length,2);
  for(const d of m.dates)m=await global('vote',{id:m.id,dateId:d.id});
  await assert.rejects(other('update',{...input,id:m.id,version:m.version}),e=>e.status===403);
  await assert.rejects(global('confirm',{id:m.id,version:m.version,dateId:m.dates[0].id}),e=>e.status===403);
  m=await ax('confirm',{id:m.id,version:m.version,dateId:m.dates[0].id});assert.equal(m.status,'confirmed');
  await assert.rejects(ax('update',{...input,id:m.id,version:0}),e=>e.status===409);
  await assert.rejects(ax('update',{...input,id:m.id,version:m.version,visibility:'headquarters'}),e=>e.status===409);
  m=await ax('update',{...input,id:m.id,version:m.version,dates:m.dates.map((d,i)=>({id:d.id,date:d.date,time:i===0?'13:00':d.time}))});
  assert.equal(m.status,'open');assert.equal(m.dates[0].voters.length,0);assert.equal(m.dates[1].voters.length,1);
  m=await global('comment',{id:m.id,body:'같이 가요 <script>plain text</script>'});const comment=m.comments[0];assert.equal(comment.member.tenant,'global');
  await assert.rejects(ax('delete_comment',{id:m.id,commentId:comment.id}),e=>e.status===403);
  m=await global('delete_comment',{id:m.id,commentId:comment.id});assert.equal(m.comments.length,0);
  m=await global('leave',{id:m.id});assert.equal(m.participants.length,1);assert.ok(m.dates.every(d=>!d.voters.length));
  await assert.rejects(global('vote',{id:m.id,dateId:m.dates[0].id}),e=>e.status===409);
  const grants=(await db.admin.query("select has_function_privilege('anon','group_node_api(text,text,text,jsonb)','execute') as rpc,has_table_privilege('service_role','group_node_meetups','select') as direct,has_table_privilege('anon','group_node_comments','select') as comments")).rows[0];assert.deepEqual(grants,{rpc:false,direct:false,comments:false});
  assert.deepEqual((await db.admin.query('select data,version from ax_lunch_state')).rows,beforeAX);assert.deepEqual((await db.admin.query('select data,version from global_lunch_state')).rows,beforeGlobal);
 }finally{
  if(m)await db.admin.query('delete from group_node_meetups where id=$1',[m.id]);
  if(privateMeetup)await db.admin.query('delete from group_node_meetups where id=$1',[privateMeetup.id]);
 }
});


test('TMT installer preserves existing HQs, enforces 18-person roster, and extends Group Node securely',async()=>{
 const before=await db.admin.query("select 'ax' as tenant,version,data from ax_lunch_state union all select 'global',version,data from global_lunch_state");
 const accounts=await db.admin.query("select 'ax' as tenant,id,pin_hash from ax_lunch_users union all select 'global',id,pin_hash from global_lunch_users");
 const sql=await fs.readFile('supabase/tmt-schema.sql','utf8');await db.admin.query(sql);
 await db.admin.query(await fs.readFile('supabase/tmt-group-node.sql','utf8'));
 const {TMT_ROSTER}=await import('../lib/backend/tmt-roster.ts');
 assert.deepEqual((await db.admin.query('select id,name,class_name as "className",default_status as "defaultStatus" from tmt_lunch_roster order by id')).rows,TMT_ROSTER);
 assert.equal((await db.rpc('tmt_lunch_tenant_info',{})).tenant,'tmt');assert.equal(await db.rpc('tmt_lunch_health',{}),true);
 const tokens=[];
 for(const p of TMT_ROSTER){const hash=digest('tmt:'+p.id);await db.rpc('tmt_lunch_register',{p_name:p.name,p_pin_hash:await hashPin('123456'),p_token_hash:hash});tokens.push(hash);}
 await assert.rejects(db.rpc('tmt_lunch_register',{p_name:'류지환',p_pin_hash:'x',p_token_hash:'x'}));
 assert.equal(await db.rpc('global_lunch_identity',{p_token_hash:tokens[0]}),null);
 const {tenantConfig}=await import('../lib/backend/tenant-config.ts');
 const tmtBackend=createBackend({rpc:(name,args)=>db.rpc('tmt_'+name,args),tenantId:'tmt',roster:TMT_ROSTER,policy:tenantConfig('tmt').policy,inviteCode:'TMT36',adminSecret:'ci-tmt-operator-key-at-least-32-characters',cronSecret:'ci',secureCookies:false,cookieStyle:'namespaced'});
 const login=await tmtBackend.handle('auth',req('auth',{action:'login',name:'김수연',pin:'123456'}));assert.equal(login.status,200,await login.clone().text());
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const joined=await tmtBackend.handle('state',req('state',{dates:[date],choice:{status:'join',meal:'prefer_outside'}},cookie));assert.equal(joined.status,200,await joined.clone().text());
 const saved=await (await tmtBackend.handle('state',req('state',undefined,cookie))).json();assert.deepEqual(saved.state.choices[date][TMT_ROSTER[0].id],{status:'join',meal:'prefer_outside'});

 const group=(tenant,hash,action,payload={})=>db.rpc('group_node_api',{p_tenant:tenant,p_token_hash:hash,p_action:action,p_payload:payload});
 let m=await group('tmt',tokens[0],'create',{title:'TMT 교류',description:'',category:'food',visibility:'all',minPeople:2,dates:[{date,time:null}]});
 assert.equal(m.proposer.name,'김수연');assert.equal(m.proposer.className,'TMT Tech');
 assert.ok((await group('global',digest('group-global'),'list')).meetups.some(x=>x.id===m.id));
 m=await group('global',digest('group-global'),'join',{id:m.id});assert.equal(m.participants.length,2);
 await group('tmt',tokens[0],'delete',{id:m.id,version:m.version});
 m=await group('tmt',tokens[0],'create',{title:'TMT 전용',description:'',category:'food',visibility:'headquarters',minPeople:2,dates:[{date,time:null}]});
 await assert.rejects(group('global',digest('group-global'),'detail',{id:m.id}),e=>e.status===404);
 await assert.rejects(group('tmt',digest('group-global'),'detail',{id:m.id}),e=>e.status===401);
 await group('tmt',tokens[0],'delete',{id:m.id,version:m.version});
 const tmtBefore=await db.admin.query('select id,pin_hash from tmt_lunch_users order by id');await db.admin.query(sql);assert.deepEqual((await db.admin.query('select id,pin_hash from tmt_lunch_users order by id')).rows,tmtBefore.rows);
 assert.deepEqual((await db.admin.query("select 'ax' as tenant,version,data from ax_lunch_state union all select 'global',version,data from global_lunch_state")).rows,before.rows);
 assert.deepEqual((await db.admin.query("select 'ax' as tenant,id,pin_hash from ax_lunch_users union all select 'global',id,pin_hash from global_lunch_users")).rows,accounts.rows);
 assert.equal((await db.admin.query("select has_function_privilege('anon','tmt_lunch_snapshot(text,boolean)','execute') as allowed")).rows[0].allowed,false);
});

test('continuous operation preserves data and allows future weekdays beyond the former end date',async()=>{
 const baseline=await db.admin.query("select 'ax' as tenant,version,data from ax_lunch_state union all select 'global',version,data from global_lunch_state union all select 'tmt',version,data from tmt_lunch_state");
 const accounts=await db.admin.query("select 'ax' as tenant,id,pin_hash from ax_lunch_users union all select 'global',id,pin_hash from global_lunch_users union all select 'tmt',id,pin_hash from tmt_lunch_users");
 const sql=await fs.readFile('supabase/continuous-operation.sql','utf8');await db.admin.query(sql);await db.admin.query(sql);
 assert.deepEqual((await db.admin.query("select 'ax' as tenant,version,data from ax_lunch_state union all select 'global',version,data from global_lunch_state union all select 'tmt',version,data from tmt_lunch_state")).rows,baseline.rows);
 assert.deepEqual((await db.admin.query("select 'ax' as tenant,id,pin_hash from ax_lunch_users union all select 'global',id,pin_hash from global_lunch_users union all select 'tmt',id,pin_hash from tmt_lunch_users")).rows,accounts.rows);
 for(const tenant of ['ax','global','tmt']){
  const info=await db.rpc(tenant+'_lunch_tenant_info',{});assert.equal(info.endDate,null);
  const snap=await db.rpc(tenant+'_lunch_snapshot',{p_token_hash:'',p_cron:true});assert.ok(snap.dates.includes('2026-12-01'));assert.ok(snap.dates.length<200);
  const roster=(await db.admin.query(`select id from ${tenant}_lunch_roster order by id limit 1`)).rows[0];
  snap.state.choices['2026-12-01']={[roster.id]:{status:'join',meal:'any'}};
  assert.equal(await db.rpc(tenant+'_lunch_commit_state',{p_token_hash:'',p_expected_version:snap.version,p_data:snap.state,p_write_dates:['2026-12-01'],p_cron:true}),true);
  assert.equal((await db.rpc(tenant+'_lunch_snapshot',{p_token_hash:'',p_cron:true})).state.choices['2026-12-01'][roster.id].status,'join');
  const permissions=(await db.admin.query(`select has_function_privilege('anon','${tenant}_lunch_snapshot(text,boolean)','execute') as rpc,has_table_privilege('service_role','${tenant}_lunch_settings','select') as direct`)).rows[0];assert.deepEqual(permissions,{rpc:false,direct:false});
 }
 const tmtSnapshot=await db.rpc('tmt_lunch_snapshot',{p_token_hash:'',p_cron:true});
 const {TMT_ROSTER}=await import('../lib/backend/tmt-roster.ts');
 await assert.rejects(db.rpc('tmt_lunch_admin_rematch',{p_actor_token:digest('tmt:'+TMT_ROSTER[0].id),p_expected_version:tmtSnapshot.version,p_date:'2026-12-01',p_groups:[]}),e=>e.code==='LN409');
 await db.admin.query("update tmt_lunch_settings set end_date='2026-11-30'");
 await assert.rejects(db.rpc('tmt_lunch_commit_state',{p_token_hash:'',p_expected_version:tmtSnapshot.version,p_data:tmtSnapshot.state,p_write_dates:['2026-12-01'],p_cron:true}),e=>e.code==='LN400');
 await db.admin.query('update tmt_lunch_settings set end_date=null');
 const {rows:[{dates}]}=await db.admin.query("select lunch_operation_private.calendar_dates('2026-10-22',null,'2026-12-31T23:59:00+09:00') as dates");
 assert.ok(dates.includes('2027-01-01'));assert.equal(dates.at(-1),'2027-02-26');assert.ok(!dates.includes('2027-03-01'));
 const leap=(await db.admin.query("select lunch_operation_private.calendar_dates('2028-02-01',null,'2028-02-29T12:00:00+09:00') as dates")).rows[0].dates;assert.ok(leap.includes('2028-02-29'));assert.equal(leap.at(-1),'2028-04-28');
 const future=(await db.admin.query("select lunch_operation_private.calendar_dates('2039-12-01',null,'2040-01-01T00:00:00+09:00') as dates")).rows[0].dates;assert.ok(future.includes('2040-03-30'));assert.ok(!future.includes('2040-04-02'));
 const finite=(await db.admin.query("select lunch_operation_private.calendar_dates('2026-10-22','2026-11-30','2026-10-27T12:00:00+09:00') as dates")).rows[0].dates;assert.equal(finite.at(-1),'2026-11-30');
 const grants=(await db.admin.query("select has_schema_privilege('anon','lunch_operation_private','usage') as browser,has_function_privilege('service_role','lunch_operation_private.calendar_dates(date,date,timestamptz)','execute') as server")).rows[0];assert.deepEqual(grants,{browser:false,server:false});
});


test('Group Node pagination keeps exact totals, stable ordering and private-HQ isolation',async()=>{
 const owner=(await db.admin.query('select id from tmt_lunch_roster order by id limit 1')).rows[0].id;
 const {rows}=await db.admin.query("insert into group_node_meetups(title,description,category,min_people,visibility,created_by_tenant,created_by) select 'page QA '||i,'','food',2,case when i>25 then 'headquarters' else 'all' end,'tmt',$1 from generate_series(1,30) i returning id",[owner]);
 try{
  for(const row of rows)await db.admin.query('insert into group_node_dates(meetup_id,date) values($1,$2)',[row.id,date]);
  const group=(tenant,hash,offset)=>db.rpc('group_node_api',{p_tenant:tenant,p_token_hash:hash,p_action:'list',p_payload:{q:'page QA ',offset}});
  const first=await group('global',digest('group-global'),0),second=await group('global',digest('group-global'),20);
  assert.equal(first.total,25);assert.equal(first.meetups.length,20);assert.equal(second.total,25);assert.equal(second.meetups.length,5);
  assert.equal(new Set([...first.meetups,...second.meetups].map(m=>m.id)).size,25);assert.ok([...first.meetups,...second.meetups].every(m=>m.visibility==='all'));
  assert.deepEqual((await group('global',digest('group-global'),0)).meetups.map(m=>m.id),first.meetups.map(m=>m.id));
  assert.equal((await group('tmt',digest('tmt:'+owner),0)).total,30);
 }finally{await db.admin.query('delete from group_node_meetups where id=any($1::uuid[])',[rows.map(r=>r.id)]);}
});

test('persistent clubs remain active, convert past or future meetups without data loss and protect owner-managed membership',async()=>{
 const group=(tenant,hash,action,payload={})=>db.rpc('group_node_api',{p_tenant:tenant,p_token_hash:hash,p_action:action,p_payload:payload});
 const ax=(action,payload)=>group('ax',digest('group-ax'),action,payload),global=(action,payload)=>group('global',digest('group-global'),action,payload);
 const {TMT_ROSTER}=await import('../lib/backend/tmt-roster.ts');const tmt=(action,payload)=>group('tmt',digest('tmt:'+TMT_ROSTER[0].id),action,payload);
 const input={title:'club QA future',description:'모집글',category:'sports',minPeople:2,visibility:'all',dates:[{date,time:null}]};
 const ids=[];
 try{
  let future=await ax('create',input);ids.push(future.id);
  let past=await ax('create',{...input,title:'club QA past'});ids.push(past.id);
  past=await global('join',{id:past.id});past=await global('vote',{id:past.id,dateId:past.dates[0].id});past=await global('comment',{id:past.id,body:'기존 댓글 보존'});
  await db.admin.query("update group_node_dates set date='2000-01-01' where meetup_id=$1",[past.id]);
  await db.admin.query("update group_node_meetups set status='confirmed',confirmed_date_id=$2 where id=$1",[past.id,past.dates[0].id]);
  const baseline=(await db.admin.query('select jsonb_agg(to_jsonb(m) order by id) as data from group_node_meetups m')).rows[0].data;
  const lunch=(await db.admin.query("select 'ax' as tenant,version,data from ax_lunch_state union all select 'global',version,data from global_lunch_state union all select 'tmt',version,data from tmt_lunch_state")).rows;
  const sql=await fs.readFile('supabase/persistent-clubs.sql','utf8');await db.admin.query(sql);
  assert.deepEqual((await db.admin.query("select jsonb_agg(to_jsonb(m)-'kind' order by id) as data from group_node_meetups m")).rows[0].data,baseline);
  assert.equal((await ax('detail',{id:past.id})).kind,'one_off');
  assert.ok((await ax('list',{view:'past'})).meetups.some(m=>m.id===past.id));assert.ok(!(await ax('list',{})).meetups.some(m=>m.id===past.id));
  assert.ok((await ax('list',{})).meetups.some(m=>m.id===future.id));assert.ok(!(await ax('list',{view:'clubs'})).meetups.some(m=>m.id===future.id));
  await assert.rejects(global('convert_to_club',{id:past.id,version:past.version}),e=>e.status===403);
  await assert.rejects(ax('convert_to_club',{id:past.id,version:past.version+1}),e=>e.status===409);
  past=await ax('convert_to_club',{id:past.id,version:past.version});assert.equal(past.kind,'club');assert.equal(past.status,'confirmed');assert.equal(past.participants.length,2);assert.equal(past.dates[0].date,'2000-01-01');assert.equal(past.dates[0].voters.length,1);assert.equal(past.comments[0].body,'기존 댓글 보존');
  assert.ok((await ax('list',{})).meetups.some(m=>m.id===past.id));assert.ok((await ax('list',{view:'clubs'})).meetups.some(m=>m.id===past.id));assert.ok(!(await ax('list',{view:'past'})).meetups.some(m=>m.id===past.id));
  past=await tmt('join',{id:past.id});assert.equal(past.participants.length,3);
  await assert.rejects(global('participant_roster',{id:past.id}),e=>e.status===403);
  const people=(await ax('participant_roster',{id:past.id})).people;assert.ok(people.some(p=>p.tenant==='tmt'&&p.id===TMT_ROSTER[1].id));
  past=await ax('add_participant',{id:past.id,version:past.version,tenant:'tmt',userId:TMT_ROSTER[1].id});assert.equal(past.participants.length,4);
  const version=past.version;past=await ax('add_participant',{id:past.id,version,tenant:'tmt',userId:TMT_ROSTER[1].id});assert.equal(past.version,version);assert.equal(past.participants.length,4);
  await assert.rejects(ax('add_participant',{id:past.id,version,tenant:'tmt',userId:'ffffffff-ffff-4fff-8fff-ffffffffffff'}),e=>e.status===400);
  await assert.rejects(global('add_participant',{id:past.id,version,tenant:'global',userId:people.find(p=>p.tenant==='global').id}),e=>e.status===403);
  await assert.rejects(tmt('vote',{id:past.id,dateId:past.dates[0].id}),e=>e.status===409);
  past=await ax('update',{...input,id:past.id,version:past.version,dates:past.dates.map(d=>({id:d.id,date:d.date,time:d.time}))});assert.equal(past.kind,'club');assert.equal(past.dates[0].voters.length,1);
  future=await ax('update',{...input,id:future.id,version:future.version,kind:'club',dates:future.dates.map(d=>({id:d.id,date:d.date,time:d.time}))});assert.equal(future.kind,'club');
  let club=await ax('create',{...input,title:'club QA no dates',kind:'club',dates:[]});ids.push(club.id);assert.equal(club.kind,'club');assert.deepEqual(club.dates,[]);
  club=await global('join',{id:club.id});assert.equal(club.participants.length,2);
  const privateClub=await ax('create',{...input,title:'club QA private',kind:'club',dates:[],visibility:'headquarters'});ids.push(privateClub.id);
  assert.ok((await ax('participant_roster',{id:privateClub.id})).people.every(p=>p.tenant==='ax'));
  await assert.rejects(ax('add_participant',{id:privateClub.id,version:privateClub.version,tenant:'tmt',userId:TMT_ROSTER[1].id}),e=>e.status===403);
  await assert.rejects(global('participant_roster',{id:privateClub.id}),e=>e.status===404);
  club=await ax('cancel',{id:club.id,version:club.version});assert.ok(!(await ax('list',{view:'clubs'})).meetups.some(m=>m.id===club.id));assert.ok((await ax('list',{view:'past'})).meetups.some(m=>m.id===club.id));
  assert.deepEqual((await db.admin.query("select 'ax' as tenant,version,data from ax_lunch_state union all select 'global',version,data from global_lunch_state union all select 'tmt',version,data from tmt_lunch_state")).rows,lunch);
  const saved=(await db.admin.query('select jsonb_agg(to_jsonb(m) order by id) as data from group_node_meetups m')).rows[0].data;await db.admin.query(sql);assert.deepEqual((await db.admin.query('select jsonb_agg(to_jsonb(m) order by id) as data from group_node_meetups m')).rows[0].data,saved);
 }finally{await db.admin.query('delete from group_node_meetups where id=any($1::uuid[])',[ids]);}
});

test('headquarters administrator accounts preserve participants, enforce DB roles and moderate all Group Node headquarters',async()=>{
 const {createApplication}=await import('../lib/backend/application.ts');
 const before=(await db.admin.query("select 'ax' as tenant,id,pin_hash from ax_lunch_users union all select 'global',id,pin_hash from global_lunch_users union all select 'tmt',id,pin_hash from tmt_lunch_users")).rows;
 const stateBefore=(await db.admin.query("select 'ax' as tenant,version,data from ax_lunch_state union all select 'global',version,data from global_lunch_state union all select 'tmt',version,data from tmt_lunch_state")).rows;
 // Reproduce the extra constraints retained by the production Global cutover.
 await db.admin.query("alter table global_lunch_roster add constraint global_lunch_roster_class_name_check check(class_name in ('IOA','IPO'));alter table global_lunch_roster drop constraint global_lunch_roster_default_status_check;alter table global_lunch_roster add constraint global_lunch_roster_default_status_check check(default_status='unset')");
 const sql=await fs.readFile('supabase/headquarters-administrators.sql','utf8');await db.admin.query(sql);
 assert.deepEqual((await db.admin.query("select 'ax' as tenant,version,data from ax_lunch_state union all select 'global',version,data from global_lunch_state union all select 'tmt',version,data from tmt_lunch_state")).rows,stateBefore);
 assert.deepEqual((await db.admin.query("select 'ax' as tenant,u.id,u.pin_hash from ax_lunch_users u join ax_lunch_roster r on r.id=u.id where not r.is_admin union all select 'global',u.id,u.pin_hash from global_lunch_users u join global_lunch_roster r on r.id=u.id where not r.is_admin union all select 'tmt',u.id,u.pin_hash from tmt_lunch_users u join tmt_lunch_roster r on r.id=u.id where not r.is_admin")).rows,before);
 const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',AX_INVITE_CODE:'ax-admin-ci',GLOBAL_INVITE_CODE:'global-admin-ci',TMT_INVITE_CODE:'tmt-admin-ci',AX_ADMIN_SECRET:'ax-old-secret-at-least-32-characters',GLOBAL_ADMIN_SECRET:'global-old-secret-at-least-32-characters',TMT_ADMIN_SECRET:'tmt-old-secret-at-least-32-characters',CRON_SECRET:'ci',APP_ORIGIN:'https://lunch.test'};
 const app=createApplication({env,rpcFactory:()=>db.rpc});const cookies={};const hashes={};
 const call=(endpoint,tenant,body,cookie='')=>app.handle(endpoint,new Request('https://lunch.test/api/'+endpoint,{method:body?'POST':'GET',headers:{origin:'https://lunch.test','content-type':'application/json','x-lunch-tenant':tenant,cookie},...(body?{body:JSON.stringify(body)}:{})}));
 const testHash=await hashPin('246810');
 for(const [tenant,count] of [['ax',20],['global',20],['tmt',18]]){
  const r=await db.admin.query(`update ${tenant}_lunch_users set pin_hash=$1 where name='관리자' and pin_hash='!uninitialized!'`,[testHash]);assert.equal(r.rowCount,1);
  const unlock=await call('auth',tenant,{action:'unlock',invite:env[tenant.toUpperCase()+'_INVITE_CODE']});assert.equal(unlock.status,200);
  const roster=(await unlock.json()).people;assert.equal(roster.length,count+1);assert.equal(roster.at(-1).name,'관리자');assert.equal(roster.at(-1).isAdmin,true);
  const gate=unlock.headers.get('set-cookie').split(';')[0];assert.equal((await call('auth',tenant,{action:'register',name:'관리자',pin:'246810'},gate)).status,403);
  await assert.rejects(db.rpc(tenant+'_lunch_register',{p_name:'관리자',p_pin_hash:testHash,p_token_hash:digest('forged')}),e=>e.status===403);
  const login=await call('auth',tenant,{action:'login',name:'관리자',pin:'246810'},gate);assert.equal(login.status,200);assert.equal((await login.json()).user.isAdmin,true);
  cookies[tenant]=login.headers.get('set-cookie').split(';')[0];hashes[tenant]=digest(tenant==='ax'?cookies[tenant].split('=')[1]:tenant+':'+cookies[tenant].split('=')[1]);
  const snap=await call('state',tenant,undefined,cookies[tenant]);assert.equal(snap.status,200);const data=await snap.json();assert.equal(data.people.length,count);assert.ok(data.people.every(p=>!p.isAdmin));assert.ok(!Object.values(data.state.days).some(d=>d.groups.some(g=>g.members.some(p=>p.isAdmin))));
  assert.equal((await call('state',tenant,{dates:[date],choice:{status:'join',meal:'any'}},cookies[tenant])).status,403);
  assert.equal((await call('admin',tenant,{action:'check'},cookies[tenant])).status,200);assert.equal((await call('admin',tenant,{action:'status'},cookies[tenant])).status,200);
  assert.equal(await db.rpc(tenant+'_lunch_health',{}),true);
 }
 assert.equal((await call('state','global',undefined,cookies.ax.replace('ax_lunch_session','global_lunch_session'))).status,401);
 const c=await db.rpc('ax_lunch_credentials',{p_name:ROSTER[0].name});const raw='f'.repeat(64);await db.rpc('ax_lunch_open_session',{p_user_id:c.id,p_expected_hash:c.pin_hash,p_token_hash:digest(raw)});
 const normal='ax_lunch_session='+raw;assert.equal((await call('admin','ax',{action:'check',isAdmin:true},normal)).status,403);assert.equal((await call('admin','ax',{action:'check',key:env.AX_ADMIN_SECRET},normal)).status,200);
 await assert.rejects(db.admin.query('update ax_lunch_roster set is_admin=true where id=$1',[ROSTER[0].id]),e=>e.code==='23514');
 assert.equal((await call('admin','ax',{action:'reset_pin',name:ROSTER[1].name,newPin:'135790'},cookies.ax)).status,200);
 const group=(tenant,hash,action,payload={})=>db.rpc('group_node_api',{p_tenant:tenant,p_token_hash:hash,p_action:action,p_payload:payload});
 const global=(a,p)=>group('global',digest('group-global'),a,p),admin=(a,p)=>group('ax',hashes.ax,a,p),normalGroup=(a,p)=>group('ax',digest(raw),a,p);const ids=[];
 try{
  let m=await global('create',{kind:'club',title:'admin QA private',description:'original',category:'etc',minPeople:2,visibility:'headquarters',dates:[]});ids.push(m.id);
  m=await global('comment',{id:m.id,body:'original comment'});const comment=m.comments[0];
  assert.ok((await admin('list',{})).meetups.some(x=>x.id===m.id));await assert.rejects(normalGroup('detail',{id:m.id}),e=>e.status===404);
  m=await admin('detail',{id:m.id});const originalProposer=m.proposer;
  m=await admin('update',{id:m.id,version:m.version,kind:'club',title:m.title,description:'moderated',category:'etc',minPeople:2,visibility:'headquarters',dates:[]});assert.equal(m.description,'moderated');assert.deepEqual(m.proposer,originalProposer);
  m=await admin('edit_comment',{id:m.id,commentId:comment.id,body:'moderated comment',expectedBody:comment.body});assert.equal(m.comments[0].body,'moderated comment');
  await assert.rejects(admin('edit_comment',{id:m.id,commentId:comment.id,body:'stale',expectedBody:comment.body}),e=>e.status===409);
  m=await admin('delete_comment',{id:m.id,commentId:comment.id});assert.equal(m.comments.length,0);
  const candidates=(await admin('participant_roster',{id:m.id})).people;assert.ok(candidates.every(p=>p.tenant==='global'&&p.name!=='관리자'));
  m=await admin('add_participant',{id:m.id,version:m.version,tenant:'global',userId:candidates[0].id});assert.equal(m.participants.length,2);
  await assert.rejects(admin('join',{id:m.id}),e=>e.status===403);
  const adminID=(await db.rpc('global_lunch_credentials',{p_name:'관리자'})).id;await assert.rejects(admin('add_participant',{id:m.id,version:m.version,tenant:'global',userId:adminID}),e=>e.status===400);
  const made=await admin('create',{kind:'club',title:'admin QA created',description:'',category:'etc',minPeople:2,visibility:'all',dates:[]});ids.push(made.id);assert.equal(made.participants.length,0);assert.equal(made.proposer.name,'관리자');
  assert.ok((await db.admin.query('select count(*)::int as n from lunch_admin_private.events')).rows[0].n>=4);
  const pins=(await db.admin.query("select id,pin_hash from ax_lunch_users where name='관리자' union all select id,pin_hash from global_lunch_users where name='관리자' union all select id,pin_hash from tmt_lunch_users where name='관리자'")).rows;await db.admin.query(sql);assert.deepEqual((await db.admin.query("select id,pin_hash from ax_lunch_users where name='관리자' union all select id,pin_hash from global_lunch_users where name='관리자' union all select id,pin_hash from tmt_lunch_users where name='관리자'")).rows,pins);
  assert.equal((await db.admin.query("select has_schema_privilege('anon','lunch_admin_private','usage') as allowed")).rows[0].allowed,false);
 }finally{await db.admin.query('delete from group_node_meetups where id=any($1::uuid[])',[ids]);}
});

test('all headquarters enforce four-person writes and rematches without rewriting historical five-person records',async()=>{
 const before=(await db.admin.query("select 'ax' as tenant,version,data from ax_lunch_state union all select 'global',version,data from global_lunch_state union all select 'tmt',version,data from tmt_lunch_state")).rows;
 const sql=await fs.readFile('supabase/four-person-matching.sql','utf8');await db.admin.query(sql);await db.admin.query(sql);
 assert.deepEqual((await db.admin.query("select 'ax' as tenant,version,data from ax_lunch_state union all select 'global',version,data from global_lunch_state union all select 'tmt',version,data from tmt_lunch_state")).rows,before);
 const future=(await db.admin.query("select to_char(d,'YYYY-MM-DD') as date from generate_series((current_date+interval '1 year')::date,(current_date+interval '1 year 7 days')::date,interval '1 day') d where extract(isodow from d)<6 order by d limit 1")).rows[0].date;
 for(const tenant of ['ax','global','tmt']){
  const snap=await db.rpc(tenant+'_lunch_snapshot',{p_token_hash:'',p_cron:true});
  const people=snap.people.slice(0,5);const proposed=structuredClone(snap.state);proposed.choices[future]=Object.fromEntries(people.map(p=>[p.id,{status:'join',meal:'lunchbox'}]));
  const group={id:'invalid-five',meal:'lunchbox',members:people};proposed.days[future]={phase:'matched',matchedAt:future+'T00:00:00+09:00',groups:[group]};
  await assert.rejects(db.rpc(tenant+'_lunch_commit_state',{p_token_hash:'',p_expected_version:snap.version,p_data:proposed,p_write_dates:[],p_cron:true}),e=>e.status===400);
  const valid=[{...group,id:'four',members:people.slice(0,4)},{...group,id:'one',members:people.slice(4)}];proposed.days[future].groups=valid;
  assert.equal(await db.rpc(tenant+'_lunch_commit_state',{p_token_hash:'',p_expected_version:snap.version,p_data:proposed,p_write_dates:[],p_cron:true}),true);
  const token=(await db.admin.query(`select s.token_hash from ${tenant}_lunch_sessions s join ${tenant}_lunch_roster r on r.id=s.user_id where not r.is_admin and s.expires_at>clock_timestamp() limit 1`)).rows[0].token_hash;
  const original=sql.match(new RegExp('create or replace function public\\.'+tenant+'_lunch_admin_rematch\\([\\s\\S]*?\\n\\$\\$;'))[0];
  try{
   await db.admin.query(original.replaceAll('clock_timestamp()',`'${future}T10:00:00+09:00'::timestamptz`));
   const current=await db.rpc(tenant+'_lunch_snapshot',{p_token_hash:'',p_cron:true});
   await assert.rejects(db.rpc(tenant+'_lunch_admin_rematch',{p_actor_token:token,p_expected_version:current.version,p_date:future,p_groups:[group]}),e=>e.status===400);
   assert.equal(await db.rpc(tenant+'_lunch_admin_rematch',{p_actor_token:token,p_expected_version:current.version,p_date:future,p_groups:valid}),true);
  }finally{await db.admin.query(original);}
  // A legacy five-person final result may remain while unrelated choices change.
  const historical='2026-01-05';await db.admin.query(`update ${tenant}_lunch_state set data=jsonb_set(data,array['days',$1],$2::jsonb,true)`,[historical,JSON.stringify({phase:'final',matchedAt:'2026-01-04T22:00:00+09:00',groups:[group]})]);
  const saved=await db.rpc(tenant+'_lunch_snapshot',{p_token_hash:'',p_cron:true});assert.equal(await db.rpc(tenant+'_lunch_commit_state',{p_token_hash:'',p_expected_version:saved.version,p_data:saved.state,p_write_dates:[],p_cron:true}),true);
  saved.state.days[historical].groups=valid;await assert.rejects(db.rpc(tenant+'_lunch_commit_state',{p_token_hash:'',p_expected_version:saved.version+1,p_data:saved.state,p_write_dates:[],p_cron:true}),e=>e.status===409);
 }
});
