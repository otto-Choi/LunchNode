import {test,expect} from '@playwright/test';
import {navigateMenu} from './navigation';

test('lunchbox-only members appear in one uncapped pool while regular groups start at one',async({page})=>{
 const people=Array.from({length:10},(_,i)=>({id:`p${i}`,name:`참석자${i+1}`,className:'테스트팀'}));const date='2026-10-29';
 const groups=[{id:'pool',kind:'lunchbox_pool',meal:'lunchbox',members:people.slice(0,6)},{id:'regular',meal:'outside',members:people.slice(6)}];
 await page.route('**/api/state',route=>route.fulfill({json:{demo:false,user:people[0],people,dates:[date],now:`${date}T10:00:00+09:00`,state:{choices:{[date]:Object.fromEntries(people.map((p,i)=>[p.id,{status:'join',meal:i<6?'lunchbox':'outside'}]))},days:{[date]:{phase:'matched',matchedAt:'2026-10-28T22:00:00+09:00',groups}},events:[]}}}));
 await page.goto('/');await expect(page.locator('.my-group-summary strong')).toHaveText('도시락');await expect(page.locator('.group-label')).toContainText('도시락');await expect(page.locator('.group-label')).not.toContainText('Infinity');await navigateMenu(page,'조 편성 결과');
 const pool=page.locator('.group-card').filter({hasText:'도시락만 신청'});await expect(pool.locator('h3')).toContainText('도시락');await expect(pool.locator('h3')).not.toContainText('조');await expect(pool.locator('.member-count')).toHaveText('6명');await expect(pool.locator('.waiting-label')).toHaveCount(0);
 const regular=page.locator('.group-card').filter({hasText:'참석자10'});await expect(regular.locator('h3')).toHaveText('1조');await expect(regular.locator('.member-count')).toHaveText('4 / 4명');
 await expect(page.getByRole('region',{name:'조 미포함 인원'})).toContainText('참석 미배정 0명');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
