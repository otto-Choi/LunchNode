import {isHeadquarters,type HeadquartersId} from '../headquarters.ts';

// Keep the selected headquarters usable even when browser storage is blocked.
// Do not cache the server-rendering default in this module.
let activeHeadquarters:HeadquartersId|undefined;
export function savedHeadquarters():HeadquartersId {
 if(typeof window==='undefined')return 'ax';
 if(activeHeadquarters)return activeHeadquarters;
 try{const id=sessionStorage.getItem('lunchnode-headquarters');activeHeadquarters=isHeadquarters(id)?id:'ax';}
 catch{activeHeadquarters='ax';}
 return activeHeadquarters;
}
export function rememberHeadquarters(id:HeadquartersId) {
 activeHeadquarters=id;
 try{sessionStorage.setItem('lunchnode-headquarters',id);}catch{/* The current tab retains its selection in memory. */}
}
export async function api(path:string,body?:unknown,headquarters=savedHeadquarters()) {
 const headers:Record<string,string>={'x-lunch-tenant':headquarters};
 if(body)headers['Content-Type']='application/json';
 const res=await fetch(path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{cache:'no-store'}),signal:AbortSignal.timeout(10000)});
 const data=await res.json();
 if(!res.ok)throw Object.assign(new Error(data.error||'요청에 실패했습니다.'),{status:res.status,code:data.code});
 return data;
}
