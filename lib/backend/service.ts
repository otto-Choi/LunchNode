import { isMeal, cutoff, matchTime, rematchDay, setChoice, syncDue, type Choice, type Person, type State } from '../domain.ts';
import { rosterMember } from '../roster.ts';
import { ApiError, checkOrigin, digest, errorResponse, hashPin, newToken, pinValue, readJson, response, secretEqual, sessionCookie, tokenFrom, verifyPin } from './security.ts';
export type Rpc = <T=unknown>(name: string, args: Record<string,unknown>) => Promise<T>;
export type Snapshot = { version:number; state:State; people:Person[]; dates:string[]; user:Person|null; now:string };
type Credentials = { id:string; pin_hash:string; user:Person };
type Options = { rpc:Rpc; inviteCode:string; cronSecret:string; adminSecret?:string; origin?:string; secureCookies:boolean; retryDelay?:()=>Promise<void> };
export function createBackend(options:Options) {
  const {rpc}=options;
  const delay=options.retryDelay||(()=>new Promise<void>(resolve=>setTimeout(resolve,Math.floor(Math.random()*12)+2)));
  const tokenHash=(request:Request)=>{const token=tokenFrom(request);return token?digest(token):'';};
  const identity=async(request:Request)=>rpc<Person|null>('lunch_identity',{p_token_hash:tokenHash(request)});
  async function requireIdentity(request:Request) {const user=await identity(request);if(!user)throw new ApiError(401,'AUTH','로그인이 필요합니다.');return user;}
  async function throttle(request:Request,name:string) {
    // Many coworkers share one IP. Keep the account limit strict and the shared-IP limit higher.
    const ip=(request.headers.get('x-vercel-forwarded-for')||request.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();
    for(const [key,limit] of [[`name:${name}`,8],[`ip:${ip}`,160]] as const){
      if(!await rpc<boolean>('lunch_rate_limit',{p_key:digest(key),p_limit:limit}))throw new ApiError(429,'RATE_LIMIT','시도 횟수를 초과했습니다. 15분 후 다시 시도해 주세요.');
    }
  }
  async function stateOperation(request:Request, change?:{dates:string[];choice:Choice},cron=false) {
    for(let attempt=0;attempt<24;attempt++) {
      const snap=await rpc<Snapshot>('lunch_snapshot',{p_token_hash:tokenHash(request),p_cron:cron});
      if(!cron&&!snap.user)throw new ApiError(401,'AUTH','로그인이 필요합니다.');
      if(snap.people.length!==20)throw new ApiError(503,'ROSTER','참가자 명단 설정을 확인해 주세요.');
      const before=JSON.stringify(snap.state);const now=new Date(snap.now);
      syncDue(snap.state,snap.dates,snap.people,now);
      if(change){
        for(const date of change.dates){
          if(!snap.dates.includes(date))throw new ApiError(400,'DATE','운영 기간의 평일만 신청할 수 있습니다.');
          if(now>=cutoff(date)||snap.state.days[date]?.phase==='final')throw new ApiError(409,'CLOSED','오전 11시 마감 이후에는 변경할 수 없습니다.');
        }
        for(const date of change.dates)setChoice(snap.state,date,snap.user!,change.choice,now);
      }
      if(before===JSON.stringify(snap.state)||await rpc<boolean>('lunch_commit_state',{
        p_token_hash:tokenHash(request),p_expected_version:snap.version,p_data:snap.state,
        p_write_dates:change?.dates||[],p_cron:cron,
      }))return {demo:false,user:snap.user,people:snap.people,dates:snap.dates,state:{...snap.state,events:[]},now:snap.now};
      await delay();
    }
    throw new ApiError(409,'BUSY','동시 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  }
  async function auth(request:Request) {
    if(request.method==='GET')return response({user:await identity(request)});
    checkOrigin(request,options.origin);const body=await readJson(request);
    if(body.action==='logout'){
      await rpc('lunch_end_session',{p_token_hash:tokenHash(request)});
      return response({ok:true},200,sessionCookie('',options.secureCookies));
    }
    if(body.action!=='register'&&body.action!=='login')throw new ApiError(400,'ACTION','잘못된 요청입니다.');
    const name=typeof body.name==='string'?body.name.normalize('NFKC').trim():'';
    const pin=pinValue(body.pin);await throttle(request,name);
    if(!rosterMember(name))throw new ApiError(400,'ROSTER','등록된 20명만 이용할 수 있습니다.');
    const token=newToken();let user:Person;
    if(body.action==='register') {
      if(!options.inviteCode)throw new ApiError(503,'CONFIG','운영자가 초대 코드를 설정해야 합니다.');
      if(typeof body.invite!=='string'||!secretEqual(body.invite,options.inviteCode))throw new ApiError(403,'INVITE','초대 코드가 올바르지 않습니다.');
      if(body.className!==undefined&&body.className!==rosterMember(name)!.className)throw new ApiError(400,'IDENTITY','소속은 변경할 수 없습니다.');
      user=await rpc<Person>('lunch_register',{p_name:name,p_pin_hash:await hashPin(pin),p_token_hash:digest(token)});
    } else {
      const credentials=await rpc<Credentials|null>('lunch_credentials',{p_name:name});
      if(!await verifyPin(pin,credentials?.pin_hash||null)||!credentials)throw new ApiError(401,'CREDENTIALS','이름 또는 PIN이 올바르지 않습니다.');
      user=await rpc<Person>('lunch_open_session',{p_user_id:credentials.id,p_expected_hash:credentials.pin_hash,p_token_hash:digest(token)});
    }
    return response({user},200,sessionCookie(token,options.secureCookies));
  }
  async function state(request:Request) {
    if(request.method==='GET')return response(await stateOperation(request));
    checkOrigin(request,options.origin);await requireIdentity(request);const body=await readJson(request);
    if(!Array.isArray(body.dates)||body.dates.length<1||body.dates.length>100||body.dates.some(d=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)))throw new ApiError(400,'DATES','날짜를 선택해 주세요.');
    const choice=body.choice as Choice|undefined;
    if(!choice||typeof choice!=='object'||!['join','absent','unset'].includes(choice.status)||!isMeal(choice.meal))throw new ApiError(400,'CHOICE','참석 여부와 메뉴를 확인해 주세요.');
    await stateOperation(request,{dates:[...new Set(body.dates)] as string[],choice:{status:choice.status,meal:choice.meal}});
    return response({ok:true});
  }
  async function profile(request:Request) {
    checkOrigin(request,options.origin);const user=await requireIdentity(request);const body=await readJson(request);
    if(body.name!==undefined||body.userId!==undefined||body.className!==undefined&&body.className!==user.className)throw new ApiError(400,'IDENTITY','이름과 소속은 변경할 수 없습니다.');
    const currentPin=pinValue(body.currentPin),newPin=pinValue(body.newPin);await throttle(request,user.name);
    const credentials=await rpc<Credentials|null>('lunch_credentials',{p_name:user.name});
    if(!credentials||!await verifyPin(currentPin,credentials.pin_hash))throw new ApiError(401,'CREDENTIALS','현재 PIN이 올바르지 않습니다.');
    await rpc('lunch_change_pin',{p_token_hash:tokenHash(request),p_expected_hash:credentials.pin_hash,p_new_hash:await hashPin(newPin)});
    return response({ok:true,relogin:true},200,sessionCookie('',options.secureCookies));
  }
  async function cron(request:Request) {
    if(!options.cronSecret||!secretEqual(request.headers.get('authorization')||'',`Bearer ${options.cronSecret}`))throw new ApiError(401,'AUTH','인증이 필요합니다.');
    const result=await stateOperation(request,undefined,true);
    await rpc('lunch_cleanup',{});return response({ok:true,at:result.now});
  }
  async function admin(request:Request) {
    checkOrigin(request,options.origin);await requireIdentity(request);const body=await readJson(request);
    const ip=(request.headers.get('x-vercel-forwarded-for')||request.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();
    if(!await rpc<boolean>('lunch_rate_limit',{p_key:digest(`admin:${ip}`),p_limit:30}))throw new ApiError(429,'RATE_LIMIT','시도 횟수를 초과했습니다. 15분 후 다시 시도해 주세요.');
    if(!options.adminSecret||options.adminSecret.length<32)throw new ApiError(503,'ADMIN_CONFIG','운영자 키 설정이 필요합니다.');
    if(typeof body.key!=='string'||!secretEqual(body.key,options.adminSecret))throw new ApiError(403,'ADMIN','운영자 키가 올바르지 않습니다.');
    if(body.action==='check')return response({ok:true,message:'운영자 인증이 완료되었습니다.'});
    if(body.action==='rematch'){
      if(typeof body.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.date))throw new ApiError(400,'DATE','재편성할 날짜를 선택해 주세요.');
      for(let attempt=0;attempt<24;attempt++){
        const snap=await rpc<Snapshot>('lunch_snapshot',{p_token_hash:tokenHash(request),p_cron:false});
        if(!snap.dates.includes(body.date))throw new ApiError(400,'DATE','운영 기간의 평일만 재편성할 수 있습니다.');
        const now=new Date(snap.now),day=snap.state.days[body.date];
        if(now>=cutoff(body.date)||day?.phase==='final')throw new ApiError(409,'CLOSED','오전 11시 마감 이후에는 재편성할 수 없습니다.');
        if(now<matchTime(body.date)||!day)throw new ApiError(409,'NOT_MATCHED','최초 편성 이후에만 재편성할 수 있습니다.');
        const next=rematchDay(snap.state,body.date,snap.people,now);
        if(await rpc<boolean>('lunch_admin_rematch',{p_actor_token:tokenHash(request),p_expected_version:snap.version,p_date:body.date,p_groups:next.groups}))return response({ok:true,message:`${body.date} 전체 조를 재편성했습니다. 최종 확정 전 조는 만남 횟수에 포함하지 않습니다.`});
        await delay();
      }
      throw new ApiError(409,'BUSY','동시 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    }
    if(body.action==='recover'){
      const result=await stateOperation(request,undefined,true);await rpc('lunch_cleanup',{});
      await rpc('lunch_admin_recover_log',{p_actor_token:tokenHash(request)});
      return response({ok:true,message:'누락된 편성·마감 처리를 완료했습니다.',at:result.now});
    }
    if(body.action!=='reset_pin'&&body.action!=='revoke')throw new ApiError(400,'ACTION','잘못된 작업입니다.');
    if(typeof body.name!=='string'||!rosterMember(body.name))throw new ApiError(400,'ROSTER','대상 이름을 확인해 주세요.');
    const hash=body.action==='reset_pin'?await hashPin(pinValue(body.newPin)):null;
    await rpc('lunch_admin_account',{p_actor_token:tokenHash(request),p_target_name:body.name,p_new_hash:hash});
    return response({ok:true,message:body.action==='reset_pin'?`${body.name}님의 PIN을 재설정하고 모든 세션을 종료했습니다.`:`${body.name}님의 모든 세션을 종료했습니다.`});
  }
  async function handle(endpoint:'auth'|'state'|'profile'|'cron'|'health'|'admin',request:Request) {
    try {
      const allowed=(endpoint==='auth'||endpoint==='state')?['GET','POST']:(endpoint==='profile'||endpoint==='admin')?['POST']:['GET'];
      if(!allowed.includes(request.method))return response({error:'허용되지 않은 메서드입니다.',code:'METHOD'},405);
      if(endpoint==='health'){await rpc('lunch_health',{});return response({ok:true});}
      return await ({auth,state,profile,cron,admin}[endpoint])(request);
    }catch(error){return errorResponse(error);}
  }
  return {handle};
}
