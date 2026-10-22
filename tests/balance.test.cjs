const {test}=require('node:test');const assert=require('node:assert/strict');
const ready=Promise.all([import('../lib/domain.ts'),import('../lib/roster.ts'),import('../lib/backend/matching-policy.ts')]);
function rng(seed=19){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function setup(d,people,date){const state=d.emptyState();state.choices[date]=Object.fromEntries(people.map(p=>[p.id,{status:'join',meal:'any'}]));return state;}
const values=(group,policy)=>group.members.map(p=>policy.genderByName[p.name]);
const imbalance=(groups,policy)=>groups.reduce((n,g)=>{const v=values(g,policy),difference=v.filter(x=>x===1).length-v.filter(x=>x===2).length;return n+difference*difference;},0);

test('operational input exactly covers the supplied roster with ten male and ten female values',async()=>{
 const [,{ROSTER},{matchingPolicy:p}]=await ready;assert.equal(p.effectiveDate,'2026-10-23');assert.deepEqual(Object.keys(p.genderByName).sort(),ROSTER.map(x=>x.name).sort());assert.equal(Object.values(p.genderByName).filter(v=>v===1).length,10);assert.equal(Object.values(p.genderByName).filter(v=>v===2).length,10);
 assert.equal(p.genderByName['양우진'],2);assert.equal(p.genderByName['손규영'],2);assert.equal(p.genderByName['박진영'],2);assert.equal(p.genderByName['권도영'],1);
});

test('policy activates at the next lunch and has no effect on earlier matching',async()=>{
 const [d,{ROSTER},{matchingPolicy:p}]=await ready;const date='2026-10-22',state=setup(d,ROSTER,date);
 assert.deepEqual(d.initialMatch(state,date,ROSTER,rng(),p),d.initialMatch(state,date,ROSTER,rng()));
 const next='2026-10-23';const s=setup(d,ROSTER,next);d.syncDue(s,[next],ROSTER,new Date('2026-10-22T21:59:59+09:00'),rng(),p);assert.equal(s.days[next],undefined);
 d.syncDue(s,[next],ROSTER,new Date('2026-10-22T22:00:00+09:00'),rng(),p);assert.deepEqual(s.days[next].groups.map(g=>g.members.length),[4,4,4,4,4]);assert.equal(imbalance(s.days[next].groups,p),0);
});

test('20 attendees form five 2:2 groups and 17 default attendees have balanced odd groups',async()=>{
 const [d,{ROSTER},{matchingPolicy:p}]=await ready;for(const people of [ROSTER,ROSTER.slice(0,17)])for(const seed of [3,19,71]){
  const date='2026-10-23',state=setup(d,people,date),groups=d.initialMatch(state,date,people,rng(seed),p);assert.equal(new Set(groups.flatMap(g=>g.members.map(x=>x.id))).size,people.length);
  for(const g of groups){const v=values(g,p);assert.ok(Math.abs(v.filter(x=>x===1).length-v.filter(x=>x===2).length)<=1);}
 }
});

test('balance is prioritized over historical encounters and soft preferences, while hard menus remain mandatory',async()=>{
 const [d,{ROSTER},{matchingPolicy:p}]=await ready;const males=ROSTER.filter(x=>p.genderByName[x.name]===1).slice(0,4),females=ROSTER.filter(x=>p.genderByName[x.name]===2).slice(0,4),people=[...males,...females],date='2026-10-23',state=setup(d,people,date);
 state.days['2026-10-22']={phase:'final',matchedAt:'2026-10-21T22:00:00+09:00',groups:[{id:'a',meal:'lunchbox',members:[...males.slice(0,2),...females.slice(0,2)]},{id:'b',meal:'outside',members:[...males.slice(2),...females.slice(2)]}]};
 for(const x of males)state.choices[date][x.id].meal='prefer_lunchbox';for(const x of females)state.choices[date][x.id].meal='prefer_outside';assert.equal(imbalance(d.initialMatch(state,date,people,rng(),p),p),0);
 for(const x of males)state.choices[date][x.id].meal='lunchbox';for(const x of females)state.choices[date][x.id].meal='outside';const groups=d.initialMatch(state,date,people,rng(),p);for(const g of groups)for(const x of g.members)assert.equal(g.meal,state.choices[date][x.id].meal);assert.deepEqual(groups.map(g=>g.members.length),[4,4]);
});

test('unequal attendance is distributed as evenly as feasible and never excludes anyone',async()=>{
 const [d,{ROSTER},{matchingPolicy:p}]=await ready;const males=ROSTER.filter(x=>p.genderByName[x.name]===1).slice(0,6),females=ROSTER.filter(x=>p.genderByName[x.name]===2).slice(0,2),people=[...males,...females],date='2026-10-23',state=setup(d,people,date);
 const groups=d.initialMatch(state,date,people,rng(),p);assert.deepEqual(groups.map(g=>g.members.length),[4,4]);assert.equal(imbalance(groups,p),8);assert.equal(groups.flatMap(g=>g.members).length,8);
 const only=setup(d,males,date);assert.equal(d.initialMatch(only,date,males,rng(),p).flatMap(g=>g.members).length,6);
});

test('late joining improves the overall balance without moving any existing member',async()=>{
 const [d,{ROSTER},{matchingPolicy:p}]=await ready;const males=ROSTER.filter(x=>p.genderByName[x.name]===1),females=ROSTER.filter(x=>p.genderByName[x.name]===2),person=males[2],date='2026-10-23',state=d.emptyState();
 const groups=[{id:'a',meal:'lunchbox',members:[males[0],males[1],females[0]]},{id:'b',meal:'outside',members:females.slice(1,4)}];state.days[date]={phase:'matched',matchedAt:'2026-10-22T22:00:00+09:00',groups:structuredClone(groups)};
 d.setChoice(state,date,person,{status:'join',meal:'any'},new Date('2026-10-23T09:00:00+09:00'),p);assert.ok(state.days[date].groups[1].members.some(x=>x.id===person.id));for(let i=0;i<2;i++)assert.deepEqual(state.days[date].groups[i].members.filter(x=>x.id!==person.id),groups[i].members);
});

test('final history remains immutable and neither stored people nor state gains policy data',async()=>{
 const [d,{ROSTER},{matchingPolicy:p}]=await ready;const date='2026-10-23',state=setup(d,ROSTER,date);d.syncDue(state,[date],ROSTER,new Date('2026-10-23T11:00:00+09:00'),rng(),p);const before=structuredClone(state);d.syncDue(state,[date],ROSTER,new Date('2026-10-24T11:00:00+09:00'),rng(8),p);assert.deepEqual(state,before);assert.ok(!JSON.stringify(state).includes('gender'));
});
