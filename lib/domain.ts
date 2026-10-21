export const MEAL_OPTIONS = ['lunchbox','prefer_lunchbox','any','prefer_outside','outside'] as const;
export type Meal = typeof MEAL_OPTIONS[number];
export type MealType = 'lunchbox' | 'outside';
export type Choice = { status: 'unset' | 'join' | 'absent'; meal: Meal };
export type Person = { id: string; name: string; className: string; defaultStatus?: 'unset' | 'absent' };
export type Group = { id: string; meal: MealType; members: Person[] };
export type Day = { groups: Group[]; phase: 'matched'|'final'; matchedAt: string; finalizedAt?: string };
export type State = { choices: Record<string, Record<string,Choice>>; days: Record<string,Day>; events: {date:string; userId:string; action:string; at:string}[] };
export const emptyState = (): State => ({choices:{},days:{},events:[]});
export function defaultChoice(person: Pick<Person,'defaultStatus'>): Choice { return {status:person.defaultStatus||'unset',meal:'any'}; }
export function applyDefaults(state:State,dates:string[],people:Person[]) {
  for(const date of dates){const choices=state.choices[date]??={};for(const person of people)if(!choices[person.id])choices[person.id]=defaultChoice(person);}
}
// Keep the legacy lunchbox/outside keys as strict choices; existing saved requests need no conversion.
export const mealNames: Record<Meal,string> = {lunchbox:'도시락만',prefer_lunchbox:'도시락선호',any:'상관없음',prefer_outside:'외식선호',outside:'외식만'};
export const groupMealNames: Record<MealType,string> = {lunchbox:'도시락',outside:'외식'};
export function isMeal(value:unknown): value is Meal {return typeof value==='string' && (MEAL_OPTIONS as readonly string[]).includes(value);}
export function preferredMeal(meal:Meal):MealType|undefined {return meal==='lunchbox'||meal==='prefer_lunchbox'?'lunchbox':meal==='outside'||meal==='prefer_outside'?'outside':undefined;}
export function allowsMeal(meal:Meal,actual:MealType) {return meal!=='lunchbox'&&meal!=='outside'||meal===actual;}
function preferenceCost(meal:Meal,actual:MealType) {const preferred=preferredMeal(meal);return preferred&&preferred!==actual?1:0;}
function compareCost(a:number[],b:number[]) {for(let i=0;i<a.length;i++){const difference=a[i]-b[i];if(difference)return difference;}return 0;}
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
export function initialMatch(state:State,date:string,people:Person[],random=Math.random):Group[] {
  const choice=state.choices[date]??{};
  const joined=people.filter(p=>choice[p.id]?.status==='join');
  const box=joined.filter(p=>choice[p.id].meal==='lunchbox');
  const out=joined.filter(p=>choice[p.id].meal==='outside');
  const preferBox=joined.filter(p=>choice[p.id].meal==='prefer_lunchbox');
  const neutral=joined.filter(p=>choice[p.id].meal==='any');
  const preferOut=joined.filter(p=>choice[p.id].meal==='prefer_outside');
  const flexibleCount=preferBox.length+neutral.length+preferOut.length;
  let best:Group[]=[];let bestCost:number[]|undefined;
  for(let attempt=0;attempt<160;attempt++) {
    // For each pool size, this ordering satisfies the most soft preferences.
    // Shuffle within each tier so equally good plans can still avoid repeat pairings.
    const flexible=[...shuffle(preferBox,random),...shuffle(neutral,random),...shuffle(preferOut,random)];
    const split=attempt%(flexibleCount+1);
    const pool={lunchbox:[...box,...flexible.slice(0,split)],outside:[...out,...flexible.slice(split)]};
    const groups:Group[]=[];
    for(const meal of ['lunchbox','outside'] as const){
      const members=shuffle(pool[meal],random);let offset=0;
      for(const size of sizes(members.length)){groups.push({id:`${date}-${groups.length+1}`,meal,members:members.slice(offset,offset+size)});offset+=size;}
    }
    // Strict choices are enforced by construction. Then minimize small groups,
    // soft-preference mismatches, five-person groups, repeat pairs, and imbalance.
    const cost=[
      groups.reduce((n,g)=>n+Math.max(0,3-g.members.length),0),
      groups.reduce((n,g)=>n+g.members.reduce((sum,p)=>sum+preferenceCost(choice[p.id].meal,g.meal),0),0),
      groups.filter(g=>g.members.length===5).length,
      groups.reduce((n,g)=>n+repeatCost(state,date,g.members),0),
      Math.abs(pool.lunchbox.length-pool.outside.length),
    ];
    if(!bestCost||compareCost(cost,bestCost)<0){best=groups;bestCost=cost;}
  }
  return best;
}
export function addMember(state:State,date:string,person:Person,meal:Meal,random=Math.random) {
  const day=state.days[date];if(day.groups.some(g=>g.members.some(p=>p.id===person.id)))return;
  const candidates=shuffle(day.groups.filter(g=>g.members.length<5&&allowsMeal(meal,g.meal)),random);
  const cost=(g:Group)=>[
    g.members.length<3?0:1,
    preferenceCost(meal,g.meal),
    g.members.length,
    -g.members.reduce((n,p)=>n+encounters(state,date,p.id,person.id),0),
  ];
  candidates.sort((a,b)=>compareCost(cost(a),cost(b)));
  if(candidates[0])candidates[0].members.push({...person});
  else {
    const total=(actual:MealType)=>day.groups.filter(g=>g.meal===actual).reduce((n,g)=>n+g.members.length,0);
    const actual=preferredMeal(meal)??(total('lunchbox')<=total('outside')?'lunchbox':'outside');
    day.groups.push({id:`${date}-${crypto.randomUUID()}`,meal:actual,members:[{...person}]});
  }
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
