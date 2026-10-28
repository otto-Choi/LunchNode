const {test}=require('node:test');const assert=require('node:assert/strict');
const ready=Promise.all([import('../lib/domain.ts'),import('../lib/roster.ts')]);
const date='2026-10-28';
function rng(seed=31){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function make(d,people,meals){const state=d.emptyState();state.choices[date]=Object.fromEntries(people.map((p,i)=>[p.id,{status:'join',meal:meals[i]}]));return state;}
function verify(d,state,people,groups){assert.equal(new Set(groups.flatMap(g=>g.members.map(p=>p.id))).size,people.length);for(const g of groups){assert.ok(g.members.length>=1&&g.members.length<=d.groupLimit(g,state.choices[date]));for(const p of g.members)assert.ok(d.allowsMeal(state.choices[date][p.id].meal,g.meal));}}
test('mandatory menu participants stay together before new encounters or demographic balance',async()=>{
 const [d,{ROSTER}]=await ready;const people=ROSTER.slice(0,8);
 for(const mandatory of ['lunchbox','outside']){
  const state=make(d,people,[mandatory,mandatory,mandatory,mandatory,'any','any','any','any']);
  state.days['2026-10-27']={phase:'final',matchedAt:'2026-10-26T22:00:00+09:00',groups:[{id:'repeat',meal:mandatory,members:people.slice(0,4)}]};
  const policy={effectiveDate:date,genderByName:Object.fromEntries(people.map((p,i)=>[p.name,i<4?1:2])),balanceClasses:true};
  const groups=d.initialMatch(state,date,people,rng(),policy);verify(d,state,people,groups);
  assert.deepEqual(new Set(groups.find(g=>g.members.some(p=>p.id===people[0].id)).members.map(p=>p.id)),new Set(people.slice(0,4).map(p=>p.id)));
 }
});
test('neutral and matching soft choices fill mandatory-menu groups without opposite soft choices',async()=>{
 const [d,{ROSTER}]=await ready;const people=ROSTER.slice(0,8);
 for(const [mandatory,same,opposite] of [['lunchbox','prefer_lunchbox','prefer_outside'],['outside','prefer_outside','prefer_lunchbox']]){
  const state=make(d,people,[mandatory,mandatory,same,'any',opposite,opposite,opposite,opposite]);
  const groups=d.initialMatch(state,date,people,rng());verify(d,state,people,groups);
  for(const g of groups)if(g.members.some(p=>state.choices[date][p.id].meal===mandatory))assert.ok(g.members.every(p=>state.choices[date][p.id].meal!==opposite));
 }
});
test('late arrivals favor mandatory peers and never use a fifth seat or force an opposite preference into a mandatory group',async()=>{
 const [d,{ROSTER}]=await ready;const people=ROSTER.slice(0,8),state=make(d,people,['lunchbox','lunchbox','lunchbox','lunchbox','any','any','any','prefer_outside']);
 state.days[date]={phase:'matched',matchedAt:'2026-10-26T22:00:00+09:00',groups:[{id:'mandatory',meal:'lunchbox',members:people.slice(1,4)},{id:'neutral',meal:'lunchbox',members:people.slice(4,7)}]};
 d.addMember(state,date,people[0],'lunchbox',rng());assert.equal(state.days[date].groups.find(g=>g.id==='mandatory').members.length,4);
 const before=structuredClone(state.days[date].groups);d.addMember(state,date,people[7],'prefer_outside',rng());assert.equal(state.days[date].groups.find(g=>g.members.some(p=>p.id===people[7].id)).id,'neutral');assert.deepEqual(state.days[date].groups[0],before[0]);
 state.days[date].groups=[{id:'only-strict',meal:'lunchbox',members:people.slice(1,4)}];d.addMember(state,date,people[7],'prefer_outside',rng());assert.equal(state.days[date].groups.find(g=>g.members.some(p=>p.id===people[7].id)).meal,'outside');
});
test('invalid provisional groups repair before cutoff while historical five-person groups remain unchanged',async()=>{
 const [d,{ROSTER}]=await ready;const state=make(d,ROSTER,Array(20).fill('any'));
 const old=Array.from({length:4},(_,i)=>({id:'old-'+i,meal:'lunchbox',members:ROSTER.slice(i*5,i*5+5)}));
 state.days['2026-10-27']={phase:'final',matchedAt:'2026-10-26T22:00:00+09:00',groups:structuredClone(old)};
 state.days[date]={phase:'matched',matchedAt:'2026-10-26T22:00:00+09:00',groups:structuredClone(old)};const history=structuredClone(state.days['2026-10-27']);
 d.syncDue(state,['2026-10-27',date],ROSTER,new Date('2026-10-28T10:00:00+09:00'),rng());verify(d,state,ROSTER,state.days[date].groups);assert.deepEqual(state.days['2026-10-27'],history);assert.equal(state.days[date].phase,'matched');
});


test('five seats are available only to a pure lunchbox-only group, including late joining',async()=>{
 const [d,{ROSTER}]=await ready;const people=ROSTER.slice(0,5);
 for(const meals of [Array(5).fill('lunchbox'),Array(5).fill('outside'),['lunchbox','lunchbox','lunchbox','lunchbox','any'],['lunchbox','lunchbox','lunchbox','lunchbox','prefer_lunchbox']]){
  const state=make(d,people,meals);const groups=d.initialMatch(state,date,people,rng());verify(d,state,people,groups);
  assert.equal(groups.some(g=>g.members.length===5),meals.every(m=>m==='lunchbox'));
 }
 const state=make(d,people,Array(5).fill('lunchbox'));state.days[date]={phase:'matched',matchedAt:'2026-10-26T22:00:00+09:00',groups:[{id:'box',meal:'lunchbox',members:people.slice(0,4)}]};
 d.addMember(state,date,people[4],'lunchbox',rng());assert.equal(state.days[date].groups[0].members.length,5);
 const mixed=make(d,people,['lunchbox','lunchbox','lunchbox','lunchbox','any']);mixed.days[date]={phase:'matched',matchedAt:'2026-10-26T22:00:00+09:00',groups:[{id:'box',meal:'lunchbox',members:people.slice(0,4)}]};
 d.addMember(mixed,date,people[4],'any',rng());assert.equal(mixed.days[date].groups[0].members.length,4);assert.equal(mixed.days[date].groups.length,2);
});
