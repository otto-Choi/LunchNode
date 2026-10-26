import 'server-only';
import {createApplication} from './backend/application';
import {response} from './backend/security';
export const configured=()=>!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.AX_SUPABASE_URL&&process.env.AX_SUPABASE_SERVICE_ROLE_KEY);
export const isDemoMode=()=>process.env.DEMO_MODE==='true';
export async function route(endpoint:'auth'|'state'|'profile'|'cron'|'health'|'admin'|'tenants'|'group-node',request:Request){
 if(process.env.MAINTENANCE_MODE==='true')return response({error:'서비스 점검 중입니다. 잠시 후 다시 접속해 주세요.',code:'MAINTENANCE'},503);
 if(endpoint==='state'&&request.method==='GET'&&isDemoMode())return response({demo:true});
 return createApplication({env:process.env}).handle(endpoint,request);
}
