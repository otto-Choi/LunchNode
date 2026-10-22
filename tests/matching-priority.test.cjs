const {test}=require('node:test');const assert=require('node:assert/strict');
const ready=import('../lib/domain.ts');
const date='2026-10-23';
function person(id,className){return {id,name:id,className};}
function policy(people,genders){return {effectiveDate:date,balanceClasses:true,genderByName:Object.fromEntries(people.map((p,i)=>[p.name,genders[i]]))};}
function rng(seed=19){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function makeDay(groups,phase='matched'){return {groups,phase,matchedAt:'2026-10-22T22:00:00+09:00'};}
const g=(id,members,meal='lunchbox')=>({id,members,meal});
function base(d,people){const state=d.emptyState();state.choices[date]=Object.fromEntries(people.map(p=>[p.id,{status:'join',meal:'any'}]));return state;}

test('with equal history and gender, initial matching balances cohorts ahead of soft menus',async()=>{
 const d=await ready,people=Array.from({length:8},(_,i)=>person(`p${i}`,i<4?'4반':'5반')),p=policy(people,Array(8).fill(1)),s=base(d,people);
 people.forEach((x,i)=>s.choices[date][x.id].meal=i<4?'prefer_lunchbox':'prefer_outside');
 const groups=d.initialMatch(s,date,people,rng(),p);assert.deepEqual(groups.map(x=>x.members.length),[4,4]);for(const group of groups)assert.equal(group.members.filter(x=>x.className==='4반').length,2);
});

test('December hires are spread as a third cohort rather than concentrated together',async()=>{
 const d=await ready,people=Array.from({length:12},(_,i)=>person(`p${i}`,i<4?'4반':i<8?'5반':'12월 입사자')),p=policy(people,Array(12).fill(1)),s=base(d,people),groups=d.initialMatch(s,date,people,rng(),p);
 assert.deepEqual(groups.map(x=>x.members.length),[4,4,4]);for(const group of groups){const counts=new Map();for(const x of group.members)counts.set(x.className,(counts.get(x.className)||0)+1);assert.equal(counts.size,3);assert.ok(Math.max(...counts.values())<=2);}
});

test('gender balance precedes cohort balance for late arrivals',async()=>{
 const d=await ready,people=Array.from({length:7},(_,i)=>person(`p${i}`,i<4?'4반':'5반')),p=policy(people,[1,2,2,2,1,1,2]),s=base(d,people),newcomer=people[0];s.days[date]=makeDay([g('a',people.slice(1,4)),g('b',people.slice(4))]);
 d.addMember(s,date,newcomer,'any',rng(),p);assert.ok(s.days[date].groups[0].members.some(x=>x.id===newcomer.id));
});

test('cohort balance precedes menu preference when history and gender are equal',async()=>{
 const d=await ready,people=Array.from({length:7},(_,i)=>person(`p${i}`,i<4?'4반':'5반')),p=policy(people,[1,1,2,2,1,2,2]),s=base(d,people),newcomer=people[0];s.days[date]=makeDay([g('same',people.slice(1,4)),g('mixed',people.slice(4),'outside')]);
 d.addMember(s,date,newcomer,'prefer_lunchbox',rng(),p);assert.ok(s.days[date].groups[1].members.some(x=>x.id===newcomer.id));
 const strict=base(d,people);strict.days[date]=makeDay([g('same',people.slice(1,4)),g('mixed',people.slice(4),'outside')]);d.addMember(strict,date,newcomer,'lunchbox',rng(),p);assert.ok(strict.days[date].groups[0].members.some(x=>x.id===newcomer.id));
});

test('a recent encounter beats gender and cohort improvements for late arrivals',async()=>{
 const d=await ready,people=Array.from({length:7},(_,i)=>person(`p${i}`,i<4?'4반':'5반')),p=policy(people,[1,1,1,2,2,2,2]),s=base(d,people),newcomer=people[0];s.days[date]=makeDay([g('fresh',people.slice(1,4)),g('recent',people.slice(4))]);
 s.days['2026-10-22']=makeDay([g('past',[newcomer,people[4]])],'final');d.addMember(s,date,newcomer,'any',rng(),p);assert.ok(s.days[date].groups[0].members.some(x=>x.id===newcomer.id));
});

test('cumulative encounter count precedes gender when last encounter dates are tied',async()=>{
 const d=await ready,people=Array.from({length:7},(_,i)=>person(`p${i}`,'4반')),p=policy(people,[1,2,2,2,1,1,2]),s=base(d,people),newcomer=people[0];s.days[date]=makeDay([g('twice',people.slice(1,4)),g('once',people.slice(4))]);
 s.days['2026-10-21']=makeDay([g('earlier',[newcomer,people[1]])],'final');s.days['2026-10-22']=makeDay([g('latest',[newcomer,people[1],people[4]])],'final');
 d.addMember(s,date,newcomer,'any',rng(),p);assert.ok(s.days[date].groups[1].members.some(x=>x.id===newcomer.id));
});
