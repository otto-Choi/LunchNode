export const HEADQUARTERS=[{id:'ax',label:'AX Node'},{id:'global',label:'Global'},{id:'tmt',label:'TMT'}] as const;
export type HeadquartersId=typeof HEADQUARTERS[number]['id'];
export function isHeadquarters(value:unknown):value is HeadquartersId{return HEADQUARTERS.some(h=>h.id===value);}
export const headquartersLabel=(id:HeadquartersId)=>HEADQUARTERS.find(h=>h.id===id)!.label;
