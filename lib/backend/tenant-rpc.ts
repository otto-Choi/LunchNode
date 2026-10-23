import type {Rpc} from './service.ts';
import type {HeadquartersId} from '../headquarters.ts';
// Both tenants share one connection. The server alone selects a fixed RPC namespace.
export function tenantRpc(rpc:Rpc,tenant:HeadquartersId):Rpc {
 return <T>(name:string,args:Record<string,unknown>):Promise<T>=>{
  if(!/^lunch_[a-z_]+$/.test(name))throw new Error('Invalid LunchNode RPC');
  return rpc<T>(tenant==='global'?`global_${name}`:name,args);
 };
}
