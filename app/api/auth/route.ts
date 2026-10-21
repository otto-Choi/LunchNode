import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { currentUser, db, digest, jsonError, pinHash, rateLimit, sameOrigin, verifyPin } from '@/lib/server';
import { rosterMember } from '@/lib/roster';
export const runtime='nodejs';
export async function GET(){try{return Response.json({user:await currentUser()},{headers:{'Cache-Control':'no-store'}});}catch(e){return jsonError(e,503);}}
export async function POST(request:Request){try{
  sameOrigin(request);const body=await request.json();const jar=await cookies();
  if(body.action==='logout'){const token=jar.get('lunch_session')?.value;if(token){const {error}=await db().from('lunch_sessions').delete().eq('token_hash',digest(token));if(error)throw new Error('로그아웃에 실패했습니다.');}jar.delete('lunch_session');return Response.json({ok:true});}
  const name=String(body.name||'').normalize('NFKC').trim();const pin=String(body.pin||'');
  if(name.length<2||name.length>30||!/^\d{6}$/.test(pin))throw new Error('이름과 숫자 6자리 PIN을 확인해 주세요.');
  const member=rosterMember(name);if(!member)throw new Error('등록된 20명만 이용할 수 있습니다.');
  await rateLimit(`name:${name}`);await rateLimit(`ip:${request.headers.get('x-forwarded-for')?.split(',')[0]||'unknown'}`);
  const client=db();let user:{id:string;name:string;class_name:string;pin_hash?:string};
  if(body.action==='register'){
    if(!process.env.INVITE_CODE)throw new Error('운영자가 초대 코드를 설정해야 합니다.');
    if(digest(String(body.invite||''))!==digest(process.env.INVITE_CODE))throw new Error('초대 코드가 올바르지 않습니다.');
    const {data:entry,error:rosterError}=await client.from('lunch_roster').select('id,class_name').eq('name',name).single();
    if(rosterError||!entry||entry.class_name!==member.className)throw new Error('참가자 명단 SQL을 먼저 적용해 주세요.');
    if(body.className!==undefined&&body.className!==member.className)throw new Error('소속은 명단에 지정된 값만 사용할 수 있습니다.');
    const result=await client.from('lunch_users').insert({id:entry.id,name,class_name:entry.class_name,pin_hash:pinHash(pin)}).select('id,name,class_name').single();
    if(result.error){if(result.error.code==='23505')throw new Error('이미 등록된 이름입니다. 이름·PIN으로 로그인해 주세요.');throw new Error('등록에 실패했습니다.');}user=result.data;
  }else if(body.action==='login'){
    const result=await client.from('lunch_users').select('id,name,class_name,pin_hash').eq('name',name).maybeSingle();
    if(result.error)throw new Error('로그인을 처리할 수 없습니다.');
    // Apply the same expensive hash to unknown names to reduce timing differences.
    const valid=verifyPin(pin,result.data?.pin_hash||'00000000000000000000000000000000:'+ '00'.repeat(64));
    if(!result.data||!valid)throw new Error('이름 또는 PIN이 올바르지 않습니다.');user=result.data;
  }else throw new Error('잘못된 요청입니다.');
  const token=randomBytes(32).toString('hex');const expires=new Date(Date.now()+21*86400000);
  const {error}=await client.from('lunch_sessions').insert({token_hash:digest(token),user_id:user.id,expires_at:expires.toISOString()});if(error)throw new Error('세션을 만들지 못했습니다.');
  jar.set('lunch_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',expires});
  return Response.json({user:{id:user.id,name:user.name,className:user.class_name,defaultStatus:member.defaultStatus}});
}catch(e){return jsonError(e);}}
