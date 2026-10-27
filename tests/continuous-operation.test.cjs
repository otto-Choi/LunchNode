const {test}=require('node:test');const assert=require('node:assert/strict');
test('repeated synchronization never mutates finalized historical choices or groups',async()=>{
 const {syncDue}=await import('../lib/domain.ts');
 const people=[{id:'a',name:'A',className:'TMT Tech'},{id:'b',name:'B',className:'TMT ICT'}];
 const final={groups:[{id:'old',meal:'outside',members:[people[0]]}],phase:'final',matchedAt:'2026-10-20T22:00:00+09:00',finalizedAt:'2026-10-21T11:00:00+09:00'};
 const state={choices:{'2026-10-21':{a:{status:'join',meal:'outside'}}},days:{'2026-10-21':final},events:[]};
 const historical=structuredClone(state);syncDue(state,['2026-10-21','2027-01-04'],people,new Date('2027-01-03T10:00:00+09:00'));
 assert.deepEqual(state.days['2026-10-21'],historical.days['2026-10-21']);assert.deepEqual(state.choices['2026-10-21'],historical.choices['2026-10-21']);
 assert.equal(state.choices['2027-01-04'].b.status,'unset');assert.equal(state.choices['2027-01-04'].b.meal,'any');
});
