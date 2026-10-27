import {test,expect} from '@playwright/test';
import {navigateMenu} from './navigation';
test('one-off conversion, persistent club creation, dedicated navigation and owner-added participants work',async({page},info)=>{
 test.setTimeout(60000);
 await page.goto('/');await page.getByLabel('초대 코드').fill('ci-invitation');await page.getByRole('button',{name:'초대 코드 확인',exact:true}).click();
 await page.getByLabel('이름',{exact:true}).selectOption(info.project.name==='mobile'?'김서영':'권도영');await page.getByLabel('숫자 6자리 PIN').fill('123456');await page.getByRole('button',{name:'로그인',exact:true}).click();
 await expect(page.getByRole('heading',{name:'내 점심 일정',exact:true})).toBeVisible();await page.getByRole('button',{name:'Group Node',exact:true}).click();
 const title='1회성 QA '+info.project.name;
 await page.getByRole('button',{name:'+ 모임 만들기',exact:true}).click();await page.getByLabel('모임 이름',{exact:true}).fill(title);
 const date=new Date();date.setUTCDate(date.getUTCDate()+4);await page.getByLabel('후보 날짜 1',{exact:true}).fill(date.toISOString().slice(0,10));
 await page.getByRole('button',{name:'모임 만들기',exact:true}).click();await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 await navigateMenu(page,'소모임');await expect(page.getByRole('heading',{name:'소모임',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:title,exact:true})).toHaveCount(0);
 await navigateMenu(page,'모임 둘러보기');await page.getByRole('button').filter({has:page.getByRole('heading',{name:title,exact:true})}).click();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'소모임으로 전환',exact:true}).click();await expect(page.locator('.gn-detail .gn-badge')).toHaveText('소모임');
 await expect(page.locator('.gn-detail .gn-note')).toContainText('Teams');
 await page.getByRole('button',{name:'참여자 추가',exact:true}).click();await page.getByLabel('추가할 참여자',{exact:true}).selectOption({label:'류지환 · IOA'});
 await page.getByRole('button',{name:'추가',exact:true}).click();await expect(page.locator('.gn-people')).toContainText('류지환');await expect(page.locator('.gn-people')).toContainText('Global');
 await navigateMenu(page,'소모임');await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'+ 모임 만들기',exact:true}).click();await page.getByLabel('모임 유형',{exact:true}).selectOption('club');
 await expect(page.locator('.gn-editor .gn-note')).toContainText('Teams');await expect(page.getByLabel('후보 날짜 1',{exact:true})).toHaveCount(0);
 const club='지속형 QA '+info.project.name;await page.getByLabel('모임 이름',{exact:true}).fill(club);await page.getByLabel('소모임 소개·모집글',{exact:true}).fill('매주 활동할 동기를 모집합니다.');
 await page.getByRole('button',{name:'소모임 만들기',exact:true}).click();await expect(page.getByRole('heading',{name:club,exact:true})).toBeVisible();await expect(page.locator('.gn-detail')).toContainText('매주 활동할 동기를 모집합니다.');
 await page.screenshot({path:info.outputPath('persistent-club.png'),fullPage:true});
 await navigateMenu(page,'지난 모임');await expect(page.getByRole('heading',{name:club,exact:true})).toHaveCount(0);
 await navigateMenu(page,'모임 둘러보기');await expect(page.getByRole('heading',{name:club,exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // Remove only the records created by this test in the disposable QA database.
 for(const name of [title,club]){
  await page.getByRole('button').filter({has:page.getByRole('heading',{name,exact:true})}).click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'모임 삭제',exact:true}).click();await expect(page.getByRole('heading',{name:'모임 둘러보기',exact:true})).toBeVisible();
 }
});
