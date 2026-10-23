const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const ready=Promise.all([import('../lib/domain.ts'),import('../lib/roster.ts'),import('../lib/demo.ts')]);
let ROSTER,rosterMember,emptyState,applyDefaults,setChoice,syncDue,initialMatch,makeDemo,demoDates,hires;
require('node:test').before(async()=>{const [domain,roster,demo]=await ready;({emptyState,applyDefaults,setChoice,syncDue,initialMatch}=domain);({ROSTER,rosterMember}=roster);({makeDemo,demoDates}=demo);hires=ROSTER.filter(p=>p.defaultStatus==='absent');});
const now=new Date('2026-10-22T09:30:00+09:00');

test('fixed roster contains the specified 20 people and affiliations',()=>{
 assert.equal(ROSTER.length,20);assert.equal(new Set(ROSTER.map(p=>p.name)).size,20);
 assert.equal(ROSTER.filter(p=>p.className==='4반').length,8);assert.equal(ROSTER.filter(p=>p.className==='5반').length,9);
 assert.deepEqual(hires.map(p=>p.name),['김범준','박대원','박진영']);
 assert.equal(rosterMember('김민수'),undefined);assert.equal(rosterMember('홍길동'),undefined);
 assert.equal(rosterMember('  권도영 ').className,'4반');
});
test('all December hires default to absent on every operating date',()=>{
 const state=emptyState();applyDefaults(state,demoDates,ROSTER);
 for(const date of demoDates)for(const p of hires)assert.equal(state.choices[date][p.id].status,'absent');
 for(const p of ROSTER.slice(0,17))assert.equal(state.choices[demoDates[0]][p.id].status,'unset');
});
test('defaults preserve explicit attendance and cancellation restores default absence',()=>{
 for(const person of hires){const state=emptyState();applyDefaults(state,demoDates,ROSTER);
 setChoice(state,'2026-10-22',person,{status:'join',meal:'outside'},now);
 applyDefaults(state,demoDates,ROSTER);assert.equal(state.choices['2026-10-22'][person.id].status,'join');
 syncDue(state,['2026-10-22'],ROSTER,now);assert.ok(state.days['2026-10-22'].groups.some(g=>g.members.some(p=>p.id===person.id)));
 setChoice(state,'2026-10-22',person,{status:'unset',meal:'any'},now);
 assert.equal(state.choices['2026-10-22'][person.id].status,'absent');assert.ok(!state.days['2026-10-22'].groups.some(g=>g.members.some(p=>p.id===person.id)));
 }
});
test('default absent hires are excluded from matching until they opt in',()=>{
 const state=emptyState();applyDefaults(state,demoDates,ROSTER);
 for(const p of ROSTER.slice(0,17))setChoice(state,'2026-10-22',p,{status:'join',meal:'any'},now);
 const groups=initialMatch(state,'2026-10-22',ROSTER);
 assert.equal(groups.flatMap(g=>g.members).length,17);assert.ok(groups.every(g=>g.members.length>=3&&g.members.length<=5));
 assert.ok(!groups.flatMap(g=>g.members).some(p=>hires.some(h=>h.id===p.id)));
});
test('late opt-in and cancellation preserve every other assignment; cutoff applies',()=>{
 const state=makeDemo();const before=Object.fromEntries(state.days['2026-10-22'].groups.flatMap(g=>g.members.map(p=>[p.id,g.id])));
 const hire=hires[0];setChoice(state,'2026-10-22',hire,{status:'join',meal:'any'},now);
 for(const g of state.days['2026-10-22'].groups)for(const p of g.members)if(p.id!==hire.id)assert.equal(g.id,before[p.id]);
 setChoice(state,'2026-10-22',hire,{status:'absent',meal:'any'},now);
 assert.throws(()=>setChoice(state,'2026-10-22',hire,{status:'join',meal:'any'},new Date('2026-10-22T11:00:00+09:00')),/11시/);
});
test('SQL seed and migration contain exactly the same canonical roster',()=>{
 const expected=ROSTER.map(p=>[p.id,p.name,p.className,p.defaultStatus]);
 for(const file of ['supabase/schema.sql','supabase/migrations/20261021090100_fixed_roster.sql']){
 const sql=fs.readFileSync(path.join(root,file),'utf8').split('-- SAME SUPABASE PROJECT. Global-only installer;')[0];const rows=[...sql.matchAll(/\('([0-9a-f-]+)'::uuid,'([^']+)','([^']+)','(absent|unset)'\)/g)].map(m=>m.slice(1));
 assert.deepEqual([...new Map(rows.map(r=>[r[1],r])).values()],expected);assert.ok(sql.includes('lunch_roster_allowed'));assert.ok(sql.includes('lunch_check_identity'));
 }
});
test('operation period includes all weekdays through November',()=>{
 assert.equal(demoDates[0],'2026-10-22');assert.equal(demoDates.at(-1),'2026-11-30');assert.equal(demoDates.length,28);assert.ok(demoDates.every(d=>![0,6].includes(new Date(d+'T12:00:00Z').getUTCDay())));
});
test('first match and finalization run only when due, preserve assignments on retries',()=>{
 const state=emptyState();applyDefaults(state,demoDates,ROSTER);
 for(const p of ROSTER.slice(0,17))setChoice(state,demoDates[0],p,{status:'join',meal:'any'},new Date('2026-10-21T20:00:00+09:00'));
 syncDue(state,demoDates,ROSTER,new Date('2026-10-21T21:59:59+09:00'));assert.equal(Object.keys(state.days).length,0);
 syncDue(state,demoDates,ROSTER,new Date('2026-10-21T22:00:00+09:00'));assert.deepEqual(Object.keys(state.days),['2026-10-22']);assert.equal(state.days[demoDates[0]].phase,'matched');
 const groups=JSON.stringify(state.days[demoDates[0]].groups);
 syncDue(state,demoDates,ROSTER,new Date('2026-10-22T10:59:59+09:00'));assert.equal(state.days[demoDates[0]].phase,'matched');
 syncDue(state,demoDates,ROSTER,new Date('2026-10-22T11:00:00+09:00'));assert.equal(state.days[demoDates[0]].phase,'final');assert.equal(JSON.stringify(state.days[demoDates[0]].groups),groups);
 const firstFinal=JSON.stringify(state.days[demoDates[0]]);
 syncDue(state,demoDates,ROSTER,new Date('2026-10-22T11:30:00+09:00'));assert.equal(JSON.stringify(state.days[demoDates[0]]),firstFinal);
 assert.throws(()=>setChoice(state,demoDates[0],ROSTER[0],{status:'absent',meal:'any'},new Date('2026-10-22T11:01:00+09:00')),/11시/);
});
test('demo has no premature future groups or finalized history on its first morning',()=>{
 const state=makeDemo();assert.deepEqual(Object.keys(state.days),['2026-10-22']);assert.equal(state.days['2026-10-22'].phase,'matched');
});
