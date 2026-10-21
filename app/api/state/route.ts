import { configured, currentUser, dates, jsonError, mutate, requireUser, sameOrigin } from '@/lib/server';
import { setChoice, type Choice } from '@/lib/domain';
export const dynamic='force-dynamic';
export async function GET(){try{
  if(!configured())return Response.json({demo:true});const user=await currentUser();if(!user)return Response.json({demo:false,user:null});
  return Response.json(await mutate((state,people,now)=>({demo:false,user,dates:dates(),people,state:{...state,events:[]},now:now.toISOString()})),{headers:{'Cache-Control':'no-store'}});
}catch(e){return jsonError(e,503);}}
export async function POST(request:Request){try{
  sameOrigin(request);const user=await requireUser();const body=await request.json();const selected=body.dates as string[];const choice=body.choice as Choice;
  if(!Array.isArray(selected)||!selected.length||selected.length>100||selected.some(d=>!dates().includes(d)))throw new Error('운영 기간 내 날짜를 선택해 주세요.');
  if(!choice||!['join','absent','unset'].includes(choice.status)||!['lunchbox','outside','any'].includes(choice.meal))throw new Error('신청 값을 확인해 주세요.');
  await mutate((state,_people,now)=>{for(const date of new Set(selected))setChoice(state,date,user,choice,now);return true;});return Response.json({ok:true});
}catch(e){return jsonError(e);}}
