import 'server-only';
import { createBackend } from './backend/service';
import { supabaseRpc } from './backend/supabase';
import { ApiError, errorResponse, response } from './backend/security';
export const configured=()=>!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
export const isDemoMode=()=>process.env.DEMO_MODE==='true';
export async function route(endpoint:'auth'|'state'|'profile'|'cron'|'health',request:Request) {
  if(endpoint==='state'&&request.method==='GET'&&isDemoMode())return response({demo:true});
  try{
    if(!configured())throw new ApiError(503,'CONFIG','Supabase 연결 설정이 필요합니다.');
    return await createBackend({rpc:supabaseRpc(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!),inviteCode:process.env.INVITE_CODE||'',cronSecret:process.env.CRON_SECRET||'',origin:process.env.APP_ORIGIN||undefined,secureCookies:process.env.NODE_ENV==='production'}).handle(endpoint,request);
  }catch(error){return errorResponse(error);}
}
