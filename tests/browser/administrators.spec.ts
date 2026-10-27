import {test,expect,type Page} from '@playwright/test';
async function login(page:Page,tenant:'ax'|'global'|'tmt'){
 await page.goto('/');if(tenant!=='ax')await page.getByLabel('본부',{exact:true}).selectOption(tenant);
 await page.getByLabel('초대 코드').fill(tenant==='ax'?'ci-invitation':tenant==='global'?'ci-global-invitation':'TMT36');await page.getByRole('button',{name:'초대 코드 확인',exact:true}).click();
 await expect(page.getByLabel('이름',{exact:true}).locator('option').last()).toHaveText('관리자');await page.getByLabel('이름',{exact:true}).selectOption('관리자');
 await page.getByLabel('숫자 6자리 PIN').fill('246810');await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page.getByRole('heading',{name:'운영 관리',exact:true})).toBeVisible();
}
test('all HQ administrator accounts use operator tools and manage another HQ private meetup and comments',async({page,browser},info)=>{
 test.setTimeout(90000);await login(page,'ax');await expect(page.getByRole('button',{name:/일 참석$/})).toHaveCount(0);
 await page.getByRole('button',{name:'운영자 도구 열기',exact:true}).click();await expect(page.getByLabel('운영자 키',{exact:true})).toHaveCount(0);await expect(page.getByLabel('작업',{exact:true})).toBeVisible();await page.getByLabel('작업',{exact:true}).selectOption('recover');
 const recovered=page.waitForResponse(r=>r.url().endsWith('/api/admin')&&r.request().postDataJSON()?.action==='recover');await page.getByRole('button',{name:'실행',exact:true}).click();expect((await recovered).status()).toBe(200);await page.getByRole('button',{name:'닫기',exact:true}).click();
 const context=await browser.newContext({viewport:page.viewportSize()||undefined});const global=await context.newPage();
 try{
  await login(global,'global');await global.getByRole('button',{name:'Group Node',exact:true}).click();await global.getByRole('button',{name:'+ 모임 만들기',exact:true}).click();await global.getByLabel('모임 유형',{exact:true}).selectOption('club');
  const title='관리 QA '+info.project.name;await global.getByLabel('모임 이름',{exact:true}).fill(title);await global.getByLabel('모집 범위',{exact:true}).selectOption('headquarters');await global.getByLabel('소모임 소개·모집글',{exact:true}).fill('원래 안내');await global.getByRole('button',{name:'소모임 만들기',exact:true}).click();await expect(global.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await global.getByLabel('댓글 입력',{exact:true}).fill('운영 확인');await global.getByRole('button',{name:'댓글 등록',exact:true}).click();await expect(global.locator('.gn-comments')).toContainText('운영 확인');
  await page.getByRole('button',{name:'Group Node',exact:true}).click();await page.getByRole('button').filter({has:page.getByRole('heading',{name:title,exact:true})}).click();
  await page.getByRole('button',{name:'모임 수정',exact:true}).click();await page.getByLabel('소모임 소개·모집글',{exact:true}).fill('통합 관리자가 수정한 안내');await page.getByRole('button',{name:'수정 저장',exact:true}).click();await expect(page.locator('.gn-detail')).toContainText('통합 관리자가 수정한 안내');
  page.once('dialog',d=>d.accept('수정된 댓글'));await page.getByRole('button',{name:'댓글 수정',exact:true}).click();await expect(page.locator('.gn-comments')).toContainText('수정된 댓글');await page.getByRole('button',{name:'댓글 삭제',exact:true}).click();await expect(page.locator('.gn-comments')).not.toContainText('수정된 댓글');
  await page.screenshot({path:info.outputPath('administrator-moderation.png'),fullPage:true});page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'모임 삭제',exact:true}).click();
  const tmt=await context.newPage();await login(tmt,'tmt');await tmt.getByRole('button',{name:'운영자 도구 열기',exact:true}).click();await expect(tmt.getByLabel('운영자 키',{exact:true})).toHaveCount(0);await expect(tmt.getByLabel('작업',{exact:true})).toBeVisible();
 }finally{await context.close();}
});
