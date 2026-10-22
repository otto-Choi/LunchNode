const {test}=require('node:test');const assert=require('node:assert/strict');
const ready=import('../lib/domain.ts');
test('result date uses Korea time and stays on today through lunchtime until 13:00',async()=>{
 const {defaultResultsDate}=await ready,dates=['2026-10-22','2026-10-23','2026-10-26','2026-10-27'];
 for(const time of ['2026-10-22T09:00:00+09:00','2026-10-22T11:00:00+09:00','2026-10-22T12:59:59.999+09:00'])assert.equal(defaultResultsDate(dates,new Date(time)),'2026-10-22');
 for(const time of ['2026-10-22T13:00:00+09:00','2026-10-22T14:00:00+09:00','2026-10-22T22:00:00+09:00','2026-10-22T04:00:00Z'])assert.equal(defaultResultsDate(dates,new Date(time)),'2026-10-23');
 assert.equal(defaultResultsDate(dates,new Date('2026-10-23T13:00:00+09:00')),'2026-10-26');assert.equal(defaultResultsDate(dates,new Date('2026-10-24T10:00:00+09:00')),'2026-10-26');
});
test('date defaults handle an empty or finished period without changing the configured dates',async()=>{
 const {defaultResultsDate}=await ready,dates=['2026-10-22','2026-10-23'],before=[...dates];assert.equal(defaultResultsDate([],new Date('2026-10-22T13:00:00+09:00')),'');assert.equal(defaultResultsDate(dates,new Date('2026-10-23T13:00:00+09:00')),'2026-10-23');assert.deepEqual(dates,before);
});
test('December hires are last in the ungrouped list with stable ordering and no roster mutation',async()=>{
 const {assignmentOverview,emptyState}=await ready;const people=[{id:'h1',name:'김범준',className:'12월 입사자'},{id:'n1',name:'권도영',className:'4반'},{id:'h2',name:'박대원',className:'12월 입사자'},{id:'n2',name:'박서연',className:'5반'}],before=structuredClone(people);
 assert.deepEqual(assignmentOverview(emptyState(),'2026-10-22',people).unassigned.map(x=>x.person.id),['n1','n2','h1','h2']);assert.deepEqual(people,before);
});
