import { ApiError } from './security.ts';
import type { Rpc } from './service.ts';
export function supabaseRpc(url:string,key:string,fetcher:typeof fetch=fetch):Rpc {
  const root=new URL(url);if(root.protocol!=='https:'&&root.hostname!=='127.0.0.1'&&root.hostname!=='localhost')throw new ApiError(503,'CONFIG','Supabase URL을 확인해 주세요.');
  return async <T>(name:string,args:Record<string,unknown>):Promise<T>=>{
    let result:Response;
    try{result=await fetcher(new URL(`/rest/v1/rpc/${name}`,root),{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(args),cache:'no-store',signal:AbortSignal.timeout(10000)});}
    catch{throw new ApiError(503,'DATABASE','DB에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');}
    let data:unknown;try{data=await result.json();}catch{throw new ApiError(503,'DATABASE','DB 응답을 확인할 수 없습니다.');}
    if(!result.ok){
      const error=data as {code?:string;message?:string};
      if(error.code==='PGRST202'||error.code==='42883')throw new ApiError(503,'RPC_MISSING','DB 업데이트가 필요합니다.');
      const statuses:Record<string,number>={LN400:400,LN401:401,LN409:409,LN503:503};
      if(error.code&&statuses[error.code])throw new ApiError(statuses[error.code],error.code,error.message||'요청에 실패했습니다.');
      throw new ApiError(503,'DATABASE','DB 스키마와 연결 설정을 확인해 주세요.');
    }
    return data as T;
  };
}
