import {test,expect} from '@playwright/test';
test('date cards are compact, desktop weeks start Sunday, and weekend columns are narrow and empty',async({page},info)=>{
 const person={id:'p1',name:'권도영',className:'4반'},dates=['2026-10-22','2026-10-23','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'];
 const choices=Object.fromEntries(dates.map(d=>[d,{p1:{status:'join',meal:'prefer_outside'}}]));
 await page.route('**/api/state',route=>route.fulfill({json:{demo:false,user:person,people:[person],dates,now:'2026-10-23T10:00:00+09:00',state:{choices,days:{},events:[]}}}));
 await page.goto('/');await expect(page.getByRole('heading',{name:'내 점심 일정',exact:true})).toBeVisible();
 const selected=page.locator('.date-cell.selected');const box=await selected.boundingBox();expect(box).not.toBeNull();expect(box!.height).toBeLessThanOrEqual(info.project.name==='mobile'?132:100);
 await expect(selected.locator('.date-meal')).toHaveText('외식선호');
 if(info.project.name==='desktop'){
  await expect(page.locator('.calendar-weekdays>span')).toHaveText(['일','월','화','수','목','금','토']);
  const weekends=page.locator('.date-cell.weekend');await expect(weekends).toHaveCount(10);
  expect(await weekends.evaluateAll(nodes=>nodes.every(n=>n.textContent===''&&!n.querySelector('button')))).toBe(true);
  const weekend=await weekends.first().boundingBox();expect(weekend!.width).toBeLessThanOrEqual(20);expect(box!.width).toBeGreaterThan(weekend!.width*3);
  const thursday=await page.getByRole('button',{name:'10월 22일 선택',exact:true}).boundingBox();const friday=await page.getByRole('button',{name:'10월 23일 선택',exact:true}).boundingBox();expect(thursday!.y).toBe(friday!.y);expect(thursday!.x).toBeLessThan(friday!.x);
 }else{
  await expect(page.locator('.date-cell.past-date')).toBeHidden();
  const quick=selected.getByRole('button',{name:'10월 23일 참석',exact:true});expect((await quick.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const font=await selected.locator('.date-meal').evaluate(node=>parseFloat(getComputedStyle(node).fontSize));expect(font).toBeGreaterThanOrEqual(14);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 // The entire compact card remains selectable away from its date text and quick actions.
 const next=page.getByRole('button',{name:'10월 26일 선택',exact:true});await next.click({position:{x:4,y:4}});await expect(next).toHaveAttribute('aria-pressed','true');
});
