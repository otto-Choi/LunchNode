import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { OPERATION_START, OPERATION_END } from './operation';
import { rosterMember } from './roster';
import { emptyState, syncDue, weekdays, type State, type Person } from './domain';
export const configured=()=>!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
export function db(){if(!configured())throw new Error('Supabase 연결이 필요합니다.');return createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});}
export const dates=()=>weekdays(process.env.OPERATION_START||OPERATION_START,process.env.OPERATION_END||OPERATION_END);
export function pinHash(pin:string){const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(pin,salt,64).toString('hex')}`;}
export function verifyPin(pin:string,hash:string){const [salt,key]=hash.split(':');const expected=Buffer.from(key,'hex');const actual=scryptSync(pin,salt,64);return expected.length===actual.length&&timingSafeEqual(expected,actual);}
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function currentUser(){const token=(await cookies()).get('lunch_session')?.value;if(!token||!configured())return null;const client=db();const {data,error}=await client.from('lunch_sessions').select('user_id').eq('token_hash',digest(token)).gt('expires_at',new Date().toISOString()).maybeSingle();if(error)throw new Error('세션을 확인할 수 없습니다.');if(!data)return null;const result=await client.from('lunch_users').select('id,name,class_name').eq('id',data.user_id).single();if(result.error)throw new Error('사용자 정보를 확인할 수 없습니다.');const member=rosterMember(result.data.name);if(!member)throw new Error('등록된 명단에 없는 사용자입니다.');return {...member,id:result.data.id} satisfies Person;}
export async function requireUser(){const user=await currentUser();if(!user)throw new Error('로그인이 필요합니다.');return user;}
export async function people(){const {data,error}=await db().from('lunch_roster').select('id,name,class_name,default_status');if(error)throw new Error('참가자 목록을 읽을 수 없습니다.');if(data.length!==20||data.some(p=>!rosterMember(p.name)||rosterMember(p.name)!.className!==p.class_name||rosterMember(p.name)!.defaultStatus!==p.default_status))throw new Error('참가자 명단 SQL을 적용해 주세요.');return data.map(p=>({id:p.id,name:p.name,className:p.class_name,defaultStatus:p.default_status})) as Person[];}
export async function mutate<T>(fn:(state:State,people:Person[],now:Date)=>T){
  const client=db();
  for(let i=0;i<8;i++){
    const roster=await people();const {data,error}=await client.from('lunch_state').select('version,data').eq('id',1).single();if(error)throw new Error('DB 스키마와 연결을 확인해 주세요.');
    const state=(data.data||emptyState()) as State;const before=JSON.stringify(state);const now=new Date();syncDue(state,dates(),roster,now);const result=fn(state,roster,now);
    if(JSON.stringify(state)===before)return result;
    const write=await client.from('lunch_state').update({data:state,version:data.version+1}).eq('id',1).eq('version',data.version).select('version');if(write.error)throw new Error('저장에 실패했습니다.');if(write.data.length)return result;
  }
  throw new Error('동시 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
}
export function sameOrigin(request:Request){const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)throw new Error('허용되지 않은 요청입니다.');}
export const jsonError=(error:unknown,status=400)=>Response.json({error:error instanceof Error?error.message:'요청을 처리하지 못했습니다.'},{status});
export async function rateLimit(key:string){const {data,error}=await db().rpc('lunch_auth_attempt',{bucket_key:digest(key)});if(error)throw new Error('로그인 보안 설정을 확인해 주세요.');if(!data)throw new Error('시도 횟수를 초과했습니다. 15분 후 다시 시도해 주세요.');}
