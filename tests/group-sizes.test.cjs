const {test}=require('node:test');const assert=require('node:assert/strict');
const ready=Promise.all([import('../lib/domain.ts'),import('../lib/roster.ts')]);
const expected={1:[1],2:[2],3:[3],4:[4],5:[2,3],6:[3,3],7:[3,4],8:[4,4],9:[3,3,3],10:[3,3,4],11:[3,4,4],12:[4,4,4],13:[3,3,3,4],14:[3,3,4,4],15:[3,4,4,4],16:[4,4,4,4],17:[3,3,3,4,4],18:[3,3,4,4,4],19:[3,4,4,4,4],20:[4,4,4,4,4]};
const sizes=groups=>groups.map(g=>g.members.length).sort((a,b)=>a-b);
function rng(seed=37){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}

test('all roster sizes respect a hard four-person cap and assign everyone',async()=>{
 const [d,{ROSTER}]=await ready;for(let n=1;n<=20;n++){
  const people=ROSTER.slice(0,n),state=d.emptyState(),date='2026-10-22';state.choices[date]=Object.fromEntries(people.map(p=>[p.id,{status:'join',meal:'any'}]));
  const groups=d.initialMatch(state,date,people,rng(n));assert.deepEqual(sizes(groups),expected[n],`${n} participants`);assert.equal(groups.flatMap(g=>g.members).length,n);
 }
});

test('recent history and soft menus cannot cause avoidable five-person or three-person groups',async()=>{
 const [d,{ROSTER}]=await ready;const date='2026-10-22',state=d.emptyState();
 state.days['2026-10-21']={phase:'final',matchedAt:'2026-10-20T22:00:00+09:00',groups:Array.from({length:5},(_,i)=>({id:`old-${i}`,meal:'lunchbox',members:ROSTER.slice(i*4,i*4+4)}))};
 state.choices[date]=Object.fromEntries(ROSTER.map((p,i)=>[p.id,{status:'join',meal:i<10?'prefer_lunchbox':'prefer_outside'}]));
 assert.deepEqual(sizes(d.initialMatch(state,date,ROSTER,rng())),expected[20]);
});

test('strict menus split five attendees instead of exceeding four, while neutral people can fill groups',async()=>{
 const [d,{ROSTER}]=await ready;const date='2026-10-22',people=ROSTER.slice(0,8),state=d.emptyState();
 state.choices[date]=Object.fromEntries(people.map((p,i)=>[p.id,{status:'join',meal:i<5?'lunchbox':'outside'}]));
 let groups=d.initialMatch(state,date,people,rng());assert.deepEqual(sizes(groups),[2,3,3]);for(const g of groups)for(const p of g.members)assert.ok(d.allowsMeal(state.choices[date][p.id].meal,g.meal));
 state.choices[date][people[4].id].meal='any';groups=d.initialMatch(state,date,people,rng());assert.deepEqual(sizes(groups),[4,4]);for(const g of groups)for(const p of g.members)assert.ok(d.allowsMeal(state.choices[date][p.id].meal,g.meal));
});

test('late participation fills compatible vacancies and creates a new group when every compatible group has four',async()=>{
 const [d,{ROSTER}]=await ready;const date='2026-10-22',person=ROSTER[0],state=d.emptyState();
 const four={id:'four',meal:'lunchbox',members:ROSTER.slice(1,5)},three={id:'three',meal:'outside',members:ROSTER.slice(5,8)};
 state.days['2026-10-21']={phase:'final',matchedAt:'2026-10-20T22:00:00+09:00',groups:[{id:'old',meal:'outside',members:[person,...three.members]}]};
 state.days[date]={phase:'matched',matchedAt:'2026-10-21T22:00:00+09:00',groups:structuredClone([four,three])};
 d.addMember(state,date,person,'prefer_lunchbox',rng());assert.deepEqual(sizes(state.days[date].groups),[4,4]);assert.deepEqual(state.days[date].groups[0],four);
 state.days[date].groups=structuredClone([four,three]);d.addMember(state,date,person,'lunchbox',rng());assert.deepEqual(sizes(state.days[date].groups),[1,3,4]);assert.ok(state.days[date].groups.find(g=>g.members.some(p=>p.id===person.id)).meal==='lunchbox');
});

test('operator rematching applies the same four-person priority without changing existing final history',async()=>{
 const [d,{ROSTER}]=await ready;const date='2026-10-22',state=d.emptyState();state.choices[date]=Object.fromEntries(ROSTER.map(p=>[p.id,{status:'join',meal:'any'}]));
 state.days[date]={phase:'matched',matchedAt:'2026-10-21T22:00:00+09:00',groups:Array.from({length:4},(_,i)=>({id:`old-${i}`,meal:'lunchbox',members:ROSTER.slice(i*5,i*5+5)}))};
 state.days['2026-10-21']={...structuredClone(state.days[date]),phase:'final'};const before=structuredClone(state.days['2026-10-21']);
 d.rematchDay(state,date,ROSTER,new Date('2026-10-22T10:00:00+09:00'),rng());assert.deepEqual(sizes(state.days[date].groups),expected[20]);assert.deepEqual(state.days['2026-10-21'],before);
});
