import {test,expect} from '@playwright/test';
import {navigateMenu} from './navigation';

test('35 can register a free name with AX35 and can only use Group Node',async({page},info)=>{
 const name=info.project.name==='mobile'?'35 모바일테스트':'35 데스크톱테스트';
 await page.goto('/');await page.getByLabel('사번',{exact:true}).selectOption('35');
 await expect(page.getByLabel('본부',{exact:true})).toHaveValue('ax');await page.getByLabel('초대 코드',{exact:true}).fill('AX35');
 await page.getByRole('button',{name:'초대 코드 확인',exact:true}).click();await page.getByRole('button',{name:'처음이라면 최초 등록'}).click();
 await expect(page.getByLabel('이름',{exact:true})).toHaveJSProperty('tagName','INPUT');await page.getByLabel('이름',{exact:true}).fill(name);await page.getByLabel('숫자 6자리 PIN').fill('123456');
 await page.getByRole('button',{name:'등록',exact:true}).click();await expect(page.getByRole('heading',{name:'모임 둘러보기',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Lunch Node',exact:true})).toHaveCount(0);await expect(page.getByText('미응답',{exact:true})).toHaveCount(0);
 await navigateMenu(page,'내 모임');await expect(page.getByRole('heading',{name:'내 모임',exact:true})).toBeVisible();await expect(page.locator('.service-sidebar')).not.toContainText('내 점심 일정');
 const denied=await page.request.post('/api/state',{headers:{origin:new URL(page.url()).origin,'x-lunch-cohort':'35','x-lunch-tenant':'ax'},data:{dates:['2026-11-02'],choice:{status:'join',meal:'any'}}});expect(denied.status()).toBe(403);
 await page.reload();await expect(page.locator('header')).toContainText(name);await expect(page.getByRole('button',{name:'Lunch Node',exact:true})).toHaveCount(0);
 await navigateMenu(page,'모임 둘러보기');await page.getByRole('button',{name:'+ 모임 만들기',exact:true}).click();const scope=page.getByLabel('모집 범위');await expect(scope.locator('option[value="cohort"]')).toHaveText('동기만');await expect(scope.locator('option[value="all"]')).toHaveText('전체');
 await page.getByLabel('모임 유형').selectOption('club');await page.getByLabel('모임 이름').fill(name+' 소모임');await scope.selectOption('cohort');await page.getByRole('button',{name:'소모임 만들기',exact:true}).click();
 await expect(page.locator('.gn-detail .gn-card-tags')).toContainText('35사번 동기만');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('cohort35-group-only.png')});
});

test('36 schedules retain attendance controls while all unanswered labels and counts are absent',async({page})=>{
 const user={id:'test36',name:'36 테스트',className:'4반'},date='2026-11-02';
 await page.route('**/api/state',route=>route.fulfill({json:{demo:false,user,people:[user],dates:[date],now:`${date}T10:00:00+09:00`,state:{choices:{[date]:{[user.id]:{status:'unset',meal:'any'}}},days:{},events:[]}}}));
 await page.goto('/');await expect(page.getByRole('heading',{name:'내 점심 일정',exact:true})).toBeVisible();await expect(page.getByText('미응답',{exact:true})).toHaveCount(0);
 await expect(page.locator('.stat-card')).toHaveCount(2);await expect(page.locator('.nav-count')).toHaveCount(0);await expect(page.getByRole('button',{name:'11월 2일 참석',exact:true})).toBeEnabled();
 await navigateMenu(page,'이용 안내');await expect(page.getByRole('dialog')).not.toContainText('미응답');
});
