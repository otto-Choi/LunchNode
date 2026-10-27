const {test}=require('node:test');
const assert=require('node:assert/strict');
async function fixture(){
 const {ApiError}=await import('../lib/backend/security.ts');const calls=[];
 const {createApplication}=await import('../lib/backend/application.ts');
 const {ROSTER}=await import('../lib/roster.ts');const {GLOBAL_ROSTER}=await import('../lib/backend/global-roster.ts');
 const env={SUPABASE_URL:'https://ax.test',SUPABASE_SERVICE_ROLE_KEY:'ax-service',INVITE_CODE:'ax-code',ADMIN_SECRET:'ax-operator-key-longer-than-32-characters',GLOBAL_INVITE_CODE:'global-code',GLOBAL_ADMIN_SECRET:'global-operator-key-longer-than-32-characters',CRON_SECRET:'cron',APP_ORIGIN:'https://lunch.test'};
 const {TMT_ROSTER}=await import('../lib/backend/tmt-roster.ts');
 const stores={tmt:{people:TMT_ROSTER,tenant:'tmt'},ax:{people:ROSTER,tenant:'ax'},global:{people:GLOBAL_ROSTER,tenant:'global'}};
 for(const st of Object.values(stores))Object.assign(st,{users:new Map(),sessions:new Map(),state:{choices:{},days:{},events:[]},version:0,jobs:[]});
 const rpcFactory=(url,key)=>{assert.equal(url,'https://ax.test');assert.equal(key,'ax-service');return async(name,a)=>{calls.push(name);const isTmt=name.startsWith('tmt_lunch_');if(isTmt)name=name.slice(4);const isGlobal=name.startsWith('global_lunch_');if(!isGlobal&&name.startsWith('ax_')){if(stores.ax.legacy)throw new ApiError(503,'RPC_MISSING','Missing');name=name.slice(3);}const st=stores[isTmt?'tmt':isGlobal?'global':'ax'];if(isGlobal)name=name.slice(7);if(st.fail)throw Error('unavailable');switch(name){
 case 'lunch_tenant_info':return {tenant:st.tenant,...(isGlobal?{globalRosterRevision:st.rosterRevision??1}:{})};case 'lunch_rate_limit':return true;
 case 'lunch_identity':return st.sessions.get(a.p_token_hash)||null;
 case 'lunch_register':{const p=st.people.find(p=>p.name===a.p_name);st.users.set(p.id,p);st.sessions.set(a.p_token_hash,p);return p;}
 case 'lunch_snapshot':return {people:st.people,dates:['2026-10-26'],state:structuredClone(st.state),version:st.version,user:st.sessions.get(a.p_token_hash),now:'2026-10-23T12:00:00+09:00'};
 case 'lunch_commit_state':st.state=structuredClone(a.p_data);st.version++;return true;
 case 'lunch_cleanup':return true;case 'lunch_record_job':st.jobs.push(a.p_ok);return true;
 case 'lunch_system_status':return {tenant:st.tenant};default:throw Error(name);
 }}};
 const app=createApplication({env,rpcFactory});
 const call=(endpoint,tenant,body,cookie='',extra={})=>app.handle(endpoint,new Request('https://lunch.test/api/'+endpoint,{method:body?'POST':'GET',headers:{origin:'https://lunch.test','content-type':'application/json','x-lunch-tenant':tenant,cookie,...extra},...(body?{body:JSON.stringify(body)}:{})}));
 const unlock=async tenant=>{const r=await call('auth',tenant,{action:'unlock',invite:tenant+'-code'});assert.equal(r.status,200,await r.clone().text());return r.headers.get('set-cookie').split(';')[0];};
 return {env,stores,app,call,unlock,calls};
}
test('headquarters share one DB but require distinct invite and operator settings',async()=>{
 const f=await fixture();for(const key of ['GLOBAL_INVITE_CODE','GLOBAL_ADMIN_SECRET']){const previous=f.env[key];f.env[key]=f.env[{GLOBAL_SUPABASE_URL:'SUPABASE_URL',GLOBAL_INVITE_CODE:'INVITE_CODE',GLOBAL_ADMIN_SECRET:'ADMIN_SECRET'}[key]];const r=await f.call('auth','global',{action:'unlock',invite:'global-code'});assert.equal(r.status,503);f.env[key]=previous;}
 f.stores.global.tenant='ax';assert.equal((await f.call('auth','global',{action:'unlock',invite:'global-code'})).status,503);
});
test('invite gates never expose another headquarters roster',async()=>{
 const f=await fixture();assert.equal((await f.call('auth','global',{action:'roster'})).status,403);assert.equal((await f.call('auth','global',{action:'unlock',invite:'ax-code'})).status,403);
 const axGate=await f.unlock('ax'),globalGate=await f.unlock('global');assert.equal((await f.call('auth','global',{action:'roster'},axGate)).status,403);
 const r=await f.call('auth','global',{action:'roster'},globalGate);const data=await r.json();assert.equal(data.people.length,20);assert.ok(data.people.every(p=>['IOA','IPO'].includes(p.className)&&p.defaultStatus==='unset'));assert.ok(!JSON.stringify(data).includes('gender'));
});
test('sessions, choices, roster validation and operator keys stay within the selected headquarters',async()=>{
 const f=await fixture();const axGate=await f.unlock('ax'),globalGate=await f.unlock('global');
 const ax=await f.call('auth','ax',{action:'register',name:'권도영',pin:'123456'},axGate);assert.equal(ax.status,200);const axCookie=ax.headers.get('set-cookie').split(';')[0];
 const global=await f.call('auth','global',{action:'register',name:'박인홍',pin:'123456'},globalGate);assert.equal(global.status,200);const globalCookie=global.headers.get('set-cookie').split(';')[0];
 assert.match(globalCookie,/^global_lunch_session=/);assert.match(axCookie,/^ax_lunch_session=/);
 const copied=axCookie.replace('ax_lunch_session=','global_lunch_session=');assert.equal((await f.call('state','global',undefined,copied)).status,401);
 assert.equal((await f.call('auth','global',{action:'register',name:'최철원',pin:'123456'},globalGate)).status,400);
 const write=await f.call('state','global',{dates:['2026-10-26'],choice:{status:'join',meal:'prefer_outside'}},globalCookie);assert.equal(write.status,200,await write.clone().text());assert.equal(Object.keys(f.stores.ax.state.choices).length,0);
 assert.equal((await f.call('admin','global',{action:'status',key:f.env.ADMIN_SECRET},globalCookie)).status,403);
 assert.equal((await f.call('admin','global',{action:'status',key:f.env.GLOBAL_ADMIN_SECRET},globalCookie)).status,200);
});
test('one headquarters job failure cannot prevent the other job from completing',async()=>{
 const f=await fixture();f.stores.global.fail=true;const r=await f.call('cron','ax',undefined,'',{authorization:'Bearer cron'});assert.equal(r.status,503);const body=await r.json();assert.deepEqual(body.results.map(r=>[r.id,r.ok]),[['ax',true],['global',false]]);assert.deepEqual(f.stores.ax.jobs,[true]);
});

