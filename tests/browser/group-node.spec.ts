import {test,expect,type Page} from '@playwright/test';
import {navigateMenu} from './navigation';
async function login(page:Page,tenant:'ax'|'global',name:string){
 await page.goto('/');if(tenant==='global')await page.getByLabel('본부',{exact:true}).selectOption('global');
 await page.getByLabel('초대 코드').fill(tenant==='ax'?'ci-invitation':'ci-global-invitation');await page.getByRole('button',{name:'초대 코드 확인',exact:true}).click();
 await page.getByLabel('이름',{exact:true}).selectOption(name);await page.getByLabel('숫자 6자리 PIN').fill('123456');await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page.getByRole('heading',{name:'내 점심 일정',exact:true})).toBeVisible();
}
test('both headquarters share Group Node creation, participation, votes and comments while lunch remains available',async({page,browser},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await login(page,'ax',info.project.name==='mobile'?'김서영':'권도영');
 await page.getByRole('button',{name:'Group Node',exact:true}).click();await expect(page.getByRole('heading',{name:'모임 둘러보기',exact:true})).toBeVisible();await expect(page).toHaveTitle('Group Node · 동기 소모임');
 await page.getByRole('button',{name:'+ 모임 만들기',exact:true}).click();
 const title=`교류 QA ${info.project.name}`;await page.getByLabel('모임 이름',{exact:true}).fill(title);await page.getByLabel('카테고리',{exact:true}).selectOption('food');await page.getByLabel('모임 설명',{exact:true}).fill('두 본부가 함께하는 모임');
 const date=new Date();date.setUTCDate(date.getUTCDate()+3);const next=new Date(date);next.setUTCDate(date.getUTCDate()+1);
 await page.getByLabel('후보 날짜 1',{exact:true}).fill(date.toISOString().slice(0,10));await page.getByLabel('후보 시간 1',{exact:true}).fill('12:00');
 await page.getByRole('button',{name:'+ 날짜 추가',exact:true}).click();await page.getByLabel('후보 날짜 2',{exact:true}).fill(next.toISOString().slice(0,10));
 const created=page.waitForResponse(r=>r.url().endsWith('/api/group-node')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='create');await page.getByRole('button',{name:'모임 만들기',exact:true}).click();const response=await created;expect(response.ok()).toBe(true);const meetup=await response.json();
 await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'참여 취소',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'이 날짜로 확정',exact:true}).first()).toBeDisabled();
 const context=await browser.newContext({viewport:page.viewportSize()||undefined});const global=await context.newPage();
 try{
  await login(global,'global',info.project.name==='mobile'?'박인홍':'류지환');await global.getByRole('button',{name:'Group Node',exact:true}).click();
  await global.getByRole('button').filter({has:global.getByRole('heading',{name:title,exact:true})}).click();
  await global.getByRole('button',{name:'참여하기',exact:true}).click();await expect(global.getByRole('button',{name:'참여 취소',exact:true})).toBeVisible();
  await global.getByRole('button',{name:/투표$/}).first().click();await expect(global.getByRole('button',{name:/투표$/}).first()).toHaveAttribute('aria-pressed','true');
  await global.getByLabel('댓글 입력',{exact:true}).fill('Global 참여합니다 <script>문자 그대로</script>');await global.getByRole('button',{name:'댓글 등록',exact:true}).click();await expect(global.getByRole('region',{name:'모임 댓글'})).toContainText('<script>문자 그대로</script>');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('button',{name:'이 날짜로 확정',exact:true}).first()).toBeEnabled();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'이 날짜로 확정',exact:true}).first().click();await expect(page.locator('.gn-badge.confirmed')).toHaveText('날짜 확정');
  await expect(page.getByRole('region',{name:'모임 댓글'})).toContainText('Global 참여합니다');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await navigateMenu(page,'내 모임');await expect(page.getByRole('heading',{name:'내 모임',exact:true})).toBeVisible();await page.getByRole('button').filter({has:page.getByRole('heading',{name:title,exact:true})}).click();await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Lunch Node',exact:true}).click();await expect(page.getByRole('heading',{name:'내 점심 일정',exact:true})).toBeVisible();await page.getByRole('button',{name:'Group Node',exact:true}).click();await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  if(info.project.name==='mobile'){
   await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();await expect(page.getByRole('dialog',{name:'Group Node 메뉴'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Group Node 메뉴'})).toHaveCount(0);await expect(page.getByRole('button',{name:'메뉴 열기',exact:true})).toBeFocused();
  }
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'모임 삭제',exact:true}).click();await expect(page.getByRole('heading',{name:'내 모임',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('group-node.png'),fullPage:true});
 }finally{await context.close();}
});
