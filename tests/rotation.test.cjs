const {test}=require('node:test');const assert=require('node:assert/strict');
const ready=Promise.all([import('../lib/domain.ts'),import('../lib/roster.ts')]);
function random(seed=37){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
const day=(groups)=>({groups,phase:'final',matchedAt:'2026-10-01T22:00:00+09:00'});
const group=(id,members,meal='lunchbox')=>({id,members,meal});
function repeats(groups,old){let count=0;for(const g of groups)for(let i=0;i<g.members.length;i++)for(let j=i+1;j<g.members.length;j++)if(old.some(h=>h.members.some(p=>p.id===g.members[i].id)&&h.members.some(p=>p.id===g.members[j].id)))count++;return count;}

test('initial rotation reaches the minimum two repeated pairs for six people and prioritizes new people over soft menus',async()=>{
 const [d,{ROSTER}]=await ready;const people=ROSTER.slice(0,6),state=d.emptyState(),date='2026-10-22';
 const old=[group('a',people.slice(0,3)),group('b',people.slice(3))];state.days['2026-10-21']=day(old);
 state.choices[date]=Object.fromEntries(people.map((p,i)=>[p.id,{status:'join',meal:i<3?'prefer_lunchbox':'prefer_outside'}]));
 const before=structuredClone(state);const groups=d.initialMatch(state,date,people,random());
 assert.equal(repeats(groups,old),2);assert.ok(groups.every(g=>g.members.length===3));assert.deepEqual(state,before);
 assert.ok(groups.some(g=>g.members.some(p=>d.preferredMeal(state.choices[date][p.id].meal)!==g.meal)));
});

test('late rotation avoids a recent meeting even if the alternative met often long ago',async()=>{
 const [d,{ROSTER}]=await ready;const person=ROSTER[0],date='2026-10-22',state=d.emptyState();
 for(const old of ['2026-10-01','2026-10-02','2026-10-05','2026-10-06'])state.days[old]=day([group('old',[person,...ROSTER.slice(4,7)])]);
 state.days['2026-10-21']=day([group('recent',[person,...ROSTER.slice(1,4)])]);
 state.days[date]={...day([group('recent',ROSTER.slice(1,4),'lunchbox'),group('older',ROSTER.slice(4,7),'outside')]),phase:'matched'};
 const original=structuredClone(state.days[date].groups);d.addMember(state,date,person,'prefer_lunchbox',random());
 assert.ok(state.days[date].groups[1].members.some(p=>p.id===person.id));
 for(let i=0;i<2;i++)assert.deepEqual(state.days[date].groups[i].members.filter(p=>p.id!==person.id),original[i].members);
});

test('late rotation prefers never-met people and honors strict menu choices',async()=>{
 const [d,{ROSTER}]=await ready;const person=ROSTER[0],date='2026-10-22';
 for(const meal of ['any','lunchbox']){
  const state=d.emptyState();state.days['2026-10-21']=day([group('past',[person,...ROSTER.slice(1,4)])]);
  state.days[date]={...day([group('known',ROSTER.slice(1,4),'lunchbox'),group('new',ROSTER.slice(4,7),'outside')]),phase:'matched'};
  d.addMember(state,date,person,meal,random());assert.ok(state.days[date].groups[meal==='any'?1:0].members.some(p=>p.id===person.id));
 }
});

test('20-person rotation avoids consecutive repeats across nine operating days',async()=>{
 const [d,{ROSTER}]=await ready;const state=d.emptyState(),rand=random();let previous=[];
 for(const date of d.weekdays('2026-10-22','2026-11-03')){
  state.choices[date]=Object.fromEntries(ROSTER.map(p=>[p.id,{status:'join',meal:'any'}]));
  const groups=d.initialMatch(state,date,ROSTER,rand);assert.equal(repeats(groups,previous),0,date);
  assert.equal(new Set(groups.flatMap(g=>g.members.map(p=>p.id))).size,20);assert.ok(groups.every(g=>g.members.length>=3&&g.members.length<=4));
  state.days[date]=day(groups);previous=groups;
 }
});

test('only earlier finalized days affect rotation and unavoidable strict groups stay valid',async()=>{
 const [d,{ROSTER}]=await ready;const people=ROSTER.slice(0,6),date='2026-10-22',state=d.emptyState();
 state.choices[date]=Object.fromEntries(people.map((p,i)=>[p.id,{status:'join',meal:i<3?'lunchbox':'outside'}]));
 state.days['2026-10-21']={...day([group('old',people.slice(0,3))]),phase:'matched'};
 state.days['2026-10-23']=day([group('future',people.slice(0,3))]);
 const clean={...state,days:{}};assert.deepEqual(d.initialMatch(state,date,people,random()),d.initialMatch(clean,date,people,random()));
 state.days['2026-10-21'].phase='final';const groups=d.initialMatch(state,date,people,random());
 for(const g of groups)for(const p of g.members)assert.ok(d.allowsMeal(state.choices[date][p.id].meal,g.meal));
 assert.deepEqual(groups.map(g=>g.members.length),[3,3]);
});


test('rematching discards provisional encounters; finalization counts only the replacement once',async()=>{
 const [d,{ROSTER}]=await ready;const date='2026-10-22',next='2026-10-23',people=ROSTER.slice(0,8),state=d.emptyState();
 state.choices[date]=Object.fromEntries(people.map(p=>[p.id,{status:'join',meal:'any'}]));
 const original=[group('old-a',people.slice(0,5)),group('old-b',people.slice(5))];state.days[date]={...day(original),phase:'matched'};
 const baseline=structuredClone(state);const clean=structuredClone(state);clean.days={};
 d.rematchDay(state,date,people,new Date('2026-10-22T10:00:00+09:00'),random());
 assert.deepEqual(state.days[date].groups.map(g=>g.members.length),[4,4]);assert.deepEqual(state.choices,baseline.choices);
 for(const a of people)for(const b of people)if(a.id!==b.id)assert.equal(d.encounters(state,next,a.id,b.id),0);
 assert.deepEqual(d.initialMatch(state,date,people,random()),d.initialMatch(clean,date,people,random()));
 const replacement=structuredClone(state.days[date].groups);d.syncDue(state,[date],people,new Date('2026-10-22T11:00:00+09:00'));
 for(let i=0;i<people.length;i++)for(let j=i+1;j<people.length;j++){
  const a=people[i],b=people[j];const together=replacement.some(g=>g.members.some(p=>p.id===a.id)&&g.members.some(p=>p.id===b.id));assert.equal(d.encounters(state,next,a.id,b.id),Number(together));
 }
 const final=structuredClone(state);assert.throws(()=>d.rematchDay(state,date,people,new Date('2026-10-22T11:00:00+09:00')),/11시/);assert.deepEqual(state,final);
});
