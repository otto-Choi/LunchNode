import {test,expect} from '@playwright/test';
const person={id:'p1',name:'권도영',className:'4반'};
const date='2026-10-23';
const payload=(status='unset',meal='any')=>({demo:false,user:person,people:[person],dates:[date,'2026-10-26'],now:`${date}T10:00:00+09:00`,state:{choices:{[date]:{p1:{status,meal}}},days:{},events:[]}});
const focus=async(page:import('@playwright/test').Page)=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));

test('background refresh preserves unsaved attendance and menu while date changes reset the draft',async({page})=>{
 let requests=0;await page.route('**/api/state',route=>{requests++;return route.fulfill({json:payload()});});
 await page.goto('/');await expect(page.locator('.schedule-editor')).toBeVisible();
 await page.getByRole('button',{name:'외식선호',exact:true}).click();
 const attendance=page.getByRole('group',{name:'참석 여부'});
 await attendance.getByRole('button',{name:'불참',exact:true}).click();
 await focus(page);await expect.poll(()=>requests).toBeGreaterThanOrEqual(2);
 await expect(page.getByRole('button',{name:'외식선호',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(attendance.getByRole('button',{name:'불참',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'10월 26일 선택',exact:true}).click();
 await expect(page.getByRole('button',{name:'상관없음',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(attendance.getByRole('button',{name:'참석',exact:true})).toHaveAttribute('aria-pressed','true');
});

for(const staleStatus of [200,401])test(`older state response (${staleStatus}) cannot overwrite a newer refresh`,async({page})=>{
 let requests=0;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/state',async route=>{
  const n=++requests;
  if(n===2){await gate;return route.fulfill(staleStatus===401?{status:401,json:{error:'오래된 인증 응답'}}:{json:payload('join','lunchbox')});}
  return route.fulfill({json:n>=3?payload('absent'):payload()});
 });
 await page.goto('/');await expect(page.locator('.schedule-editor')).toBeVisible();
 await focus(page);await expect.poll(()=>requests).toBe(2);
 await focus(page);await expect(page.locator('.date-cell.selected .status-label')).toHaveText('불참');
 const oldResponse=page.waitForResponse(r=>r.url().endsWith('/api/state')&&r.status()===staleStatus);
 release();await oldResponse;
 // Drain the response and a rendering frame before checking that neither data nor auth reverted.
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(page.locator('.date-cell.selected .status-label')).toHaveText('불참');
 await expect(page.getByRole('heading',{name:'내 점심 일정',exact:true})).toBeVisible();
});

test('Global login and saving still use Global when sessionStorage is blocked',async({page})=>{
 await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('blocked');};Storage.prototype.setItem=()=>{throw new Error('blocked');};});
 let loggedIn=false;const globalPerson={...person,name:'박인홍',className:'IOA'};let savedHeadquarters='';
 await page.route('**/api/tenants',route=>route.fulfill({json:{headquarters:[{id:'ax',available:true},{id:'global',available:true}]}}));
 await page.route('**/api/state',route=>{
  const hq=route.request().headers()['x-lunch-tenant'];
  if(route.request().method()==='POST'){savedHeadquarters=hq;return route.fulfill({json:{ok:true}});}
  return route.fulfill(loggedIn&&hq==='global'?{json:{...payload(),user:globalPerson,people:[globalPerson]}}:{status:401,json:{error:'로그인 필요'}});
 });
 await page.route('**/api/auth',route=>{const body=route.request().postDataJSON();if(body.action==='roster')return route.fulfill({status:403,json:{code:'INVITE',error:'초대 코드 필요'}});if(body.action==='unlock')return route.fulfill({json:{people:[globalPerson]}});loggedIn=true;return route.fulfill({json:{ok:true}});});
 await page.goto('/');await page.getByLabel('본부',{exact:true}).selectOption('global');
 await page.getByLabel('초대 코드').fill('global-code');await page.getByRole('button',{name:'초대 코드 확인',exact:true}).click();
 await page.getByLabel('이름',{exact:true}).selectOption('박인홍');await page.getByLabel('숫자 6자리 PIN').fill('123456');await page.getByRole('button',{name:'로그인',exact:true}).click();
 await expect(page.locator('.breadcrumb')).toContainText('Global');await page.getByRole('button',{name:'저장',exact:true}).click();await expect.poll(()=>savedHeadquarters).toBe('global');
});

test('expired invite gate returns to code entry and permits login after re-verification',async({page})=>{
 let expired=true,loggedIn=false;
 await page.route('**/api/state',route=>route.fulfill(loggedIn?{json:payload()}:{status:401,json:{error:'로그인 필요'}}));
 await page.route('**/api/auth',route=>{const body=route.request().postDataJSON();if(body.action==='roster'||body.action==='unlock'){if(body.action==='unlock')expired=false;return route.fulfill({json:{people:[person]}});}if(expired)return route.fulfill({status:403,json:{code:'INVITE',error:'초대 코드를 먼저 확인해 주세요.'}});loggedIn=true;return route.fulfill({json:{ok:true}});});
 await page.goto('/');await page.getByLabel('이름',{exact:true}).selectOption('권도영');await page.getByLabel('숫자 6자리 PIN').fill('123456');await page.getByRole('button',{name:'로그인',exact:true}).click();
 await expect(page.getByLabel('초대 코드')).toBeVisible();await expect(page.getByRole('alert').filter({hasText:'초대 코드를 먼저'})).toBeVisible();
 await page.getByLabel('초대 코드').fill('ci-invitation');await page.getByRole('button',{name:'초대 코드 확인',exact:true}).click();
 await page.getByLabel('이름',{exact:true}).selectOption('권도영');await page.getByLabel('숫자 6자리 PIN').fill('123456');await page.getByRole('button',{name:'로그인',exact:true}).click();
 await expect(page.getByRole('heading',{name:'내 점심 일정',exact:true})).toBeVisible();
});
