export type Meal = 'lunchbox' | 'outside' | 'any';
export type Choice = { status: 'unset' | 'join' | 'absent'; meal: Meal };
export type Person = { id: string; name: string; className: string; defaultStatus?: 'unset' | 'absent' };
export type Group = { id: string; meal: Exclude<Meal,'any'>; members: Person[] };
export type Day = { groups: Group[]; phase: 'matched'|'final'; matchedAt: string; finalizedAt?: string };
export type State = { choices: Record<string, Record<string,Choice>>; days: Record<string,Day>; events: {date:string; userId:string; action:string; at:string}[] };
export const emptyState = (): State => ({choices:{},days:{},events:[]});
export function defaultChoice(person: Pick<Person,'defaultStatus'>): Choice { return {status:person.defaultStatus||'unset',meal:'any'}; }
export function applyDefaults(state:State,dates:string[],people:Person[]) {
  for(const date of dates){const choices=state.choices[date]??={};for(const person of people)if(!choices[person.id])choices[person.id]=defaultChoice(person);}
}
export const mealNames = { lunchbox:'도시락', outside:'외부 식사', any:'상관 없음' };
export function seoulDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function cutoff(date: string) { return new Date(`${date}T11:00:00+09:00`); }
export function matchTime(date: string) { return new Date(new Date(`${date}T00:00:00+09:00`).getTime()-2*3600000); }
export function weekdays(start: string, end: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end) throw new Error('운영 기간 설정을 확인해 주세요.');
  const result:string[]=[]; const cursor=new Date(`${start}T12:00:00Z`);
  while(cursor.toISOString().slice(0,10)<=end) { if(![0,6].includes(cursor.getUTCDay())) result.push(cursor.toISOString().slice(0,10)); cursor.setUTCDate(cursor.getUTCDate()+1); if(result.length>100)throw new Error('운영 기간은 평일 100일 이내로 설정해 주세요.'); }
  return result;
}
const shuffle = <T,>(items:T[], random:()=>number) => { const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a; };
function sizes(n:number):number[] {
  if(n===0)return [];if(n<=5)return [n];
  const possibilities = [3,4,5].filter(x=>n-x>=3).map(x=>[x,...sizes(n-x)]);
  return possibilities.sort((a,b)=>a.filter(x=>x===5).length-b.filter(x=>x===5).length)[0];
}
export function encounters(state:State, date:string, a:string, b:string) {
  return Object.entries(state.days).filter(([d,v])=>d<date&&v.phase==='final').reduce((n,[,v])=>n+Number(v.groups.some(g=>g.members.some(p=>p.id===a)&&g.members.some(p=>p.id===b))),0);
}
function repeatCost(state:State,date:string,people:Person[]) {let score=0;for(let i=0;i<people.length;i++)for(let j=i+1;j<people.length;j++)score+=encounters(state,date,people[i].id,people[j].id);return score;}
export function initialMatch(state:State,date:string,people:Person[], random = Math.random):Group[] {
  const choice=state.choices[date]??{}; const joined=people.filter(p=>choice[p.id]?.status==='join');
  const box=joined.filter(p=>choice[p.id].meal==='lunchbox');const out=joined.filter(p=>choice[p.id].meal==='outside');const flexible=joined.filter(p=>choice[p.id].meal==='any');
  let best:Group[]=[];let bestCost=Infinity;
  for(let attempt=0;attempt<160;attempt++) {
    const pool={lunchbox:[...box],outside:[...out]};
    const split=attempt%(flexible.length+1);const flex=shuffle(flexible,random);
    flex.forEach((p,i)=>pool[i<split?'lunchbox':'outside'].push(p));
    const groups:Group[]=[];
    for(const meal of ['lunchbox','outside'] as const){const members=shuffle(pool[meal],random);let offset=0;for(const size of sizes(members.length)){groups.push({id:`${date}-${groups.length+1}`,meal,members:members.slice(offset,offset+size)});offset+=size;}}
    const score=groups.reduce((n,g)=>n+(g.members.length<3?(3-g.members.length)*10000:0)+(g.members.length===5?100:0)+repeatCost(state,date,g.members),0)+Math.abs(pool.lunchbox.length-pool.outside.length)*0.001;
    if(score<bestCost){best=groups;bestCost=score;}
  }
  return best;
}
export function addMember(state:State,date:string,person:Person,meal:Meal,random=Math.random) {
  const day=state.days[date];if(day.groups.some(g=>g.members.some(p=>p.id===person.id)))return;
  const candidates=shuffle(day.groups.filter(g=>g.members.length<5&&(meal==='any'||meal===g.meal)),random);
  candidates.sort((a,b)=>a.members.length-b.members.length||b.members.reduce((n,p)=>n+encounters(state,date,p.id,person.id),0)-a.members.reduce((n,p)=>n+encounters(state,date,p.id,person.id),0));
  if(candidates[0])candidates[0].members.push({...person});
  else day.groups.push({id:`${date}-${crypto.randomUUID()}`,meal:meal==='any'?(day.groups.filter(g=>g.meal==='lunchbox').length<=day.groups.filter(g=>g.meal==='outside').length?'lunchbox':'outside'):meal,members:[{...person}]});
}
export function syncDue(state:State,dates:string[],people:Person[],now=new Date(),random=Math.random) {
  applyDefaults(state,dates,people);
  for(const date of dates){if(now<matchTime(date))continue;
    if(!state.days[date])state.days[date]={groups:initialMatch(state,date,people,random),phase:'matched',matchedAt:now.toISOString()};
    if(now>=cutoff(date)&&state.days[date].phase!=='final'){state.days[date].phase='final';state.days[date].finalizedAt=now.toISOString();}
  }
}
export function setChoice(state:State,date:string,person:Person,choice:Choice,now=new Date()) {
  if(now>=cutoff(date))throw new Error('오전 11시 마감 이후에는 변경할 수 없습니다.');
  if(choice.status==='unset')choice=defaultChoice(person);
  const previous=state.choices[date]?.[person.id];
  if(state.days[date]){
    const day=state.days[date];if(day.phase==='final')throw new Error('이미 확정된 날짜입니다.');
    if(choice.status==='join'&&previous?.status==='join'&&choice.meal===previous.meal)return;
    day.groups=day.groups.map(g=>({...g,members:g.members.filter(p=>p.id!==person.id)})).filter(g=>g.members.length);
    if(choice.status==='join')addMember(state,date,person,choice.meal);
  }
  (state.choices[date]??={})[person.id]={...choice};
  state.events.push({date,userId:person.id,action:choice.status==='join'?`참여:${choice.meal}`:choice.status==='absent'?'불참':'미응답',at:now.toISOString()});
}
