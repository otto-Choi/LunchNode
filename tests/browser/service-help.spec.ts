import {test,expect,type Page} from '@playwright/test';
import {HEADQUARTERS} from '../../lib/headquarters';
import {navigateMenu} from './navigation';

async function signedIn(page:Page){
 const person={id:'help-user',name:'안내 확인',className:'4반'};
 await page.route('**/api/state',route=>route.fulfill({json:{demo:false,user:person,people:[person],dates:['2026-10-29'],now:'2026-10-29T10:00:00+09:00',state:{choices:{},days:{},events:[]}}}));
 await page.route('**/api/group-node',route=>route.fulfill({json:{meetups:[],total:0}}));
}
test('headquarters directory follows central registration order, shows readiness and works in both services',async({page},info)=>{
 await signedIn(page);let dealReady=false;
 await page.route('**/api/tenants',route=>route.fulfill({json:{headquarters:HEADQUARTERS.map(h=>({...h,available:h.id!=='deal'||dealReady}))}}));
 await page.goto('/');await navigateMenu(page,'본부 목록');const dialog=page.getByRole('dialog',{name:'본부 목록',exact:true});
 await expect(dialog.locator('.headquarters-list strong')).toHaveText(HEADQUARTERS.map(h=>h.label));
 await expect(dialog.getByRole('listitem').filter({hasText:'DEAL'})).toContainText('준비 중');await expect(dialog.getByRole('listitem').filter({hasText:'AX Node'})).toContainText('이용 가능');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('headquarters-directory.png')});
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 dealReady=true;await page.getByRole('button',{name:'Group Node',exact:true}).click();await navigateMenu(page,'본부 목록');
 await expect(dialog.getByRole('listitem').filter({hasText:'DEAL'})).toContainText('이용 가능');await expect(dialog.locator('.headquarters-list strong')).toHaveText(HEADQUARTERS.map(h=>h.label));
});
test('service guide covers current lunch and group flows and links to headquarters without enumerating scope names',async({page},info)=>{
 await signedIn(page);await page.route('**/api/tenants',route=>route.fulfill({json:{headquarters:HEADQUARTERS.map(h=>({...h,available:h.id!=='deal'}))}}));
 await page.goto('/');await navigateMenu(page,'이용 안내');let dialog=page.getByRole('dialog',{name:'이용 안내',exact:true});
 await expect(dialog.getByRole('button',{name:'Lunch Node',exact:true})).toHaveAttribute('aria-pressed','true');
 for(const text of ['전날 22:00','당일 11:00','당일 13:00','최대 4명','만남 횟수에 포함하지 않습니다'])await expect(dialog).toContainText(text);
 await dialog.getByRole('button',{name:'Group Node',exact:true}).click();
 for(const text of ['지난 1회성 모임도 소모임으로 전환','최소 인원이 모여도 날짜가 자동 확정되지는 않습니다','우리 본부만','Teams'])await expect(dialog).toContainText(text);
 await page.screenshot({path:info.outputPath('group-guide.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await dialog.getByRole('button',{name:'본부 목록 보기'}).click();await expect(page.getByRole('dialog',{name:'본부 목록',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'Group Node',exact:true}).click();
 await page.getByRole('button',{name:'+ 모임 만들기',exact:true}).click();
 await expect(page.getByLabel('모집 범위').locator('option[value="all"]')).toHaveText('전체');
 for(const h of HEADQUARTERS)await expect(page.getByLabel('모집 범위').locator('option[value="all"]')).not.toContainText(h.label);
 await navigateMenu(page,'이용 안내');dialog=page.getByRole('dialog',{name:'이용 안내',exact:true});await expect(dialog.getByRole('button',{name:'Group Node',exact:true})).toHaveAttribute('aria-pressed','true');
});
test('directory still lists headquarters when readiness lookup fails and refreshes on reopening',async({page})=>{
 await signedIn(page);let failing=true;
 await page.route('**/api/tenants',route=>route.fulfill(failing?{status:503,json:{error:'일시 오류'}}:{json:{headquarters:HEADQUARTERS.map(h=>({...h,available:true}))}}));
 await page.goto('/');await navigateMenu(page,'본부 목록');const dialog=page.getByRole('dialog',{name:'본부 목록',exact:true});
 await expect(dialog.getByRole('status')).toContainText('이용 상태를 불러오지 못했습니다');await expect(dialog.locator('.headquarters-list strong')).toHaveText(HEADQUARTERS.map(h=>h.label));
 await expect(dialog.locator('.headquarters-status').first()).toHaveText('상태 확인 불가');await page.getByRole('button',{name:'닫기',exact:true}).click();
 failing=false;await navigateMenu(page,'본부 목록');await expect(dialog.locator('.headquarters-status')).toHaveText(HEADQUARTERS.map(()=>'이용 가능'));
});
