const {test}=require('node:test');const assert=require('node:assert/strict');
const ready=Promise.all([import('../lib/domain.ts'),import('../lib/roster.ts')]);
test('all roster members are accounted for and unassigned choices retain all attendance and meal conditions',async()=>{
 const [d,{ROSTER}]=await ready;const state=d.emptyState(),date='2026-10-22';d.applyDefaults(state,[date],ROSTER);
 state.choices[date][ROSTER[0].id]={status:'join',meal:'lunchbox'};state.choices[date][ROSTER[1].id]={status:'join',meal:'prefer_outside'};
 state.choices[date][ROSTER[2].id]={status:'absent',meal:'prefer_lunchbox'};
 state.days[date]={phase:'matched',matchedAt:'2026-10-21T22:00:00+09:00',groups:[{id:'a',meal:'lunchbox',members:[ROSTER[0]]}]};
 const before=structuredClone(state),result=d.assignmentOverview(state,date,ROSTER);assert.equal(result.assignedCount,1);assert.equal(result.unassigned.length,19);assert.equal(result.unassignedJoined,1);
 assert.ok(!result.unassigned.some(r=>r.person.id===ROSTER[0].id));assert.deepEqual(result.unassigned.find(r=>r.person.id===ROSTER[1].id).choice,{status:'join',meal:'prefer_outside'});
 assert.deepEqual(result.unassigned.find(r=>r.person.id===ROSTER[2].id).choice,{status:'absent',meal:'prefer_lunchbox'});assert.equal(result.unassigned.at(-1).choice.status,'absent');assert.deepEqual(state,before);
});
test('overview uses the full set of groups and treats not-yet-matched attendees as unassigned',async()=>{
 const [d,{ROSTER}]=await ready;const state=d.emptyState(),date='2026-10-22',people=ROSTER.slice(0,2);
 for(const p of people)d.setChoice(state,date,p,{status:'join',meal:'any'},new Date('2026-10-21T12:00:00+09:00'));
 assert.equal(d.assignmentOverview(state,date,people).unassignedJoined,2);d.syncDue(state,[date],people,new Date('2026-10-21T22:00:00+09:00'));
 const result=d.assignmentOverview(state,date,people);assert.equal(result.assignedCount,2);assert.deepEqual(result.unassigned,[]);
});
test('missing saved choices use roster defaults rather than assuming every person attends',async()=>{
 const [d,{ROSTER}]=await ready;const result=d.assignmentOverview(d.emptyState(),'2026-10-22',ROSTER);assert.equal(result.unassigned.length,20);assert.equal(result.unassignedJoined,0);
 assert.deepEqual(result.unassigned[0].choice,{status:'unset',meal:'any'});assert.deepEqual(result.unassigned.at(-1).choice,{status:'absent',meal:'any'});
});


test('unfinalized missing attendees are restored without moving anyone, and final history stays immutable',async()=>{
 const [d,{ROSTER}]=await ready;const date='2026-10-22',state=d.emptyState(),people=ROSTER.slice(0,4);
 state.choices[date]=Object.fromEntries(people.map((p,i)=>[p.id,{status:'join',meal:i===3?'outside':'lunchbox'}]));
 state.days[date]={phase:'matched',matchedAt:'2026-10-21T22:00:00+09:00',groups:[{id:'kept',meal:'lunchbox',members:people.slice(0,2)}]};
 d.syncDue(state,[date],people,new Date('2026-10-22T10:00:00+09:00'));
 assert.equal(d.assignmentOverview(state,date,people).unassignedJoined,0);assert.equal(state.days[date].groups[0].id,'kept');assert.deepEqual(state.days[date].groups[0].members.slice(0,2),people.slice(0,2));
 assert.ok(state.days[date].groups.find(g=>g.members.some(p=>p.id===people[3].id)).meal==='outside');
 const stable=structuredClone(state);d.syncDue(state,[date],people,new Date('2026-10-22T10:30:00+09:00'));assert.deepEqual(state,stable);
 state.days[date].phase='final';state.days[date].groups=state.days[date].groups.filter(g=>g.meal==='lunchbox');const final=structuredClone(state.days[date]);d.syncDue(state,[date],people,new Date('2026-10-22T12:00:00+09:00'));assert.deepEqual(state.days[date],final);
});
test('repeating the same attendance choice restores an absent assignment before cutoff',async()=>{
 const [d,{ROSTER}]=await ready;const date='2026-10-22',state=d.emptyState(),person=ROSTER[0],choice={status:'join',meal:'outside'};
 state.choices[date]={[person.id]:choice};state.days[date]={phase:'matched',matchedAt:'2026-10-21T22:00:00+09:00',groups:[]};d.setChoice(state,date,person,choice,new Date('2026-10-22T10:00:00+09:00'));
 assert.equal(d.assignmentOverview(state,date,[person]).assignedCount,1);assert.equal(state.days[date].groups[0].meal,'outside');
});


test('attendance labels separate absence, no choice, default absence and ambiguous legacy records',async()=>{
 const [d,{ROSTER}]=await ready;const regular=ROSTER[0],hire=ROSTER.at(-1);
 assert.equal(d.attendanceLabel(regular,{status:'unset',meal:'any'}),'미선택');assert.equal(d.attendanceLabel(regular,{status:'absent',meal:'any'}),'불참 선택');
 assert.equal(d.attendanceLabel(hire,{status:'absent',meal:'any'},'default'),'기본 불참');assert.equal(d.attendanceLabel(hire,{status:'absent',meal:'any'},'selected'),'불참 선택');assert.equal(d.attendanceLabel(hire,{status:'absent',meal:'any'}),'불참 · 선택 여부 미확인');
});
test('new attendance writes record their source, cancellations restore the default and client data cannot choose the source',async()=>{
 const [d,{ROSTER}]=await ready;const hire=ROSTER.at(-1),date='2026-10-23',state=d.emptyState(),now=new Date('2026-10-22T10:00:00+09:00');
 d.applyDefaults(state,[date],[hire]);assert.equal(state.choiceOrigins[date][hire.id],'default');
 d.setChoice(state,date,hire,{status:'absent',meal:'any'},now);assert.equal(state.choiceOrigins[date][hire.id],'selected');
 d.setChoice(state,date,hire,{status:'join',meal:'outside'},now);assert.equal(state.choiceOrigins[date][hire.id],'selected');
 d.setChoice(state,date,hire,{status:'unset',meal:'any'},now);assert.equal(state.choiceOrigins[date][hire.id],'default');assert.equal(state.choices[date][hire.id].status,'absent');
});
