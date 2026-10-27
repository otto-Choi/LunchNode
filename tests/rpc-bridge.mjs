// CI-only PostgREST-compatible transport over a real disposable PostgreSQL database.
import http from 'node:http';
import {databasePools} from './postgres-rpc.mjs';
const db=databasePools();
await db.admin.query("truncate ax_lunch_sessions,ax_lunch_users,ax_lunch_auth_buckets;update ax_lunch_state set version=0,data='{\"choices\":{},\"days\":{},\"events\":[]}'::jsonb");
await db.admin.query("truncate global_lunch_sessions,global_lunch_users,global_lunch_auth_buckets;update global_lunch_state set version=0,data='{\"choices\":{},\"days\":{},\"events\":[]}'::jsonb");
await db.admin.query("truncate tmt_lunch_sessions,tmt_lunch_users,tmt_lunch_auth_buckets;update tmt_lunch_state set version=0,data='{\"choices\":{},\"days\":{},\"events\":[]}'::jsonb");
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url==='/health'){res.end('ok');return;}
  if(req.headers.apikey!=='ci-only-service-key')throw new Error('Bad test key');
  const parts=[];for await(const chunk of req)parts.push(chunk);
  const args=JSON.parse(Buffer.concat(parts));const name=req.url.split('/').at(-1);const value=await db.rpc(name,args);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({code:error.code==='RPC_MISSING'?'PGRST202':error.code||'INTERNAL',message:error.message}));}
});
server.listen(54329,'127.0.0.1',()=>console.log('Test RPC bridge ready.'));
process.on('SIGTERM',()=>server.close(async()=>{await db.close();process.exit(0);}));
