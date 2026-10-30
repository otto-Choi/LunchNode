const {test}=require('node:test');const assert=require('node:assert/strict');
test('non-36 callers cannot invoke lunch mutations, operator recovery or cron even when they supply arbitrary bodies',async()=>{
 const {createApplication}=await import('../lib/backend/application.ts');const calls=[];
 const app=createApplication({env:{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',AX35_INVITE_CODE:'AX35'},rpcFactory:()=>async(name,args)=>{calls.push(name);return {id:'35',name:'테스트',className:'35사번'};}});
 for(const endpoint of ['state','admin','cron']){
  const r=await app.handle(endpoint,new Request('https://test/api/'+endpoint,{method:endpoint==='cron'?'GET':'POST',headers:{'x-lunch-tenant':'ax','x-lunch-cohort':'35','content-type':'application/json'},...(endpoint==='cron'?{}:{body:JSON.stringify({action:'recover',cohort:'36',dates:['2026-11-02'],choice:{status:'join',meal:'any'}})})}));
  assert.equal(r.status,403);assert.equal((await r.json()).code,'GROUP_ONLY');
 }
 assert.deepEqual(calls,[]);
 const r=await app.handle('state',new Request('https://test/api/state',{headers:{'x-lunch-tenant':'ax','x-lunch-cohort':'35',cookie:'ax35_lunch_session='+'a'.repeat(64)}}));assert.equal(r.status,200);assert.equal((await r.json()).groupOnly,true);assert.deepEqual(calls,['ax35_group_identity']);
});
test('unknown cohorts are rejected before database access rather than inheriting 36 permissions',async()=>{
 const {createApplication}=await import('../lib/backend/application.ts');const app=createApplication({env:{},rpcFactory:()=>{throw Error('must not run');}});
 const r=await app.handle('state',new Request('https://test/api/state',{headers:{'x-lunch-cohort':'37'}}));assert.equal(r.status,400);assert.equal((await r.json()).code,'COHORT');
});
