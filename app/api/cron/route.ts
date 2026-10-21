import { db, digest, jsonError, mutate } from '@/lib/server';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  if(!process.env.CRON_SECRET||digest(request.headers.get('authorization')||'')!==digest(`Bearer ${process.env.CRON_SECRET}`))return Response.json({error:'Unauthorized'},{status:401});
  try{await mutate(()=>true);const result=await db().from('lunch_sessions').delete().lt('expires_at',new Date().toISOString());if(result.error)throw new Error('만료 세션 정리에 실패했습니다.');return Response.json({ok:true,at:new Date().toISOString()});}catch(e){return jsonError(e,500);}
}
