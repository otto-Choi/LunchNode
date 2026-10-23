import type {Rpc} from './service.ts';
import type {HeadquartersId} from '../headquarters.ts';
export type AxNamespace='legacy'|'ax';
// Both headquarters share one connection. Only server-selected prefixes are permitted.
export function tenantRpc(rpc:Rpc,tenant:HeadquartersId,axNamespace:AxNamespace='ax'):Rpc {
 return <T>(name:string,args:Record<string,unknown>):Promise<T>=>{
  if(!/^lunch_[a-z_]+$/.test(name))throw new Error('Invalid LunchNode RPC');
  return rpc<T>(tenant==='global'?`global_${name}`:axNamespace==='ax'?`ax_${name}`:name,args);
 };
}
