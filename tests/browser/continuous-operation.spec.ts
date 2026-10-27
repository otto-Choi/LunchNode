import {test,expect} from '@playwright/test';
test('continuous calendar crosses December into next year and mobile omits past date cards',async({page},info)=>{
 const dates=['2026-12-30','2026-12-31','2027-01-01','2027-01-04','2027-01-05','2027-01-06','2027-01-07','2027-01-08'];
 const person={id:'p',name:'김수연',className:'TMT Tech'};
 await page.route('**/api/state',route=>route.fulfill({json:{demo:false,user:person,people:[person],dates,now:'2026-12-31T10:00:00+09:00',state:{choices:{},days:{},events:[]}}}));
 await page.goto('/');await expect(page.getByRole('heading',{name:'내 점심 일정',exact:true})).toBeVisible();
 if(info.project.name==='desktop'){
  await expect(page.locator('.month-navigation strong')).toHaveText('2026년 12월');
  await page.getByRole('button',{name:'다음 달',exact:true}).click();
  await expect(page.locator('.month-navigation strong')).toHaveText('2027년 1월');
  await page.getByRole('button',{name:'1월 4일 선택',exact:true}).click();
 }else{
  await expect(page.getByRole('button',{name:'12월 30일 선택',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'1월 4일 선택',exact:true}).click();
 }
 await expect(page.getByRole('button',{name:'1월 4일 선택',exact:true})).toHaveAttribute('aria-pressed','true');
});
