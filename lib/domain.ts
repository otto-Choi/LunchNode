export const MEAL_OPTIONS = ['lunchbox','prefer_lunchbox','any','prefer_outside','outside'] as const;
export type Meal = typeof MEAL_OPTIONS[number];
export type MatchingPolicy = { effectiveDate:string; genderByName:Readonly<Record<string,1|2>> };
export type MealType = 'lunchbox' | 'outside';
export type Choice = { status: 'unset' | 'join' | 'absent'; meal: Meal };
export type Person = { id: string; name: string; className: string; defaultStatus?: 'unset' | 'absent' };
export type Group = { id: string; meal: MealType; members: Person[] };
export type Day = { groups: Group[]; phase: 'matched'|'final'; matchedAt: string; finalizedAt?: string; rematchedAt?: string };
export type ChoiceOrigin = 'selected'|'default';
export type State = { choiceOrigins?:Record<string,Record<string,ChoiceOrigin>>; choices: Record<string, Record<string,Choice>>; days: Record<string,Day>; events: {date:string; userId:string; action:string; at:string}[] };
export const emptyState = (): State => ({choices:{},days:{},events:[]});
export function defaultChoice(person: Pick<Person,'defaultStatus'>): Choice { return {status:person.defaultStatus||'unset',meal:'any'}; }
export function applyDefaults(state:State,dates:string[],people:Person[]) {
  for(const date of dates){const choices=state.choices[date]??={};for(const person of people)if(!choices[person.id]){choices[person.id]=defaultChoice(person);((state.choiceOrigins??={})[date]??={})[person.id]='default';}}
}
// Keep the legacy lunchbox/outside keys as strict choices; existing saved requests need no conversion.
export const mealNames: Record<Meal,string> = {lunchbox:'도시락만',prefer_lunchbox:'도시락선호',any:'상관없음',prefer_outside:'외식선호',outside:'외식만'};
export const groupMealNames: Record<MealType,string> = {lunchbox:'도시락',outside:'외식'};
export function isMeal(value:unknown): value is Meal {return typeof value==='string' && (MEAL_OPTIONS as readonly string[]).includes(value);}
export function preferredMeal(meal:Meal):MealType|undefined {return meal==='lunchbox'||meal==='prefer_lunchbox'?'lunchbox':meal==='outside'||meal==='prefer_outside'?'outside':undefined;}
export function attendanceLabel(person:Person,choice:Choice,origin?:ChoiceOrigin) {
  if(choice.status==='join')return '참석';
  if(choice.status==='unset')return '미선택';
  if(origin==='selected'||person.defaultStatus!=='absent')return '불참 선택';
  if(origin==='default')return '기본 불참';
  return '불참 · 선택 여부 미확인';
}
export function assignmentOverview(state:State,date:string,people:Person[]) {
  // Always use all groups, not the UI's "my groups" filter.
  const assigned=new Set((state.days[date]?.groups||[]).flatMap(g=>g.members.map(p=>p.id)));
  const unassigned=people.filter(p=>!assigned.has(p.id)).sort((a,b)=>Number(a.className==='12월 입사자')-Number(b.className==='12월 입사자')).map(person=>({person,choice:state.choices[date]?.[person.id]||defaultChoice(person)}));
  return {assignedCount:people.length-unassigned.length,unassigned,unassignedJoined:unassigned.filter(row=>row.choice.status==='join').length};
}
export function allowsMeal(meal:Meal,actual:MealType) {return meal!=='lunchbox'&&meal!=='outside'||meal===actual;}
function preferenceCost(meal:Meal,actual:MealType) {const preferred=preferredMeal(meal);return preferred&&preferred!==actual?1:0;}
function compareCost(a:number[],b:number[]) {for(let i=0;i<a.length;i++){const difference=a[i]-b[i];if(difference)return difference;}return 0;}
export function seoulDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function defaultResultsDate(dates:string[],now=new Date()) {
  const today=seoulDate(now),afterLunch=now>=new Date(`${today}T13:00:00+09:00`);
  return dates.find(date=>afterLunch?date>today:date>=today)||dates.at(-1)||'';
}
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
  return possibilities.sort((a,b)=>compareCost([a.filter(x=>x===5).length,a.filter(x=>x===3).length],[b.filter(x=>x===5).length,b.filter(x=>x===3).length]))[0];
}
export function encounters(state:State, date:string, a:string, b:string) {
  return Object.entries(state.days).filter(([d,v])=>d<date&&v.phase==='final').reduce((n,[,v])=>n+Number(v.groups.some(g=>g.members.some(p=>p.id===a)&&g.members.some(p=>p.id===b))),0);
}
// Lexicographic cost: avoid tiny groups, minimize five-person groups, maximize
// four-person groups, then avoid recent/cumulative repeats and soft menu mismatches. BigInt keeps
// every historical date significant without floating-point weight loss.
function matchingCosts(state:State,date:string,people:Person[],policy?:MatchingPolicy) {
  const history=Object.entries(state.days).filter(([d,v])=>d<date&&v.phase==='final').sort(([a],[b])=>a.localeCompare(b));
  const index=new Map(people.map((p,i)=>[p.id,i]));
  const counts=people.map(()=>people.map(()=>0));
  const latest=people.map(()=>people.map(()=>-1));
  history.forEach(([,day],dayIndex)=>{for(const group of day.groups)for(let i=0;i<group.members.length;i++)for(let j=i+1;j<group.members.length;j++){
    const a=index.get(group.members[i].id),b=index.get(group.members[j].id);if(a===undefined||b===undefined)continue;
    counts[a][b]++;counts[b][a]++;latest[a][b]=latest[b][a]=dayIndex;
  }});
  // A group plan has at most n*(n-1)/2 pairs. Each recency digit therefore cannot carry.
  const base=BigInt(Math.max(2,people.length*people.length+1));
  const preferenceUnit=1n;
  const frequencyUnit=preferenceUnit*BigInt(people.length+1);
  const recencyUnit=frequencyUnit*BigInt(history.length*people.length*people.length+1);
  const pairs=people.map((_,i)=>people.map((__,j)=>latest[i][j]<0?0n:recencyUnit*base**BigInt(latest[i][j])+BigInt(counts[i][j])*frequencyUnit));
  const balanceUnit=recencyUnit*base**BigInt(history.length+1);
  const activePolicy=policy&&date>=policy.effectiveDate?policy:undefined;
  const balanceCost=(members:Person[])=>{
    if(!activePolicy)return 0n;
    let difference=0;for(const person of members){const value=activePolicy.genderByName[person.name];if(value===1)difference++;else if(value===2)difference--;}
    return BigInt(difference*difference);
  };
  // Across all groups the squared imbalance cannot exceed n*n.
  const threeUnit=activePolicy?balanceUnit*BigInt(people.length*people.length+1):balanceUnit;
  const fiveUnit=threeUnit*BigInt(people.length+1);
  const smallUnit=fiveUnit*BigInt(people.length+1);
  return {pairs,index,smallUnit,preferenceUnit,fiveUnit,threeUnit,balanceUnit,balanceCost};
}
export function initialMatch(state:State,date:string,people:Person[],random=Math.random,policy?:MatchingPolicy):Group[] {
  const choices=state.choices[date]??{};
  const joined=shuffle(people.filter(p=>choices[p.id]?.status==='join'),random);
  if(!joined.length)return [];
  const weights=matchingCosts(state,date,joined,policy);
  const evaluate=(members:Person[],meal:MealType)=>{
    let cost=BigInt(Math.max(0,3-members.length))*weights.smallUnit+(members.length===5?weights.fiveUnit:members.length===3?weights.threeUnit:0n);
    cost+=weights.balanceCost(members)*weights.balanceUnit;
    for(let i=0;i<members.length;i++){
      cost+=BigInt(preferenceCost(choices[members[i].id].meal,meal))*weights.preferenceUnit;
      for(let j=i+1;j<members.length;j++)cost+=weights.pairs[weights.index.get(members[i].id)!][weights.index.get(members[j].id)!];
    }
    return cost;
  };
  const build=(pool:Record<MealType,Person[]>)=>{
    const groups:Group[]=[];
    for(const meal of ['lunchbox','outside'] as const){let offset=0;const members=shuffle(pool[meal],random);
      for(const size of sizes(members.length)){groups.push({id:'',meal,members:members.slice(offset,offset+size)});offset+=size;}}
    return groups;
  };
  const strictBox=joined.filter(p=>choices[p.id].meal==='lunchbox'),strictOut=joined.filter(p=>choices[p.id].meal==='outside');
  const flexible=joined.filter(p=>!['lunchbox','outside'].includes(choices[p.id].meal));
  let best:Group[]=[],bestCost:bigint|undefined;
  // Seed the bounded exact-cover search with complete valid assignments.
  for(let attempt=0;attempt<160;attempt++){
    const ordered=attempt%2===0?[
      ...shuffle(flexible.filter(p=>choices[p.id].meal==='prefer_lunchbox'),random),
      ...shuffle(flexible.filter(p=>choices[p.id].meal==='any'),random),
      ...shuffle(flexible.filter(p=>choices[p.id].meal==='prefer_outside'),random),
    ]:shuffle(flexible,random);
    const split=Math.floor(attempt/2)%(flexible.length+1);
    const groups=build({lunchbox:[...strictBox,...ordered.slice(0,split)],outside:[...strictOut,...ordered.slice(split)]});
    const cost=groups.reduce((n,g)=>n+evaluate(g.members,g.meal),0n);
    if(bestCost===undefined||cost<bestCost){best=groups;bestCost=cost;}
    if(bestCost===0n)break;
  }
  // Fixed roster is 20 people. Enumerate all legal groups, then search combinations
  // with memoization and branch-and-bound. Work budgets keep concurrent API calls bounded.
  if(bestCost!==0n){
    type Candidate={mask:number;group:Group;cost:bigint};
    const byPerson:Candidate[][]=joined.map(()=>[]);
    function enumerate(indices:number[],start:number,mask:number,box:boolean,out:boolean){
      if(indices.length){
        const members=indices.map(i=>joined[i]);let meal:MealType=box?'lunchbox':'outside';
        if(box&&out){const a=evaluate(members,'lunchbox'),b=evaluate(members,'outside');meal=a<b?'lunchbox':a>b?'outside':random()<.5?'lunchbox':'outside';}
        const candidate={mask,group:{id:'',meal,members},cost:evaluate(members,meal)};
        for(const i of indices)byPerson[i].push(candidate);
      }
      if(indices.length===5)return;
      for(let i=start;i<joined.length;i++){
        const nextBox=box&&allowsMeal(choices[joined[i].id].meal,'lunchbox');
        const nextOut=out&&allowsMeal(choices[joined[i].id].meal,'outside');
        if(nextBox||nextOut)enumerate([...indices,i],i+1,mask|(1<<i),nextBox,nextOut);
      }
    }
    enumerate([],0,0,true,true);
    for(const list of byPerson)list.sort((a,b)=>a.cost<b.cost?-1:a.cost>b.cost?1:0);
    const memo=new Map<number,bigint>();let nodes=0,checks=0;
    function search(remaining:number,cost:bigint,groups:Group[]){
      if(cost>=bestCost!||nodes++>=20000||checks>=500000)return;
      if(!remaining){best=groups;bestCost=cost;return;}
      const previous=memo.get(remaining);if(previous!==undefined&&previous<=cost)return;memo.set(remaining,cost);
      const pivot=31-Math.clz32(remaining&-remaining);
      for(const candidate of byPerson[pivot]){
        if(++checks>500000||bestCost===0n)break;
        if(cost+candidate.cost>=bestCost!)break;
        if((candidate.mask&remaining)!==candidate.mask)continue;
        search(remaining^candidate.mask,cost+candidate.cost,[...groups,candidate.group]);
      }
    }
    search((1<<joined.length)-1,0n,[]);
  }
  const assigned=best.flatMap(g=>g.members.map(p=>p.id));
  if(assigned.length!==joined.length||new Set(assigned).size!==joined.length||joined.some(p=>!assigned.includes(p.id)))throw new Error('참석자 배정 확인에 실패했습니다. 다시 시도해 주세요.');
  return best.map((g,i)=>({...g,id:`${date}-${i+1}`}));
}
export function addMember(state:State,date:string,person:Person,meal:Meal,random=Math.random,policy?:MatchingPolicy) {
  const day=state.days[date];if(day.groups.some(g=>g.members.some(p=>p.id===person.id)))return;
  const people=[person,...day.groups.flatMap(g=>g.members)];
  const weights=matchingCosts(state,date,people,policy);
  const compatible=day.groups.filter(g=>g.members.length<5&&allowsMeal(meal,g.meal));
  // Preserve existing assignments while avoiding a fifth member whenever a smaller compatible group exists.
  const belowFour=compatible.filter(g=>g.members.length<4);
  const candidates=shuffle(belowFour.length?belowFour:compatible,random);
  // Compare the change in total imbalance, rather than the resulting group alone.
  const cost=(g:Group)=>(weights.balanceCost([...g.members,person])-weights.balanceCost(g.members))*weights.balanceUnit+g.members.reduce((n,p)=>n+weights.pairs[0][weights.index.get(p.id)!],0n);
  candidates.sort((a,b)=>{
    const ca=cost(a),cb=cost(b);if(ca!==cb)return ca<cb?-1:1;
    return compareCost([a.members.length<3?0:1,preferenceCost(meal,a.meal),a.members.length],[b.members.length<3?0:1,preferenceCost(meal,b.meal),b.members.length]);
  });
  if(candidates[0])candidates[0].members.push({...person});
  else {
    const total=(actual:MealType)=>day.groups.filter(g=>g.meal===actual).reduce((n,g)=>n+g.members.length,0);
    const actual=preferredMeal(meal)??(total('lunchbox')<=total('outside')?'lunchbox':'outside');
    day.groups.push({id:`${date}-${crypto.randomUUID()}`,meal:actual,members:[{...person}]});
  }
}
// Replaces an unfinalized assignment in place. Discarded groups never enter history.
export function rematchDay(state:State,date:string,people:Person[],now=new Date(),random=Math.random,policy?:MatchingPolicy) {
  if(now>=cutoff(date)||state.days[date]?.phase==='final')throw new Error('오전 11시 마감 이후에는 재편성할 수 없습니다.');
  if(now<matchTime(date)||!state.days[date])throw new Error('최초 편성 이후에만 재편성할 수 있습니다.');
  state.days[date]={...state.days[date],groups:initialMatch(state,date,people,random,policy),rematchedAt:now.toISOString()};
  return state.days[date];
}
export function syncDue(state:State,dates:string[],people:Person[],now=new Date(),random=Math.random,policy?:MatchingPolicy) {
  applyDefaults(state,dates,people);
  for(const date of dates){if(now<matchTime(date))continue;
    if(!state.days[date])state.days[date]={groups:initialMatch(state,date,people,random,policy),phase:'matched',matchedAt:now.toISOString()};
    if(state.days[date].phase!=='final'){
      const assigned=new Set(state.days[date].groups.flatMap(g=>g.members.map(p=>p.id)));
      for(const person of people)if(state.choices[date]?.[person.id]?.status==='join'&&!assigned.has(person.id)){
        addMember(state,date,person,state.choices[date][person.id].meal,random,policy);assigned.add(person.id);
      }
    }
    if(now>=cutoff(date)&&state.days[date].phase!=='final'){state.days[date].phase='final';state.days[date].finalizedAt=now.toISOString();}
  }
}
export function setChoice(state:State,date:string,person:Person,choice:Choice,now=new Date(),policy?:MatchingPolicy) {
  if(now>=cutoff(date))throw new Error('오전 11시 마감 이후에는 변경할 수 없습니다.');
  const origin:ChoiceOrigin=choice.status==='unset'?'default':'selected';
  if(choice.status==='unset')choice=defaultChoice(person);
  if(state.days[date]?.phase==='final')throw new Error('이미 확정된 날짜입니다.');
  ((state.choiceOrigins??={})[date]??={})[person.id]=origin;
  const previous=state.choices[date]?.[person.id];
  if(state.days[date]){
    const day=state.days[date];if(day.phase==='final')throw new Error('이미 확정된 날짜입니다.');
    if(choice.status==='join'&&previous?.status==='join'&&choice.meal===previous.meal&&day.groups.some(g=>g.members.some(p=>p.id===person.id)))return;
    day.groups=day.groups.map(g=>({...g,members:g.members.filter(p=>p.id!==person.id)})).filter(g=>g.members.length);
    if(choice.status==='join')addMember(state,date,person,choice.meal,Math.random,policy);
  }
  (state.choices[date]??={})[person.id]={...choice};
  state.events.push({date,userId:person.id,action:choice.status==='join'?`참여:${choice.meal}`:choice.status==='absent'?'불참':'미응답',at:now.toISOString()});
}