test('obsolete Global connection variables cannot route requests to another database',async()=>{const f=await fixture();f.env.GLOBAL_SUPABASE_URL='https://wrong.test';f.env.GLOBAL_SUPABASE_SERVICE_ROLE_KEY='wrong-key';await f.unlock('global');});

test('AX stays on legacy tables until the rename, then uses the namespaced cookies and functions',async()=>{
 const f=await fixture();f.stores.ax.legacy=true;const gate=await f.unlock('ax');
 const registered=await f.call('auth','ax',{action:'register',name:'권도영',pin:'123456'},gate);assert.equal(registered.status,200);assert.match(registered.headers.get('set-cookie'),/^lunch_session=/);
 assert.ok(f.calls.includes('lunch_register'));f.stores.ax.legacy=false;f.calls.length=0;await f.unlock('ax');assert.ok(f.calls.includes('ax_lunch_tenant_info'));assert.ok(!f.calls.includes('lunch_tenant_info'));
});
test('an AX database outage never falls back to a second namespace',async()=>{
 const f=await fixture();f.stores.ax.fail=true;assert.equal((await f.call('state','ax')).status,500);assert.deepEqual(f.calls,['ax_lunch_tenant_info']);
});
test('maintenance blocks logins, state writes, operator actions and cron before touching the DB',async()=>{
 const f=await fixture();f.env.MAINTENANCE_MODE='true';
 for(const endpoint of ['auth','state','admin','profile','cron','tenants']){const result=await f.call(endpoint,'ax',endpoint==='state'?{dates:[],choice:{status:'join',meal:'any'}}:undefined);assert.equal(result.status,503);assert.equal((await result.json()).code,'MAINTENANCE');}
 assert.equal(f.calls.length,0);
});

