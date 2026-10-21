import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {databasePools} from './postgres-rpc.mjs';
import {createBackend} from '../lib/backend/service.ts';
import {hashPin,digest} from '../lib/backend/security.ts';
import {ROSTER} from '../lib/roster.ts';
const db=databasePools();after(()=>db.close());
const files=(await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
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
