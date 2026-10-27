// Read-only checks against the public production alias; never uses login credentials.
const origin='https://lunch-node.vercel.app';
const checks=[['/api/tenants',200],['/api/state',401],['/api/group-node',401]];
let failure='';
for(let attempt=0;attempt<15;attempt++){
 const results=await Promise.all(checks.map(async([path,expected])=>{
  try{const r=await fetch(origin+path,{cache:'no-store',signal:AbortSignal.timeout(8000)});const body=await r.json();return {path,expected,status:r.status,ok:r.status===expected&&(path!=='/api/tenants'||['ax','global'].every(id=>body.headquarters?.some(h=>h.id===id&&h.available===true))&&body.headquarters?.some(h=>h.id==='tmt'&&h.available===false))};}
  catch{return {path,expected,status:'network error',ok:false};}
 }));
 if(results.every(r=>r.ok)){for(const r of results)console.log(`Production smoke: ${r.path} -> ${r.status} PASS`);process.exit(0);}
 failure=JSON.stringify(results);await new Promise(resolve=>setTimeout(resolve,4000));
}
throw new Error('Production smoke failed: '+failure);
