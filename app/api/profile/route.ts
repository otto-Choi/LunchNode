import { db, jsonError, pinHash, rateLimit, requireUser, sameOrigin, verifyPin } from '@/lib/server';
export async function POST(request:Request){try{
  sameOrigin(request);const user=await requireUser();const body=await request.json();if(body.className!==undefined&&body.className!==user.className)throw new Error('소속은 변경할 수 없습니다.');
  const updates:{pin_hash?:string}={};const client=db();
  if(body.newPin){if(!/^\d{6}$/.test(body.newPin)||!/^\d{6}$/.test(String(body.currentPin||'')))throw new Error('현재 PIN과 새 PIN을 숫자 6자리로 입력해 주세요.');await rateLimit(`profile:${user.id}`);const {data,error}=await client.from('lunch_users').select('pin_hash').eq('id',user.id).single();if(error||!verifyPin(body.currentPin,data.pin_hash))throw new Error('현재 PIN이 올바르지 않습니다.');updates.pin_hash=pinHash(body.newPin);}
  if(!updates.pin_hash)return Response.json({ok:true,relogin:false});
  const {error}=await client.from('lunch_users').update(updates).eq('id',user.id);if(error)throw new Error('정보를 저장하지 못했습니다.');
  if(body.newPin){const {error:sessionError}=await client.from('lunch_sessions').delete().eq('user_id',user.id);if(sessionError)throw new Error('PIN은 변경되었지만 세션 초기화에 실패했습니다. 운영자에게 알려 주세요.');}
  return Response.json({ok:true,relogin:!!body.newPin});
}catch(e){return jsonError(e);}}
