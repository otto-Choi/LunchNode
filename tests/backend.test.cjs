const {test}=require('node:test');
const assert=require('node:assert/strict');
const ready=Promise.all([import('../lib/backend/service.ts'),import('../lib/backend/security.ts'),import('../lib/backend/supabase.ts'),import('../lib/roster.ts'),import('../lib/domain.ts')]);
async function fixture(){
 const [{createBackend},{ApiError,digest,verifyPin},{supabaseRpc},{ROSTER},{weekdays}]=await ready;
 const users=new Map(),sessions=new Map(),buckets=new Map();let now='2026-10-21T12:00:00+09:00',version=0,state={choices:{},days:{},events:[]};
 const copy=x=>structuredClone(x),dates=weekdays('2026-10-22','2026-11-03');
 const auth=hash=>{const s=sessions.get(hash);if(!s||new Date(s.expires)<=new Date(now))throw new ApiError(401,'AUTH','로그인이 필요합니다.');return users.get(s.id);};
 const rpc=async(name,a)=>{
  switch(name){
   case 'lunch_rate_limit':{const n=(buckets.get(a.p_key)||0)+1;buckets.set(a.p_key,n);return n<=a.p_limit;}
   case 'lunch_identity':{try{return copy(auth(a.p_token_hash).person);}catch{return null;}}
   case 'lunch_register':{const p=ROSTER.find(p=>p.name===a.p_name);if(!p)throw new ApiError(400,'ROSTER','명단 밖');if(users.has(p.id))throw new ApiError(409,'DUPLICATE','이미 등록');users.set(p.id,{person:copy(p),pin_hash:a.p_pin_hash});sessions.set(a.p_token_hash,{id:p.id,expires:new Date(new Date(now).getTime()+21*86400000).toISOString()});return copy(p);}
   case 'lunch_credentials':{const u=[...users.values()].find(u=>u.person.name===a.p_name);return u?{id:u.person.id,pin_hash:u.pin_hash,user:copy(u.person)}:null;}
   case 'lunch_open_session':{const u=users.get(a.p_user_id);if(u.pin_hash!==a.p_expected_hash)throw new ApiError(401,'STALE','PIN changed');sessions.set(a.p_token_hash,{id:u.person.id,expires:new Date(new Date(now).getTime()+21*86400000).toISOString()});return copy(u.person);}
   case 'lunch_end_session':sessions.delete(a.p_token_hash);return true;
   case 'lunch_change_pin':{const u=auth(a.p_token_hash);if(u.pin_hash!==a.p_expected_hash)throw new ApiError(401,'STALE','PIN changed');u.pin_hash=a.p_new_hash;for(const [key,s]of sessions)if(s.id===u.person.id)sessions.delete(key);return true;}
   case 'lunch_snapshot':return {version,state:copy(state),user:a.p_cron?null:copy(auth(a.p_token_hash).person),people:copy(ROSTER),dates,now};
   case 'lunch_commit_state':{
    if(!a.p_cron)auth(a.p_token_hash);if(a.p_expected_version!==version)return false;
    for(const date of a.p_write_dates)if(new Date(now)>=new Date(`${date}T11:00:00+09:00`))throw new ApiError(409,'CLOSED','오전 11시 마감');
    for(const [date,day]of Object.entries(state.days))if(day.phase==='final'&&JSON.stringify(a.p_data.days[date])!==JSON.stringify(day))throw new ApiError(409,'FINAL','확정 기록');
    state=copy(a.p_data);version++;return true;
   }
   case 'lunch_admin_rematch':{
    auth(a.p_actor_token);if(version!==a.p_expected_version)return false;
    if(new Date(now)>=new Date(`${a.p_date}T11:00:00+09:00`)||state.days[a.p_date]?.phase==='final')throw new ApiError(409,'CLOSED','마감');
    state.days[a.p_date]={...state.days[a.p_date],groups:copy(a.p_groups),rematchedAt:now};version++;return true;
   }
   case 'lunch_admin_recover_log':auth(a.p_actor_token);return true;
   case 'lunch_admin_account':{auth(a.p_actor_token);const u=[...users.values()].find(u=>u.person.name===a.p_target_name);if(!u)throw new ApiError(400,'TARGET','未登録');if(a.p_new_hash)u.pin_hash=a.p_new_hash;for(const [key,session]of sessions)if(session.id===u.person.id)sessions.delete(key);return true;}
   case 'lunch_cleanup':for(const [key,s]of sessions)if(new Date(s.expires)<=new Date(now))sessions.delete(key);return true;
   case 'lunch_health':return true;
   default:throw new Error('Unexpected RPC '+name);
  }
 };
 const options={rpc,inviteCode:'test-invitation',cronSecret:'test-cron-secret',adminSecret:'test-admin-secret-32-characters-long',secureCookies:true,retryDelay:async()=>{}};
 const backend=createBackend(options);
 const request=(path,body,cookie='',headers={})=>new Request('https://lunch.test/api/'+path,{method:body===undefined?'GET':'POST',headers:{origin:'https://lunch.test','content-type':'application/json',...(cookie?{cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const send=(endpoint,body,cookie='',headers={})=>backend.handle(endpoint,request(endpoint,body,cookie,headers));
 async function register(person=ROSTER[0]){const r=await send('auth',{action:'register',name:person.name,pin:'123456',invite:options.inviteCode});assert.equal(r.status,200,await r.clone().text());return r.headers.get('set-cookie').split(';')[0];}
 return {send,register,ROSTER,users,sessions,buckets,digest,verifyPin,request,ApiError,supabaseRpc,createBackend,options,rpc,getState:()=>copy(state),setNow:s=>{now=s;}};
}

test('registration binds roster identity, hashes PIN and stores only a hashed secure cookie token',async()=>{
 const f=await fixture();const cookie=await f.register();const [stored]=f.users.values();assert.notEqual(stored.pin_hash,'123456');assert.ok(await f.verifyPin('123456',stored.pin_hash));
 assert.ok(f.sessions.has(f.digest(cookie.split('=')[1])));assert.ok(!f.sessions.has(cookie.split('=')[1]));
 const login=await f.send('auth',{action:'login',name:f.ROSTER[0].name,pin:'123456'});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Lax; Max-Age=1814400; Secure/);assert.equal(login.headers.get('cache-control'),'no-store, private');
 const repeated=await f.send('auth',{action:'register',name:f.ROSTER[0].name,pin:'123456',invite:'test-invitation'});assert.equal(repeated.status,409);
});
test('unknown names, spoofed affiliation, bad invitation and malformed PIN are rejected',async()=>{
 const f=await fixture();for(const [body,status]of [[{name:'홍길동'},400],[{className:'5반'},400],[{invite:'bad'},403],[{pin:123456},400]]){const r=await f.send('auth',{action:'register',name:f.ROSTER[0].name,pin:'123456',invite:'test-invitation',...body});assert.equal(r.status,status);}
 assert.equal(f.users.size,0);
});
test('bad PIN, expired sessions, logout and PIN change revoke authentication',async()=>{
 const f=await fixture();const first=await f.register();const bad=await f.send('auth',{action:'login',name:f.ROSTER[0].name,pin:'000000'});assert.equal(bad.status,401);
 const login=await f.send('auth',{action:'login',name:f.ROSTER[0].name,pin:'123456'});const second=login.headers.get('set-cookie').split(';')[0];
 const change=await f.send('profile',{currentPin:'123456',newPin:'654321'},first);assert.equal(change.status,200);assert.match(change.headers.get('set-cookie'),/Max-Age=0/);
 for(const cookie of [first,second])assert.equal((await f.send('state',undefined,cookie)).status,401);
 const newer=await f.send('auth',{action:'login',name:f.ROSTER[0].name,pin:'654321'});assert.equal(newer.status,200);const cookie=newer.headers.get('set-cookie').split(';')[0];
 f.setNow('2026-12-01T12:00:00+09:00');assert.equal((await f.send('state',undefined,cookie)).status,401);
 assert.equal((await f.send('auth',{action:'logout'},cookie)).status,200);
});
test('same-office registration works for all 20; simultaneous choices are not lost',async()=>{
 const f=await fixture();const cookies=await Promise.all(f.ROSTER.map(p=>f.register(p)));
 const responses=await Promise.all(cookies.map(cookie=>f.send('state',{dates:['2026-10-22'],choice:{status:'join',meal:'any'},userId:f.ROSTER[0].id},cookie)));
 assert.ok(responses.every(r=>r.status===200));assert.equal(Object.values(f.getState().choices['2026-10-22']).filter(c=>c.status==='join').length,20);
});
test('December defaults and cancellations, bulk atomicity, weekend and outside dates',async()=>{
 const f=await fixture();const hire=f.ROSTER.at(-1),cookie=await f.register(hire);
 const data=await (await f.send('state',undefined,cookie)).json();assert.ok(data.dates.every(d=>data.state.choices[d][hire.id].status==='absent'));
 for(const status of ['join','unset'])assert.equal((await f.send('state',{dates:['2026-11-02','2026-11-03'],choice:{status,meal:'any'}},cookie)).status,200);
 assert.equal(f.getState().choices['2026-11-03'][hire.id].status,'absent');
 const before=f.getState();for(const date of ['2026-10-24','2026-11-04'])assert.equal((await f.send('state',{dates:['2026-11-02',date],choice:{status:'join',meal:'any'}},cookie)).status,400);assert.deepEqual(f.getState(),before);
});
test('cutoff, repeated cron, late cancellation and immutable final snapshots',async()=>{
 const f=await fixture();const cookie=await f.register();await f.send('state',{dates:['2026-10-22'],choice:{status:'join',meal:'any'}},cookie);
 const cron=()=>f.send('cron',undefined,'',{authorization:'Bearer test-cron-secret'});
 assert.equal((await f.send('cron')).status,401);f.setNow('2026-10-21T22:00:00+09:00');assert.equal((await cron()).status,200);const groups=f.getState().days['2026-10-22'].groups;await cron();assert.deepEqual(f.getState().days['2026-10-22'].groups,groups);
 f.setNow('2026-10-22T11:00:00+09:00');await cron();const before=f.getState();assert.equal(before.days['2026-10-22'].phase,'final');
 assert.equal((await f.send('state',{dates:['2026-10-22','2026-10-23'],choice:{status:'absent',meal:'any'}},cookie)).status,409);assert.deepEqual(f.getState(),before);
});
test('cross-origin, invalid content, oversized body and unauthenticated writes fail safely',async()=>{
 const f=await fixture();const cookie=await f.register();
 assert.equal((await f.send('state',{dates:['2026-10-22'],choice:{status:'join',meal:'any'}},cookie,{origin:'https://evil.test'})).status,403);
 assert.equal((await f.send('state',{},cookie,{'content-type':'text/plain'})).status,415);
 assert.equal((await f.send('state',{payload:'x'.repeat(9000)},cookie)).status,413);
 assert.equal((await f.send('state',{})).status,401);
 const malformed=new Request('https://lunch.test/api/state',{method:'POST',headers:{origin:'https://lunch.test','content-type':'application/json',cookie},body:'{'});assert.equal((await f.createBackend(f.options).handle('state',malformed)).status,400);
});
test('account throttling returns 429 while shared IP permits different users',async()=>{
 const f=await fixture();await f.register();let last;for(let i=0;i<8;i++)last=await f.send('auth',{action:'login',name:f.ROSTER[0].name,pin:'000000'});assert.equal(last.status,429);
 assert.ok(await f.register(f.ROSTER[1]));
});
test('bounded CAS retry reports conflict instead of claiming a failed save succeeded',async()=>{
 const f=await fixture();const cookie=await f.register();let attempts=0;const backend=f.createBackend({...f.options,rpc:async(n,a)=>n==='lunch_commit_state'?(attempts++,false):f.rpc(n,a)});
 const r=await backend.handle('state',f.request('state',{dates:['2026-10-22'],choice:{status:'join',meal:'any'}},cookie));assert.equal(r.status,409);assert.equal(attempts,24);assert.equal((await r.json()).code,'BUSY');
});
test('Supabase gateway returns safe errors and does not reveal credentials or raw DB messages',async()=>{
 const f=await fixture();const rpc=f.supabaseRpc('https://project.supabase.co','do-not-leak',async()=>Response.json({code:'42P01',message:'private table password'},{status:400}));
 await assert.rejects(rpc('lunch_health',{}),e=>e.status===503&&!e.message.includes('private'));
 const conflict=f.supabaseRpc('https://project.supabase.co','secret',async()=>Response.json({code:'LN409',message:'마감'},{status:400}));await assert.rejects(conflict('lunch_commit_state',{}),e=>e.status===409);
 const unavailable=f.createBackend({...f.options,rpc:async()=>{throw new Error('password secret detail');}});const r=await unavailable.handle('health',f.request('health'));assert.equal(r.status,500);assert.ok(!(await r.text()).includes('secret'));
});

test('bulk attendance and absence update only selected dates and persist the selected menu',async()=>{
 const f=await fixture();const cookie=await f.register();const picked=['2026-10-22','2026-10-23','2026-11-02'];
 let result=await f.send('state',{dates:picked,choice:{status:'join',meal:'outside'}},cookie);assert.equal(result.status,200);
 let saved=await (await f.send('state',undefined,cookie)).json();for(const date of picked)assert.deepEqual(saved.state.choices[date][f.ROSTER[0].id],{status:'join',meal:'outside'});
 const untouched=saved.state.choices['2026-11-03'][f.ROSTER[0].id];
 result=await f.send('state',{dates:picked,choice:{status:'absent',meal:'any'}},cookie);assert.equal(result.status,200);
 saved=await (await f.send('state',undefined,cookie)).json();for(const date of picked)assert.equal(saved.state.choices[date][f.ROSTER[0].id].status,'absent');
 assert.deepEqual(saved.state.choices['2026-11-03'][f.ROSTER[0].id],untouched);
});

test('API accepts all five meal choices for individual and bulk saves without changing legacy values',async()=>{
 const f=await fixture();const cookie=await f.register();
 for(const meal of ['lunchbox','prefer_lunchbox','any','prefer_outside','outside']){
  const r=await f.send('state',{dates:['2026-10-22','2026-11-03'],choice:{status:'join',meal}},cookie);assert.equal(r.status,200);
  const saved=await (await f.send('state',undefined,cookie)).json();for(const date of ['2026-10-22','2026-11-03'])assert.equal(saved.state.choices[date][f.ROSTER[0].id].meal,meal);
 }
 assert.equal((await f.send('state',{dates:['2026-10-22'],choice:{status:'join',meal:'prefer'}},cookie)).status,400);
});


test('operator tools require session, same origin and separate key; reset PIN and preserve choices',async()=>{
 const f=await fixture(),actor=await f.register(),target=await f.register(f.ROSTER[1]);
 const key=f.options.adminSecret;const check={action:'check',key};
 assert.equal((await f.send('admin',check)).status,401);
 assert.equal((await f.send('admin',{...check,key:'test-invitation'},actor)).status,403);
 assert.equal((await f.send('admin',check,actor,{origin:'https://evil.test'})).status,403);
 assert.equal((await f.send('admin',check,actor)).status,200);
 await f.send('state',{dates:['2026-10-22'],choice:{status:'join',meal:'any'}},target);const before=f.getState();
 assert.equal((await f.send('admin',{key,action:'reset_pin',name:f.ROSTER[1].name,newPin:'654321'},actor)).status,200);
 assert.equal((await f.send('state',undefined,target)).status,401);assert.deepEqual(f.getState(),before);
 let login=await f.send('auth',{action:'login',name:f.ROSTER[1].name,pin:'654321'});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await f.send('admin',{key,action:'revoke',name:f.ROSTER[1].name},actor)).status,200);
 assert.equal((await f.send('state',undefined,cookie)).status,401);
 f.setNow('2026-10-22T11:00:00+09:00');assert.equal((await f.send('admin',{key,action:'recover'},actor)).status,200);
 const final=f.getState();assert.equal(final.days['2026-10-22'].phase,'final');
 assert.equal((await f.send('admin',{key,action:'recover'},actor)).status,200);assert.deepEqual(f.getState(),final);
 const disabled=f.createBackend({...f.options,adminSecret:''});assert.equal((await disabled.handle('admin',f.request('admin',check,actor))).status,503);
});


test('operator rematch includes late participants, preserves choices and history, rejects early and finalized days',async()=>{
 const f=await fixture();const cookies=await Promise.all(f.ROSTER.slice(0,8).map(p=>f.register(p)));const key=f.options.adminSecret,date='2026-10-22';
 const rematch=(body={},cookie=cookies[0])=>f.send('admin',{key,action:'rematch',date,...body},cookie);
 assert.equal((await rematch()).status,409);assert.equal((await rematch({date:'2026-10-24'})).status,400);
 for(const c of cookies.slice(0,3))await f.send('state',{dates:[date],choice:{status:'join',meal:'any'}},c);
 f.setNow('2026-10-21T22:00:00+09:00');await f.send('state',undefined,cookies[0]);
 for(const c of cookies.slice(3))await f.send('state',{dates:[date],choice:{status:'join',meal:'any'}},c);
 const before=f.getState();assert.deepEqual(before.days[date].groups.map(g=>g.members.length),[5,3]);
 assert.equal((await rematch({key:'bad'})).status,403);assert.equal((await rematch({},'')).status,401);
 assert.equal((await rematch()).status,200);let saved=f.getState();assert.deepEqual(saved.choices,before.choices);
 assert.deepEqual(saved.days[date].groups.map(g=>g.members.length),[4,4]);assert.equal(saved.days[date].phase,'matched');assert.ok(saved.days[date].rematchedAt);
 const ids=saved.days[date].groups.flatMap(g=>g.members.map(p=>p.id));assert.equal(new Set(ids).size,8);
 assert.equal((await rematch()).status,200);saved=f.getState();assert.equal(Object.keys(saved.days).length,1);
 f.setNow('2026-10-22T11:00:00+09:00');assert.equal((await rematch()).status,409);assert.deepEqual(f.getState(),saved);
 await f.send('state',undefined,cookies[0]);const final=f.getState();assert.equal(final.days[date].phase,'final');assert.equal((await rematch()).status,409);assert.deepEqual(f.getState(),final);
});

test('rematch retries from current attendance after a concurrent state write',async()=>{
 const f=await fixture(),actor=await f.register(),late=await f.register(f.ROSTER[1]),date='2026-10-22';
 await f.send('state',{dates:[date],choice:{status:'join',meal:'lunchbox'}},actor);f.setNow('2026-10-21T22:00:00+09:00');await f.send('state',undefined,actor);
 let conflicts=0;const backend=f.createBackend({...f.options,rpc:async(n,a)=>{
  if(n==='lunch_admin_rematch'&&conflicts++===0){await f.send('state',{dates:[date],choice:{status:'join',meal:'outside'}},late);return false;}return f.rpc(n,a);
 }});
 const result=await backend.handle('admin',f.request('admin',{key:f.options.adminSecret,action:'rematch',date},actor));assert.equal(result.status,200);assert.equal(conflicts,2);
 const groups=f.getState().days[date].groups;assert.equal(groups.flatMap(g=>g.members).length,2);for(const g of groups)for(const p of g.members)assert.equal(g.meal,p.id===f.ROSTER[0].id?'lunchbox':'outside');
});

test('tonight cron uses operational balancing without publishing demographic inputs',async()=>{
 const f=await fixture(),date='2026-10-23';const names=['권도영','김민국','김상규','유태상','김서영','손규영','안소이','김주연'];const cookies=await Promise.all(names.map(name=>f.register(f.ROSTER.find(p=>p.name===name))));
 await Promise.all(cookies.map(cookie=>f.send('state',{dates:[date],choice:{status:'join',meal:'any'}},cookie)));
 f.setNow('2026-10-22T21:59:59+09:00');const early=await (await f.send('state',undefined,cookies[0])).json();assert.equal(early.state.days[date],undefined);
 f.setNow('2026-10-22T22:00:00+09:00');const result=await f.send('cron',undefined,'',{authorization:'Bearer test-cron-secret'});assert.equal(result.status,200);
 const state=await (await f.send('state',undefined,cookies[0])).json();assert.equal(state.state.days[date].groups.length,2);const females=new Set(['김서영','손규영','안소이','김주연']);for(const group of state.state.days[date].groups){assert.equal(group.members.length,4);assert.equal(group.members.filter(p=>females.has(p.name)).length,2);}
 assert.ok(!JSON.stringify(state).includes('genderByName'));for(const person of state.people)assert.ok(!('gender' in person));
});

test('absence origin survives API reload and cannot be forged by incoming request metadata',async()=>{
 const f=await fixture(),person=f.ROSTER.at(-1),cookie=await f.register(person),date='2026-10-23';
 let saved=await (await f.send('state',undefined,cookie)).json();assert.equal(saved.state.choiceOrigins[date][person.id],'default');
 const result=await f.send('state',{dates:[date],choice:{status:'absent',meal:'prefer_outside',origin:'default'},choiceOrigins:{[date]:{[person.id]:'default'}}},cookie);assert.equal(result.status,200);
 saved=await (await f.send('state',undefined,cookie)).json();assert.equal(saved.state.choiceOrigins[date][person.id],'selected');assert.deepEqual(saved.state.choices[date][person.id],{status:'absent',meal:'prefer_outside'});
});

test('operator recovery rechecks the session before committing due work',async()=>{
 const f=await fixture(),cookie=await f.register();f.setNow('2026-10-22T11:00:00+09:00');
 const before=f.getState();let revoked=false;
 const backend=f.createBackend({...f.options,rpc:async(name,args)=>{
  const result=await f.rpc(name,args);
  if(name==='lunch_identity'&&!revoked){revoked=true;f.sessions.clear();}
  return result;
 }});
 const result=await backend.handle('admin',f.request('admin',{key:f.options.adminSecret,action:'recover'},cookie));
 assert.equal(result.status,401);assert.deepEqual(f.getState(),before);
});

test('first-day manual matching rejects requests before 22:00 without writing',async()=>{
 const f=await fixture(),cookie=await f.register();f.setNow('2026-10-21T21:59:59+09:00');
 const before=f.getState();const result=await f.send('admin',{key:f.options.adminSecret,action:'initial_match',date:'2026-10-22'},cookie);
 assert.equal(result.status,409);assert.equal((await result.json()).code,'NOT_MATCHED');assert.deepEqual(f.getState(),before);
});
