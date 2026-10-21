const {test}=require('node:test');
const assert=require('node:assert/strict');
const ready=Promise.all([import('../lib/domain.ts'),import('../lib/roster.ts')]);
async function fixture(meals){const [d,{ROSTER}]=await ready;const people=ROSTER.slice(0,meals.length);const state=d.emptyState();const date='2026-10-22';state.choices[date]=Object.fromEntries(people.map((p,i)=>[p.id,{status:'join',meal:meals[i]}]));let seed=81;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};return {d,state,people,date,random};}
const assignment=(groups,id)=>groups.find(g=>g.members.some(p=>p.id===id))?.meal;

test('the five ordered menu choices retain neutral defaults and legacy strict keys',async()=>{
 const [d,{ROSTER}]=await ready;assert.deepEqual(d.MEAL_OPTIONS.map(m=>d.mealNames[m]),['도시락만','도시락선호','상관없음','외식선호','외식만']);
 for(const person of ROSTER)assert.equal(d.defaultChoice(person).meal,'any');
 for(const meal of d.MEAL_OPTIONS)assert.equal(d.isMeal(meal),true);for(const meal of ['prefer','external',null,{},1])assert.equal(d.isMeal(meal),false);
 assert.equal(d.allowsMeal('lunchbox','outside'),false);assert.equal(d.allowsMeal('outside','lunchbox'),false);
});
test('initial matching honors soft preferences when both groups can be formed',async()=>{
 const f=await fixture(['lunchbox','lunchbox','prefer_lunchbox','outside','outside','prefer_outside']);
 const groups=f.d.initialMatch(f.state,f.date,f.people,f.random);assert.deepEqual(groups.map(g=>g.members.length),[3,3]);
 for(let i=0;i<f.people.length;i++)assert.equal(assignment(groups,f.people[i].id),i<3?'lunchbox':'outside');
});
test('soft preferences may move to resolve a small group, strict preferences never do',async()=>{
 for(const [preferred,strict,actual]of [['prefer_lunchbox','outside','outside'],['prefer_outside','lunchbox','lunchbox']]){
  const f=await fixture([preferred,preferred,strict,strict,strict]);const groups=f.d.initialMatch(f.state,f.date,f.people,f.random);assert.equal(groups.length,1);assert.equal(groups[0].meal,actual);assert.equal(groups[0].members.length,5);
 }
 const f=await fixture(['lunchbox','lunchbox','outside','outside','outside']);const groups=f.d.initialMatch(f.state,f.date,f.people,f.random);assert.equal(groups.length,2);assert.equal(assignment(groups,f.people[0].id),'lunchbox');assert.equal(assignment(groups,f.people[2].id),'outside');
});
test('all soft preferences can remain in the preferred mode without artificial balancing',async()=>{
 for(const [meal,actual]of [['prefer_lunchbox','lunchbox'],['prefer_outside','outside']]){
  const f=await fixture(Array(8).fill(meal));const groups=f.d.initialMatch(f.state,f.date,f.people,f.random);assert.ok(groups.every(g=>g.meal===actual&&g.members.length===4));
 }
});
test('mixed matching preserves every participant and every strict restriction',async()=>{
 const [d]=await ready;
 for(let seed=0;seed<25;seed++){
  const meals=Array.from({length:20},(_,i)=>d.MEAL_OPTIONS[(i*7+seed)%5]);const f=await fixture(meals);const groups=d.initialMatch(f.state,f.date,f.people,f.random);
  assert.equal(new Set(groups.flatMap(g=>g.members.map(p=>p.id))).size,20);
  for(const g of groups){assert.ok(['lunchbox','outside'].includes(g.meal));assert.ok(g.members.length<=5);for(const p of g.members)assert.ok(d.allowsMeal(f.state.choices[f.date][p.id].meal,g.meal));}
 }
});
test('late joining prefers a compatible mode, falls back when full, and never relocates others',async()=>{
 const [d,{ROSTER}]=await ready;const date='2026-10-22';
 for(const [meal,expected]of [['prefer_lunchbox','lunchbox'],['prefer_outside','outside']]){
  const state=d.emptyState();state.days[date]={phase:'matched',matchedAt:'2026-10-21T22:00:00+09:00',groups:[{id:'box',meal:'lunchbox',members:ROSTER.slice(0,3)},{id:'out',meal:'outside',members:ROSTER.slice(3,6)}]};
  const previous=Object.fromEntries(state.days[date].groups.flatMap(g=>g.members.map(p=>[p.id,g.id])));
  d.setChoice(state,date,ROSTER[8],{status:'join',meal},new Date('2026-10-22T09:00:00+09:00'));
  assert.equal(assignment(state.days[date].groups,ROSTER[8].id),expected);
  for(const g of state.days[date].groups)for(const p of g.members)if(p.id!==ROSTER[8].id)assert.equal(g.id,previous[p.id]);
 }
 for(const meal of ['prefer_lunchbox','lunchbox']){
  const state=d.emptyState();state.days[date]={phase:'matched',matchedAt:'2026-10-21T22:00:00+09:00',groups:[{id:'full',meal:'lunchbox',members:ROSTER.slice(0,5)},{id:'vacancy',meal:'outside',members:ROSTER.slice(5,8)}]};
  d.setChoice(state,date,ROSTER[9],{status:'join',meal},new Date('2026-10-22T09:00:00+09:00'));
  assert.equal(assignment(state.days[date].groups,ROSTER[9].id),meal==='lunchbox'?'lunchbox':'outside');
  assert.equal(state.days[date].groups[0].members.length,5);
 }
});
