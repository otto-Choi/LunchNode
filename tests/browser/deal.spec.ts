import {test,expect} from '@playwright/test';

test('DEAL is listed as pending and rejects direct requests even with its planned invite',async({page})=>{
 await page.goto('/');
 const headquarters=page.getByLabel('본부',{exact:true});
 await expect(headquarters.locator('option[value="deal"]')).toHaveText('DEAL · 준비 중');
 await expect(headquarters.locator('option[value="deal"]')).toHaveJSProperty('disabled',true);
 for(const id of ['ax','global','tmt'])await expect(headquarters.locator(`option[value="${id}"]`)).toHaveJSProperty('disabled',false);
 const response=await page.request.post('/api/auth',{headers:{'x-lunch-tenant':'deal',origin:new URL(page.url()).origin},data:{action:'unlock',invite:'DEAL36'}});
 expect(response.status()).toBe(503);expect((await response.json()).code).toBe('NOT_READY');
});
