import {ApiError,checkOrigin,digest,readJson,response,tokenFrom} from '../backend/security.ts';
import type {Rpc} from '../backend/service.ts';
import {CATEGORIES,type MeetupInput} from './types.ts';
import {isHeadquarters,type HeadquartersId} from '../headquarters.ts';
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function meetupInput(body:Record<string,unknown>):MeetupInput {
 const title=typeof body.title==='string'?body.title.trim():'';
 const description=typeof body.description==='string'?body.description.trim():'';
 if(!title||title.length>60||description.length>2000)throw new ApiError(400,'INPUT','제목은 1~60자, 설명은 2,000자 이내로 입력해 주세요.');
 if(typeof body.category!=='string'||!Object.hasOwn(CATEGORIES,body.category))throw new ApiError(400,'INPUT','카테고리를 선택해 주세요.');
 if(!Number.isInteger(body.minPeople)||Number(body.minPeople)<2||Number(body.minPeople)>40)throw new ApiError(400,'INPUT','최소 인원은 2~40명입니다.');
 if(!['all','headquarters'].includes(String(body.visibility)))throw new ApiError(400,'INPUT','모집 범위를 선택해 주세요.');
 if(body.kind!==undefined&&body.kind!=='one_off'&&body.kind!=='club')throw new ApiError(400,'INPUT','모임 유형을 선택해 주세요.');
 if(!Array.isArray(body.dates)||body.dates.length<(body.kind==='club'?0:1)||body.dates.length>5)throw new ApiError(400,'INPUT','1회성 모임의 후보 날짜는 1~5개, 소모임은 0~5개입니다.');
 const dates=body.dates.map((raw:unknown)=>{
  const d=raw as Record<string,unknown>;if(!d||typeof d!=='object'||typeof d.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!Number.isFinite(Date.parse(d.date))||new Date(d.date).toISOString().slice(0,10)!==d.date)throw new ApiError(400,'INPUT','올바른 후보 날짜를 입력해 주세요.');
  if(d.id!==undefined&&!uuid(d.id))throw new ApiError(400,'INPUT','후보 날짜를 확인해 주세요.');
  const time=d.time===''||d.time==null?null:d.time;
  if(time!==null&&(typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]0$/.test(time)))throw new ApiError(400,'INPUT','시간은 10분 단위로 선택해 주세요.');
  return {...(d.id?{id:String(d.id)}:{}),date:d.date,time:time as string|null};
 });
 if(new Set(dates.map(d=>d.date+':'+d.time)).size!==dates.length||new Set(dates.filter(d=>d.id).map(d=>d.id)).size!==dates.filter(d=>d.id).length)throw new ApiError(400,'INPUT','중복된 후보 날짜를 확인해 주세요.');
 return {...(body.kind===undefined?{}:{kind:body.kind as MeetupInput['kind']}),title,description,category:body.category as MeetupInput['category'],minPeople:Number(body.minPeople),visibility:body.visibility as MeetupInput['visibility'],dates};
}
export async function groupNodeRequest(request:Request,options:{rpc:Rpc;tenant:HeadquartersId;cookieName:string;origin?:string;limit:Rpc}) {
 if(!['GET','POST'].includes(request.method))throw new ApiError(405,'METHOD','허용되지 않은 요청입니다.');
 const token=tokenFrom(request,options.cookieName);if(!token)throw new ApiError(401,'AUTH','로그인이 필요합니다.');
 const hash=digest(options.tenant!=='ax'?`${options.tenant}:${token}`:token);
 let action='list',payload:Record<string,unknown>={};
 if(request.method==='GET'){
  const q=new URL(request.url).searchParams;action=q.has('participantsFor')?'participant_roster':q.has('id')?'detail':'list';
  if(action==='detail'||action==='participant_roster'){const id=q.get(action==='detail'?'id':'participantsFor');if(!uuid(id))throw new ApiError(400,'INPUT','모임을 확인해 주세요.');payload={id};}
  else{const offset=Number(q.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new ApiError(400,'INPUT','페이지를 확인해 주세요.');payload={view:['mine','clubs','past'].includes(q.get('view')||'')?q.get('view'):'browse',category:q.get('category')||'',q:(q.get('q')||'').slice(0,60),onlyHeadquarters:q.get('onlyHeadquarters')==='true',offset};}
 }else{
  checkOrigin(request,options.origin);const body=await readJson(request);action=String(body.action);
  if(!['create','update','delete','join','leave','vote','unvote','comment','delete_comment','confirm','reopen','cancel','convert_to_club','add_participant','edit_comment'].includes(action))throw new ApiError(400,'ACTION','잘못된 작업입니다.');
  if(action!=='create'&&!uuid(body.id))throw new ApiError(400,'INPUT','모임을 확인해 주세요.');
  payload=action==='create'||action==='update'?{...meetupInput(body),...(action==='update'?{id:body.id,version:body.version}:{})}:{id:body.id};
  if(['update','delete','confirm','reopen','cancel','convert_to_club','add_participant'].includes(action)){
   if(!Number.isInteger(body.version)||Number(body.version)<0)throw new ApiError(400,'INPUT','최신 모임 정보를 다시 불러와 주세요.');payload.version=body.version;
  }
  if(action==='add_participant'){if(!isHeadquarters(body.tenant)||!uuid(body.userId))throw new ApiError(400,'INPUT','참여자를 선택해 주세요.');payload.tenant=body.tenant;payload.userId=body.userId;}
  if(['vote','unvote','confirm','delete_comment','edit_comment'].includes(action)){
   const key=['delete_comment','edit_comment'].includes(action)?'commentId':'dateId';if(!uuid(body[key]))throw new ApiError(400,'INPUT','선택 항목을 확인해 주세요.');payload[key]=body[key];
  }
  if(action==='comment'||action==='edit_comment'){
   const text=typeof body.body==='string'?body.body.trim():'';if(!text||text.length>500)throw new ApiError(400,'INPUT','댓글은 1~500자로 입력해 주세요.');payload.body=text;if(action==='edit_comment'){if(typeof body.expectedBody!=='string'||body.expectedBody.length>500)throw new ApiError(400,'INPUT','최신 댓글을 다시 불러와 주세요.');payload.expectedBody=body.expectedBody;}
  }
  if(!await options.limit<boolean>('lunch_rate_limit',{p_key:digest('group-node:'+hash),p_limit:120}))throw new ApiError(429,'RATE_LIMIT','요청이 많습니다. 잠시 후 다시 시도해 주세요.');
 }
 return response(await options.rpc('group_node_api',{p_tenant:options.tenant,p_token_hash:hash,p_action:action,p_payload:payload}));
}
