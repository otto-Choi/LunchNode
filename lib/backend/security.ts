import { createHash, randomBytes, scrypt, timingSafeEqual, createHmac } from 'node:crypto';
export const SESSION_COOKIE = 'lunch_session';
export const SESSION_SECONDS = 21 * 86400;
export class ApiError extends Error {
  status:number; code:string;
  constructor(status:number,code:string,message:string) { super(message);this.status=status;this.code=code; }
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const secretEqual = (a: string, b: string) => timingSafeEqual(Buffer.from(digest(a),'hex'),Buffer.from(digest(b),'hex'));
const derive = (pin: string, salt: string) => new Promise<Buffer>((resolve,reject) => {
  scrypt(pin,salt,64,(error,key)=>error?reject(error):resolve(key));
});
export async function hashPin(pin: string) {
  const salt=randomBytes(16).toString('hex');
  return `${salt}:${(await derive(pin,salt)).toString('hex')}`;
}
export async function verifyPin(pin: string, stored: string | null) {
  const valid=!!stored && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored);
  const [salt,key]=(valid?stored!:`${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const actual=await derive(pin,salt);
  return valid && timingSafeEqual(actual,Buffer.from(key,'hex'));
}
export const newToken = () => randomBytes(32).toString('hex');
export function tokenFrom(request: Request,cookieName=SESSION_COOKIE) {
  const pairs=(request.headers.get('cookie')||'').split(';').map(p=>p.trim());
  const value=pairs.find(p=>p.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  return /^[0-9a-f]{64}$/.test(value)?value:'';
}
export function sessionCookie(token: string, secure: boolean,cookieName=SESSION_COOKIE) {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token?SESSION_SECONDS:0}${secure?'; Secure':''}`;
}
export function checkOrigin(request: Request, configuredOrigin?: string) {
  const origin=request.headers.get('origin');
  const expected=new URL(configuredOrigin||request.url).origin;
  if(!origin||origin!==expected)throw new ApiError(403,'ORIGIN','허용되지 않은 요청입니다.');
}
export async function readJson(request: Request): Promise<Record<string,unknown>> {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new ApiError(415,'CONTENT_TYPE','JSON 요청만 허용됩니다.');
  const reader=request.body?.getReader();if(!reader)throw new ApiError(400,'BODY','요청 내용이 없습니다.');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw new ApiError(413,'BODY_SIZE','요청 내용이 너무 큽니다.');}chunks.push(value);}
  try { const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value; }
  catch { throw new ApiError(400,'BODY','JSON 형식을 확인해 주세요.'); }
}
export function pinValue(value: unknown) {
  if(typeof value!=='string'||!/^\d{6}$/.test(value))throw new ApiError(400,'PIN','PIN은 숫자 6자리여야 합니다.');
  return value;
}
export function response(body: unknown, status=200, cookie?: string) {
  const headers:Record<string,string>={'Cache-Control':'no-store, private','Vary':'Cookie'};
  if(cookie)headers['Set-Cookie']=cookie;
  return Response.json(body,{status,headers});
}
export function errorResponse(error: unknown) {
  if(error instanceof ApiError)return response({error:error.message,code:error.code},error.status);
  return response({error:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',code:'INTERNAL'},500);
}

export function rosterGateCookie(value:string,secure:boolean,name:string){return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value?7*86400:0}${secure?'; Secure':''}`;}
export function makeRosterGate(tenant:string,secret:string,now=Date.now()){
 const expires=String(Math.floor(now/1000)+7*86400),signature=createHmac('sha256',secret).update(`${tenant}:${expires}`).digest('hex');return `${expires}.${signature}`;
}
export function hasRosterGate(request:Request,name:string,tenant:string,secret:string){
 if(!secret)return false;const raw=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
 const [expires,signature]=raw.split('.');if(!/^\d{10}$/.test(expires||'')||!signature||Number(expires)<=Date.now()/1000||Number(expires)>Date.now()/1000+7*86400+60)return false;
 return secretEqual(signature,createHmac('sha256',secret).update(`${tenant}:${expires}`).digest('hex'));
}
