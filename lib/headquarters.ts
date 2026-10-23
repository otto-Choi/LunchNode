export const HEADQUARTERS=[{id:'ax',label:'AX Node'},{id:'global',label:'Global'}] as const;
export type HeadquartersId=typeof HEADQUARTERS[number]['id'];
export function isHeadquarters(value:unknown):value is HeadquartersId{return value==='ax'||value==='global';}
export const headquartersLabel=(id:HeadquartersId)=>HEADQUARTERS.find(h=>h.id===id)!.label;
