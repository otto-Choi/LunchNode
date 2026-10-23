const {test}=require('node:test');
const assert=require('node:assert/strict');
const ready=import('../lib/client/calendar.ts');
test('monthly calendar runs Sunday through Saturday and spans complete weeks',async()=>{
 const {monthCells,CALENDAR_WEEKDAYS}=await ready;
 assert.deepEqual(CALENDAR_WEEKDAYS,['일','월','화','수','목','금','토']);
 for(const month of ['2026-10','2026-11','2027-02','2028-02','2026-12']){
  const cells=monthCells(month);assert.equal(cells.length%7,0);
  assert.equal(new Date(cells[0]+'T12:00:00Z').getUTCDay(),0);
  assert.equal(new Date(cells.at(-1)+'T12:00:00Z').getUTCDay(),6);
  for(let i=1;i<cells.length;i++)assert.equal(new Date(cells[i]+'T12:00:00Z')-new Date(cells[i-1]+'T12:00:00Z'),86400000);
 }
 assert.equal(monthCells('2026-10')[0],'2026-09-27');assert.equal(monthCells('2026-10').at(-1),'2026-10-31');
 assert.equal(monthCells('2026-11')[0],'2026-11-01');assert.deepEqual(monthCells(''),[]);
});
test('month navigation crosses years and weekend classification follows calendar dates',async()=>{
 const {shiftMonth,isCalendarWeekend}=await ready;
 assert.equal(shiftMonth('2026-12',1),'2027-01');assert.equal(shiftMonth('2027-01',-1),'2026-12');
 assert.equal(isCalendarWeekend('2026-10-24'),true);assert.equal(isCalendarWeekend('2026-10-25'),true);assert.equal(isCalendarWeekend('2026-10-26'),false);
});
