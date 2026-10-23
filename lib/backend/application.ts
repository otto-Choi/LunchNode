import {createBackend,type Rpc} from './service.ts';
import {supabaseRpc} from './supabase.ts';
import {HEADQUARTERS,isHeadquarters,type HeadquartersId} from '../headquarters.ts';
import {tenantConfig} from './tenant-config.ts';
import {ApiError,errorResponse,response,secretEqual} from './security.ts';
type Env=Record<string,string|undefined>;
type Endpoint='auth'|'state'|'profile'|'cron'|'health'|'admin'|'tenants';
export function createApplication({env,rpcFactory=supabaseRpc}:{env:Env;rpcFactory?:(url:string,key:string)=>Rpc}){
 const config=(id:HeadquartersId)=>id==='ax'?{url:env.AX_SUPABASE_URL||env.SUPABASE_URL,key:env.AX_SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_ROLE_KEY,invite:env.AX_INVITE_CODE||env.INVITE_CODE,admin:env.AX_ADMIN_SECRET||env.ADMIN_SECRET}:{url:env.GLOBAL_SUPABASE_URL,key:env.GLOBAL_SUPABASE_SERVICE_ROLE_KEY,invite:env.GLOBAL_INVITE_CODE,admin:env.GLOBAL_ADMIN_SECRET};
 const normalize=(url:string)=>new URL(url).origin;
 function validate(id:HeadquartersId){const c=config(id);if(!c.url||!c.key)throw new ApiError(503,'CONFIG','본부 DB 연결 설정이 필요합니다.');
  if(id==='global'){
   const ax=config('ax');if(ax.url&&normalize(c.url)===normalize(ax.url))throw new ApiError(503,'CONFIG','Global에는 AX Node와 다른 Supabase 프로젝트가 필요합니다.');
   if(!c.invite||c.invite===ax.invite||!c.admin||c.admin.length<32||c.admin===ax.admin)throw new ApiError(503,'CONFIG','Global 전용 초대 코드와 별도의 32자 이상 운영자 키가 필요합니다.');
  }return c;
 }
 const available=(id:HeadquartersId)=>{try{validate(id);return true;}catch{return false;}};
 async function backend(id:HeadquartersId){const c=validate(id),rpc=rpcFactory(c.url!,c.key!);let info:{tenant?:string}|undefined;
  try{info=await rpc('lunch_tenant_info',{});}catch(error){if(id==='global')throw error;}
  if(info&&info.tenant!==id)throw new ApiError(503,'TENANT','연결된 DB의 본부 설정이 일치하지 않습니다.');
  if(id==='global'&&!info)throw new ApiError(503,'TENANT','Global DB 초기화가 필요합니다.');
  const t=tenantConfig(id);return {rpc,service:createBackend({rpc,inviteCode:c.invite||'',adminSecret:c.admin||'',cronSecret:env.CRON_SECRET||'',origin:env.APP_ORIGIN||undefined,secureCookies:env.NODE_ENV==='production',tenantId:id,requireRosterGate:true,roster:t.roster,policy:t.policy})};
 }
 async function handle(endpoint:Endpoint,request:Request){try{
  if(endpoint==='tenants'){
   if(request.method!=='GET')return response({error:'허용되지 않은 메서드입니다.'},405);
   return response({headquarters:HEADQUARTERS.map(h=>({...h,available:available(h.id)}))});
  }
  if(endpoint==='cron'){
   if(request.method!=='GET')return response({error:'허용되지 않은 메서드입니다.'},405);
   if(!env.CRON_SECRET||!secretEqual(request.headers.get('authorization')||'',`Bearer ${env.CRON_SECRET}`))throw new ApiError(401,'AUTH','인증이 필요합니다.');
   const ids:HeadquartersId[]=['ax'];if(Object.keys(env).some(k=>k.startsWith('GLOBAL_')&&!!env[k]))ids.push('global');
   const results=await Promise.all(ids.map(async id=>{
    let rpc:Rpc|undefined;
    try{const b=await backend(id);rpc=b.rpc;const result=await b.service.handle('cron',request);if(!result.ok)throw new ApiError(result.status,'JOB','자동 작업에 실패했습니다.');
     try{await rpc('lunch_record_job',{p_ok:true,p_code:null});}catch{/* Legacy AX DB remains operational before the additive migration. */}
     return {id,ok:true};
    }catch(error){const code=error instanceof ApiError?error.code:'INTERNAL';if(rpc)try{await rpc('lunch_record_job',{p_ok:false,p_code:code});}catch{}
     console.error('LunchNode scheduled job failed',{headquarters:id,code});return {id,ok:false,code};}
   }));return response({ok:results.every(r=>r.ok),results},results.every(r=>r.ok)?200:503);
  }
  const raw=request.headers.get('x-lunch-tenant')||'ax';if(!isHeadquarters(raw))throw new ApiError(400,'TENANT','본부를 선택해 주세요.');
  const b=await backend(raw),result=await b.service.handle(endpoint,request);return result;
 }catch(error){return errorResponse(error);}}
 return {handle};
}
