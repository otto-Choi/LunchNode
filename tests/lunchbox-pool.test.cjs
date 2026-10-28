const {test}=require('node:test');const assert=require('node:assert/strict');
const ready=Promise.all([import('../lib/domain.ts'),import('../lib/roster.ts'),import('../lib/backend/global-roster.ts'),import('../lib/backend/tmt-roster.ts')]);
const date='2026-10-29';
function rng(seed=42){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function setup(d,people,meals,day=date){const s=d.emptyState();s.choices[day]=Object.fromEntries(people.map((p,i)=>[p.id,{status:'join',meal:meals[i]}]));return s;}
function verify(d,s,people,groups){const ids=groups.flatMap(g=>g.members.map(p=>p.id));assert.deepEqual([...ids].sort(),people.filter(p=>s.choices[date]?.[p.id]?.status==='join').map(p=>p.id).sort());assert.equal(ids.length,new Set(ids).size);for(const g of groups)if(!d.isLunchboxPool(g)){assert.ok(g.members.length<=4);assert.ok(g.members.every(p=>s.choices[date][p.id].meal!=='lunchbox'));}}
test('every headquarters isolates strict lunchbox attendees while all other preferences form groups of at most four',async()=>{
 const [d,{ROSTER},{GLOBAL_ROSTER},{TMT_ROSTER}]=await ready;
 for(const people of [ROSTER,GLOBAL_ROSTER,TMT_ROSTER]){
  const meals=people.map((_,i)=>i<8?'lunchbox':['any','prefer_lunchbox','prefer_outside','outside'][i%4]);const s=setup(d,people,meals);
  const groups=d.initialMatch(s,date,people,rng());verify(d,s,people,groups);const pools=groups.filter(d.isLunchboxPool);
  assert.equal(pools.length,1);assert.equal(pools[0].members.length,8);assert.equal(pools[0].meal,'lunchbox');assert.ok(pools[0].members.every(p=>s.choices[date][p.id].meal==='lunchbox'));
  assert.deepEqual(groups.filter(g=>!d.isLunchboxPool(g)).map(g=>d.groupNumber(groups,g)),groups.filter(g=>!d.isLunchboxPool(g)).map((_,i)=>i+1));
 }
});
test('one to twenty lunchbox-only attendees always form one unlimited pool',async()=>{
 const [d,{ROSTER}]=await ready;for(let n=1;n<=20;n++){const people=ROSTER.slice(0,n),s=setup(d,people,Array(n).fill('lunchbox'));const groups=d.initialMatch(s,date,people,rng());assert.equal(groups.length,1);assert.equal(groups[0].kind,'lunchbox_pool');assert.equal(groups[0].members.length,n);verify(d,s,people,groups);}
});
test('new rules start on Oct 29 and never rewrite current or finalized assignments',async()=>{
 const [d,{ROSTER}]=await ready;const people=ROSTER.slice(0,8),old='2026-10-28',s=setup(d,people,Array(8).fill('lunchbox'),old);
 const oldGroups=d.initialMatch(s,old,people,rng());assert.ok(oldGroups.every(g=>!d.isLunchboxPool(g)&&g.members.length<=5));
 s.days[old]={phase:'final',matchedAt:'2026-10-27T22:00:00+09:00',groups:oldGroups};const snapshot=structuredClone(s.days[old]);s.choices[date]=Object.fromEntries(people.map(p=>[p.id,{status:'join',meal:'lunchbox'}]));
 d.syncDue(s,[old,date],people,new Date('2026-10-28T21:59:59+09:00'),rng());assert.deepEqual(s.days[old],snapshot);assert.equal(s.days[date],undefined);
 d.syncDue(s,[old,date],people,new Date('2026-10-28T22:00:00+09:00'),rng());assert.deepEqual(s.days[old],snapshot);assert.equal(s.days[date].groups[0].kind,'lunchbox_pool');assert.equal(s.days[date].groups[0].members.length,8);
});
test('late attendees and menu changes use the pool without moving regular group members',async()=>{
 const [d,{ROSTER}]=await ready;const people=ROSTER.slice(0,10),s=setup(d,people,['lunchbox','lunchbox','lunchbox','lunchbox','lunchbox','lunchbox','any','any','any','any']);
 s.days[date]={phase:'matched',matchedAt:'2026-10-28T22:00:00+09:00',groups:d.initialMatch(s,date,people.slice(0,9),rng())};
 const before=structuredClone(s.days[date].groups.find(g=>!d.isLunchboxPool(g)));d.addMember(s,date,people[9],'any',rng());assert.deepEqual(s.days[date].groups.find(g=>g.id===before.id).members.slice(0,before.members.length),before.members);
 const now=new Date('2026-10-29T10:00:00+09:00');d.setChoice(s,date,people[9],{status:'join',meal:'lunchbox'},now);assert.equal(s.days[date].groups.find(d.isLunchboxPool).members.length,7);
 d.setChoice(s,date,people[0],{status:'join',meal:'prefer_lunchbox'},now);assert.ok(!s.days[date].groups.find(d.isLunchboxPool).members.some(p=>p.id===people[0].id));
 d.setChoice(s,date,people[1],{status:'absent',meal:'lunchbox'},now);verify(d,s,people,s.days[date].groups);
});
test('lunchbox pools are excluded from encounter history and regular group numbering',async()=>{
 const [d,{ROSTER}]=await ready;const s=setup(d,ROSTER.slice(0,2),['any','any']);const group={id:'pool',kind:'lunchbox_pool',meal:'lunchbox',members:ROSTER.slice(0,2)};
 s.days['2026-10-28']={phase:'final',matchedAt:'2026-10-27T22:00:00+09:00',groups:[group]};assert.equal(d.encounters(s,date,ROSTER[0].id,ROSTER[1].id),0);
 delete group.kind;assert.equal(d.encounters(s,date,ROSTER[0].id,ROSTER[1].id),1);
});
test('operator rematching uses the pool and preserves prior final snapshots',async()=>{
 const [d,{ROSTER}]=await ready;const people=ROSTER.slice(0,12),s=setup(d,people,people.map((_,i)=>i<7?'lunchbox':'outside'));
 s.days[date]={phase:'matched',matchedAt:'2026-10-28T22:00:00+09:00',groups:d.initialMatch(s,date,people,rng())};
 const result=d.rematchDay(s,date,people,new Date('2026-10-29T10:00:00+09:00'),rng(8));verify(d,s,people,result.groups);assert.equal(result.groups.filter(d.isLunchboxPool).length,1);assert.equal(result.groups.find(d.isLunchboxPool).members.length,7);
 assert.throws(()=>d.rematchDay(s,date,people,new Date('2026-10-29T11:00:00+09:00')),/마감/);
});