test('Global roster correction supports both the pre-SQL and corrected DB without a roster outage',async()=>{
 const f=await fixture();f.stores.global.rosterRevision=0;
 f.stores.global.people=f.stores.global.people.map(p=>p.name==='이은서'?{...p,name:'이윤서'}:p);
 const gate=await f.unlock('global');
 let people=(await (await f.call('auth','global',{action:'roster'},gate)).json()).people;
 assert.ok(people.some(p=>p.name==='이윤서'));
 const login=await f.call('auth','global',{action:'register',name:'박인홍',pin:'123456'},gate);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await f.call('state','global',undefined,cookie)).status,200);
 f.stores.global.rosterRevision=1;f.stores.global.people=f.stores.global.people.map(p=>p.name==='이윤서'?{...p,name:'이은서'}:p);
 people=(await (await f.call('auth','global',{action:'roster'},gate)).json()).people;
 assert.ok(people.some(p=>p.name==='이은서'));assert.ok(!people.some(p=>p.name==='이윤서'));
 assert.equal((await f.call('state','global',undefined,cookie)).status,200);
});


test('TMT isolated registration, cookies, choices, secrets and scheduled jobs',async()=>{
 const f=await fixture();assert.equal((await f.call('state','tmt')).status,503);
 f.env.TMT_INVITE_CODE='TMT36';f.env.TMT_ADMIN_SECRET='tmt-operator-key-longer-than-32-characters';
 const gateResponse=await f.call('auth','tmt',{action:'unlock',invite:'TMT36'});assert.equal(gateResponse.status,200);
 const gate=gateResponse.headers.get('set-cookie').split(';')[0];assert.match(gate,/^tmt_lunch_roster=/);
 const roster=(await gateResponse.json()).people;assert.equal(roster.length,18);assert.equal(roster.filter(p=>p.className==='TMT Tech').length,8);assert.equal(roster.filter(p=>p.className==='TMT ICT').length,10);
 const denied=await f.call('auth','tmt',{action:'unlock',invite:'global-code'});assert.equal(denied.status,403);
 const registered=await f.call('auth','tmt',{action:'register',name:'김수연',pin:'123456'},gate);assert.equal(registered.status,200);
 const cookie=registered.headers.get('set-cookie').split(';')[0];assert.match(cookie,/^tmt_lunch_session=/);
 assert.equal((await f.call('state','global',undefined,cookie.replace('tmt_lunch_session','global_lunch_session'))).status,401);
 assert.equal((await f.call('auth','tmt',{action:'register',name:'류지환',pin:'123456'},gate)).status,400);
 assert.equal((await f.call('state','tmt',{dates:['2026-10-26'],choice:{status:'join',meal:'any'}},cookie)).status,200);
 assert.deepEqual(f.stores.ax.state.choices,{});assert.deepEqual(f.stores.global.state.choices,{});
 assert.equal((await f.call('admin','tmt',{action:'status',key:f.env.ADMIN_SECRET},cookie)).status,403);
 const jobs=await (await f.call('cron','ax',undefined,'',{authorization:'Bearer cron'})).json();assert.deepEqual(jobs.results.map(r=>r.id),['ax','global','tmt']);assert.ok(jobs.results.every(r=>r.ok));
 const {tenantConfig}=await import('../lib/backend/tenant-config.ts');assert.deepEqual(tenantConfig('tmt').policy.genderByName,{});assert.equal(tenantConfig('tmt').policy.balanceClasses,true);
 f.env.TMT_ADMIN_SECRET=f.env.GLOBAL_ADMIN_SECRET;assert.equal((await f.call('state','tmt',undefined,cookie)).status,503);
});
