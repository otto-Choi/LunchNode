import pg from 'pg';
import { ApiError } from '../lib/backend/security.ts';
export function databasePools(connectionString=process.env.DATABASE_URL){
 if(!process.env.DATABASE_URL||process.env.ALLOW_DATABASE_RESET!=='1')throw new Error('Use a disposable test DB with DATABASE_URL and ALLOW_DATABASE_RESET=1.');
 const admin=new pg.Pool({connectionString,max:24});
 const service=new pg.Pool({connectionString,max:24,options:'-c role=service_role'});
 const rpc=async(name,args)=>{
  if(!/^lunch_[a-z_]+$/.test(name))throw new Error('Invalid function');
  const keys=Object.keys(args);if(keys.some(k=>!/^p_[a-z_]+$/.test(k)))throw new Error('Invalid argument');
  try{const {rows}=await service.query(`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) as value`,keys.map(k=>k==='p_groups'?JSON.stringify(args[k]):args[k]));return rows[0].value;}
  catch(error){const status={LN400:400,LN401:401,LN409:409,LN503:503}[error.code];if(status)throw new ApiError(status,error.code,error.message);throw error;}
 };
 return {admin,service,rpc,close:async()=>{await service.end();await admin.end();}};
}
