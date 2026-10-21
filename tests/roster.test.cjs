const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'..');
const source=['lib/operation.ts','lib/domain.ts','lib/roster.ts','lib/demo.ts'].map(p=>stripTypeScriptTypes(fs.readFileSync(path.join(root,p),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,'')).join('\n');
const core=new Function('crypto',source+'\nreturn {ROSTER,rosterMember,emptyState,applyDefaults,defaultChoice,setChoice,syncDue,initialMatch,makeDemo,demoDates};')(webcrypto);
const {ROSTER,rosterMember,emptyState,applyDefaults,setChoice,syncDue,initialMatch,makeDemo,demoDates}=core;
const hires=ROSTER.filter(p=>p.defaultStatus==='absent');
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
 for(const file of ['supabase/schema.sql','supabase/migrations/20261021_fixed_roster.sql']){
 const sql=fs.readFileSync(path.join(root,file),'utf8');const rows=[...sql.matchAll(/\('([0-9a-f-]+)'::uuid,'([^']+)','([^']+)','(absent|unset)'\)/g)].map(m=>m.slice(1));
 assert.deepEqual(rows,expected);assert.ok(sql.includes('lunch_roster_allowed'));assert.ok(sql.includes('lunch_check_identity'));
 }
});
test('preview renders the real roster, all three defaults, saves participation and shows no slogans',()=>{
 const html=fs.readFileSync(path.join(root,'ui-preview-v6.html'),'utf8');const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const output={innerHTML:''};const context={document:{getElementById:()=>output,querySelector:()=>null,createElement:()=>({setAttribute(){},remove(){}}),body:{append(){}}},localStorage:{getItem:()=>null,setItem(){}},window:{scrollTo(){}},setTimeout(){},alert(){},crypto:webcrypto};vm.createContext(context);vm.runInContext(script,context);
 assert.equal((output.innerHTML.match(/<option /g)||[]).length,20);
 for(const hire of hires){vm.runInContext(`changeUser('${hire.id}')`,context);assert.ok(output.innerHTML.includes('12월 입사자는 기본 불참입니다.'));
 assert.equal(vm.runInContext('demoDates.every(d=>state.choices[d][active].status===\'absent\')',context),true);
 vm.runInContext("choose('2026-10-23');meal='outside';update('join')",context);assert.equal(vm.runInContext("state.choices[selected][active].status",context),'join');
 vm.runInContext("update('unset')",context);assert.equal(vm.runInContext("state.choices[selected][active].status",context),'absent');}
 for(const tab of ['groups','history','schedule']){vm.runInContext(`nav('${tab}')`,context);assert.ok(output.innerHTML.length>1000);}
 assert.ok(html.includes('<div id="root"><div class="app-shell">'));
 assert.ok(!output.innerHTML.includes('LUNCH TOGETHER'));assert.ok(!output.innerHTML.includes('함께 먹는 즐거움'));assert.ok(!output.innerHTML.includes('새로운 대화'));
});

test('operation period is exactly the nine requested weekdays',()=>{
 assert.deepEqual(demoDates,['2026-10-22','2026-10-23','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-11-02','2026-11-03']);
 const html=fs.readFileSync(path.join(root,'ui-preview-v6.html'),'utf8');
 const initial=html.split('<script>')[0];
 assert.ok(initial.includes('2026년 10–11월'));assert.ok(initial.includes('10.22 — 11.03'));
 assert.ok(initial.includes('grid-column-start:4'));assert.equal((initial.match(/class="date-cell /g)||[]).length,9);
 assert.ok(!initial.includes('2026년 11월'));
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
 const html=fs.readFileSync(path.join(root,'ui-preview-v6.html'),'utf8');const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const output={innerHTML:''};const context={document:{getElementById:()=>output},localStorage:{getItem:()=>null,setItem(){}},window:{scrollTo(){}},crypto:webcrypto};vm.createContext(context);vm.runInContext(script,context);vm.runInContext("nav('history')",context);assert.ok(output.innerHTML.includes('확정된 기록이 없습니다.'));
});

test('rendered attendance buttons save both new dates, persist on reload, and default the menu to any',()=>{
 const html=fs.readFileSync(path.join(root,'ui-preview-v6.html'),'utf8');const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const saved={};function setup(blockStorage=false){const output={innerHTML:''};const context={document:{getElementById:()=>output,querySelector:()=>null,createElement:()=>({setAttribute(){},remove(){},addEventListener(){}}),body:{append(){}}},localStorage:{getItem:k=>saved[k]||null,setItem(k,v){if(blockStorage)throw new Error('Storage blocked');saved[k]=v;}},window:{scrollTo(){}},setTimeout(){},alert(){},crypto:webcrypto};vm.createContext(context);vm.runInContext(script,context);return {context,output};}
 const {context,output}=setup();
 assert.equal(vm.runInContext('meal',context),'any');
 for(const date of ['2026-11-02','2026-11-03']){
 const attend=`quickChoice('${date}','join')`;const absent=`quickChoice('${date}','absent')`;
 assert.ok(output.innerHTML.includes(`onclick="${attend}"`));vm.runInContext(attend,context);
 assert.equal(vm.runInContext(`state.choices['${date}'][active].status`,context),'join');assert.equal(vm.runInContext(`state.choices['${date}'][active].meal`,context),'any');
 assert.ok(output.innerHTML.includes(`onclick="${absent}"`));vm.runInContext(absent,context);assert.equal(vm.runInContext(`state.choices['${date}'][active].status`,context),'absent');
 }
 vm.runInContext("choose('2026-11-03');attendance='join';meal='outside';update(attendance)",context);
 const reloaded=setup();assert.equal(vm.runInContext("state.choices['2026-11-03'][active].status",reloaded.context),'join');assert.equal(vm.runInContext("state.choices['2026-11-03'][active].meal",reloaded.context),'outside');
 const blocked=setup(true);vm.runInContext("quickChoice('2026-11-02','join')",blocked.context);assert.equal(vm.runInContext("state.choices['2026-11-02'][active].status",blocked.context),'join');assert.ok(blocked.output.innerHTML.includes('저장 차단됨'));
});
