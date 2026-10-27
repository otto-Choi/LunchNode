import {test,expect} from '@playwright/test';
test('TMT invitation opens only its canonical 18-person roster and registers a team member',async({page},info)=>{
 const name=info.project.name==='mobile'?'김현준':'김수연';
 await page.goto('/');await page.getByLabel('본부',{exact:true}).selectOption('tmt');
 await page.getByLabel('초대 코드',{exact:true}).fill('TMT36');
 await page.getByRole('button',{name:'초대 코드 확인',exact:true}).click();
 await page.getByRole('button',{name:'처음이라면 최초 등록'}).click();
 const select=page.getByLabel('이름',{exact:true});await expect(select).toBeVisible();
 await expect(select.locator('option')).toHaveCount(19);
 await select.selectOption(name);
 await page.getByLabel('숫자 6자리 PIN').fill('123456');
 await page.getByRole('button',{name:'등록',exact:true}).click();
 await expect(page.getByText(name,{exact:true}).first()).toBeVisible();
});
