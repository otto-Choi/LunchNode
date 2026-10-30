import {groupNodeRequest} from '../group-node/service.ts';
import {createBackend,type Rpc} from './service.ts';
import {supabaseRpc} from './supabase.ts';
import {tenantRpc,type AxNamespace} from './tenant-rpc.ts';
import {HEADQUARTERS,isHeadquarters,type HeadquartersId} from '../headquarters.ts';
import {isCohort,accountTenant} from '../cohorts.ts';
import {tenantConfig} from './tenant-config.ts';
import {ApiError,errorResponse,response,secretEqual} from './security.ts';
type Env=Record<string,string|undefined>;
type Endpoint='auth'|'state'|'profile'|'cron'|'health'|'admin'|'tenants'|'group-node';
export function createApplication({env,rpcFactory=supabaseRpc}:{env:Env;rpcFactory?:(url:string,key:string)=>Rpc}){
 const config=(id:HeadquartersId)=>({url:env.SUPABASE_URL||env.AX_SUPABASE_URL,key:env.SUPABASE_SERVICE_ROLE_KEY||env.AX_SUPABASE_SERVICE_ROLE_KEY,...(id==='ax'?{invite:env.AX_INVITE_CODE||env.INVITE_CODE,admin:env.AX_ADMIN_SECRET||env.ADMIN_SECRET}:{invite:env[`${id.toUpperCase()}_INVITE_CODE`],admin:env[`${id.toUpperCase()}_ADMIN_SECRET`]})});
 function validate(id:HeadquartersId){
  if(!tenantConfig(id).roster.length)throw new ApiError(503,'NOT_READY','본부 명단 준비 중입니다.');
  const c=config(id);if(!c.url||!c.key)throw new ApiError(503,'CONFIG','본부 DB 연결 설정이 필요합니다.');
  if(id!=='ax'){
   const others=HEADQUARTERS.filter(h=>h.id!==id).map(h=>config(h.id));
   if(!c.invite||!c.admin||c.admin.length<32||others.some(o=>o.invite===c.invite||o.admin===c.admin))throw new ApiError(503,'CONFIG','본부 전용 초대 코드와 별도의 32자 이상 운영자 키가 필요합니다.');
  }return c;
 }
 const available=(id:HeadquartersId)=>{try{validate(id);return true;}catch{return false;}};
 async function backend(id:HeadquartersId){
  const c=validate(id),rawRpc=rpcFactory(c.url!,c.key!);let axNamespace:AxNamespace='ax';let rpc=tenantRpc(rawRpc,id,axNamespace);let info:{tenant?:string;globalRosterRevision?:number;adminAccountsRevision?:number}|undefined;
  try{info=await rpc('lunch_tenant_info',{});}catch(error){
   // Only a genuinely absent function permits legacy access. Outages never switch namespaces.
   if(id!=='ax'||!(error instanceof ApiError)||error.code!=='RPC_MISSING')throw error;
   axNamespace='legacy';rpc=tenantRpc(rawRpc,id,axNamespace);
   try{info=await rpc('lunch_tenant_info',{});}catch(legacyError){if(!(legacyError instanceof ApiError)||legacyError.code!=='RPC_MISSING')throw legacyError;}
  }
  if(info&&info.tenant!==id)throw new ApiError(503,'TENANT','연결된 DB의 본부 설정이 일치하지 않습니다.');
  if(id!=='ax'&&!info)throw new ApiError(503,'TENANT','본부 DB 초기화가 필요합니다.');
  const t=tenantConfig(id);
  // Keep the old DB spelling usable until the atomic name correction is applied.
  const roster=id==='global'&&info?.globalRosterRevision!==1?t.roster.map(p=>p.name==='이은서'?{...p,name:'이윤서'}:p):t.roster;
  return {rpc,rawRpc,sessionCookieName:id==='ax'&&axNamespace==='legacy'?'lunch_session':`${id}_lunch_session`,service:createBackend({rpc,inviteCode:c.invite||'',adminSecret:c.admin||'',cronSecret:env.CRON_SECRET||'',origin:env.APP_ORIGIN||undefined,secureCookies:env.NODE_ENV==='production',tenantId:id,requireRosterGate:true,administratorEnabled:info?.adminAccountsRevision===1,roster,policy:t.policy,cookieStyle:id==='ax'&&axNamespace==='legacy'?'legacy':'namespaced'})};
 }

 async function handle(endpoint:Endpoint,request:Request){try{
  if(env.MAINTENANCE_MODE==='true')throw new ApiError(503,'MAINTENANCE','서비스 점검 중입니다. 잠시 후 다시 접속해 주세요.');
  const cohort=request.headers.get('x-lunch-cohort')||'36';if(!isCohort(cohort))throw new ApiError(400,'COHORT','사번을 선택해 주세요.');
  if(endpoint==='tenants'){
   if(request.method!=='GET')return response({error:'허용되지 않은 메서드입니다.'},405);
   return response({headquarters:HEADQUARTERS.map(h=>({...h,available:cohort==='36'?available(h.id):h.id==='ax'&&!!env.AX35_INVITE_CODE}))});
  }
  if(cohort!=='36'&&endpoint==='cron')throw new ApiError(403,'GROUP_ONLY','이 사번은 Group Node만 이용할 수 있습니다.');
  if(endpoint==='cron'){
   if(request.method!=='GET')return response({error:'허용되지 않은 메서드입니다.'},405);
   if(!env.CRON_SECRET||!secretEqual(request.headers.get('authorization')||'',`Bearer ${env.CRON_SECRET}`))throw new ApiError(401,'AUTH','인증이 필요합니다.');
   const ids=HEADQUARTERS.filter(h=>tenantConfig(h.id).roster.length&&(h.id==='ax'||config(h.id).invite||config(h.id).admin)).map(h=>h.id);
   const results:{id:string;ok:boolean;code?:string}[]=await Promise.all(ids.map(async id=>{
    let rpc:Rpc|undefined;
    try{const b=await backend(id);rpc=b.rpc;const result=await b.service.handle('cron',request);if(!result.ok)throw new ApiError(result.status,'JOB','자동 작업에 실패했습니다.');
     try{await rpc('lunch_record_job',{p_ok:true,p_code:null});}catch{/* Legacy AX DB remains operational before the additive migration. */}
     return {id,ok:true};
    }catch(error){const code=error instanceof ApiError?error.code:'INTERNAL';if(rpc)try{await rpc('lunch_record_job',{p_ok:false,p_code:code});}catch{}
     console.error('LunchNode scheduled job failed',{headquarters:id,code});return {id,ok:false,code};}
   }));if(env.AX35_INVITE_CODE){try{const c=config('ax');await rpcFactory(c.url!,c.key!)('ax35_group_cleanup',{});results.push({id:'ax35',ok:true});}catch{results.push({id:'ax35',ok:false,code:'CLEANUP'});}}return response({ok:results.every(r=>r.ok),results},results.every(r=>r.ok)?200:503);
  }
  const raw=request.headers.get('x-lunch-tenant')||'ax';if(!isHeadquarters(raw))throw new ApiError(400,'TENANT','본부를 선택해 주세요.');
  if(cohort!=='36'){
   const tenant=accountTenant(raw,cohort);if(!tenant)throw new ApiError(503,'NOT_READY','해당 사번의 본부는 준비 중입니다.');
   const url=env.SUPABASE_URL||env.AX_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY||env.AX_SUPABASE_SERVICE_ROLE_KEY;
   if(!url||!key||!env.AX35_INVITE_CODE)throw new ApiError(503,'CONFIG','사번 연결 설정이 필요합니다.');
   const rawRpc=rpcFactory(url,key);const rpc:Rpc=(name,args)=>{if(!/^lunch_[a-z_]+$/.test(name))throw new Error('Invalid group auth RPC');return rawRpc(name.replace(/^lunch_/,tenant+'_group_'),args);};
   if(endpoint==='group-node')return await groupNodeRequest(request,{rpc:rawRpc,tenant,cookieName:tenant+'_lunch_session',origin:env.APP_ORIGIN,limit:rpc});
   return await createBackend({rpc,inviteCode:env.AX35_INVITE_CODE,cronSecret:'',origin:env.APP_ORIGIN,secureCookies:env.NODE_ENV==='production',tenantId:tenant,cookieStyle:'namespaced',requireRosterGate:true,freeNames:true,groupOnly:true,roster:[]}).handle(endpoint,request);
  }
  const b=await backend(raw);
  if(endpoint==='group-node')return await groupNodeRequest(request,{rpc:b.rawRpc,tenant:raw,cookieName:b.sessionCookieName,origin:env.APP_ORIGIN,limit:b.rpc});
  return await b.service.handle(endpoint,request);
 }catch(error){return errorResponse(error);}}
 return {handle};
}
