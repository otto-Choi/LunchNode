import {test,expect} from '@playwright/test';
test('register, change attendance and menu, reload, and log out',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page).toHaveTitle('런치노드 · 점심 신청 및 조 편성');await expect(page.locator('.brand')).toContainText('런치노드');await expect(page.locator('.brand img')).toHaveAttribute('src','/lunchnode.svg');const icon=await page.request.get('/icon.svg');expect(icon.ok()).toBe(true);expect(await icon.text()).toContain('<circle');await page.getByRole('button',{name:'처음이라면 최초 등록'}).click();
 await page.getByLabel('이름',{exact:true}).selectOption(info.project.name==='mobile'?'김서영':'권도영');
 await page.getByLabel('초대 코드').fill('ci-invitation');await page.getByLabel('숫자 6자리 PIN').fill('123456');
 const loaded=page.waitForResponse(r=>r.url().endsWith('/api/state')&&r.status()===200);
 await page.getByRole('button',{name:'등록',exact:true}).click();const payload=await (await loaded).json();
 await expect(page.getByRole('heading',{name:'내 점심 일정',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'오늘 내 조'})).toBeVisible();
 for(const card of await page.locator('.date-cell.past-date').all()){if(info.project.name==='mobile')await expect(card).toBeHidden();else await expect(card).toBeVisible();}
 if(info.project.name==='desktop'){const boxes=await page.locator('.schedule-editor .meal-option').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));expect(new Set(boxes).size).toBe(1);}
 const future=payload.dates.find((d:string)=>new Date(payload.now)<new Date(`${d}T11:00:00+09:00`));
 const short=`${Number(future.slice(5,7))}월 ${Number(future.slice(8))}일`;
 const write=()=>page.waitForResponse(r=>r.url().endsWith('/api/state')&&r.request().method()==='POST');
 let pending=write();await page.getByRole('button',{name:`${short} 참석`,exact:true}).click();expect((await pending).status()).toBe(200);
 await expect(page.locator('.date-cell.selected .status-label')).toHaveText('참석');
 await expect(page.locator('.schedule-editor .meal-option')).toHaveText(['도시락만','도시락선호','상관없음','외식선호','외식만']);
 await expect(page.getByRole('button',{name:'상관없음',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'외식선호',exact:true}).click();pending=write();await page.getByRole('button',{name:'저장',exact:true}).click();expect((await pending).status()).toBe(200);
 await page.reload();await expect(page.locator('.date-cell.selected .date-meal')).toHaveText('외식선호');
 pending=write();await page.getByRole('button',{name:`${short} 불참`,exact:true}).click();expect((await pending).status()).toBe(200);await expect(page.locator('.date-cell.selected .status-label')).toHaveText('불참');

 // Select a date through the card's padding, away from both its number and action buttons.
 const openDates=payload.dates.filter((d:string)=>new Date(payload.now)<new Date(`${d}T11:00:00+09:00`));
 const title=(d:string)=>`${Number(d.slice(5,7))}월 ${Number(d.slice(8))}일`;
 const dateButton=(d:string)=>page.getByRole('button',{name:`${title(d)} 선택`,exact:true});
 const blankArea=async(d:string)=>{const card=page.locator('.date-cell').filter({has:dateButton(d)});const box=await card.boundingBox();if(!box)throw new Error('Date card missing');await card.click({position:{x:box.width-6,y:box.height-6}});};
 await blankArea(openDates[1]);await expect(dateButton(openDates[1])).toHaveAttribute('aria-pressed','true');
 const readState=async()=>{const r=await page.request.get('/api/state');expect(r.ok()).toBe(true);return r.json();};
 const beforeBulk=await readState();const untouched=beforeBulk.state.choices[openDates[2]][payload.user.id];
 await page.getByRole('button',{name:'여러 날짜 참석/불참',exact:true}).click();
 await expect(page.getByRole('button',{name:'참석으로 저장',exact:true})).toBeDisabled();
 const closedDate=payload.dates.find((d:string)=>new Date(payload.now)>=new Date(`${d}T11:00:00+09:00`));
 if(closedDate)await expect(page.locator(`.date-hit-target[aria-label="${title(closedDate)} 선택"]`)).toBeDisabled();
 await blankArea(openDates[0]);await expect(page.locator('.date-cell.picked')).toHaveCount(1);
 await dateButton(openDates[0]).click();await expect(page.locator('.date-cell.picked')).toHaveCount(0);
 await blankArea(openDates[0]);await dateButton(openDates[1]).focus();await page.keyboard.press('Space');
 await expect(page.locator('.date-cell.picked')).toHaveCount(2);
 await expect(page.getByLabel('선택한 날짜')).toContainText(title(openDates[0]));await expect(page.locator('.bulk-summary')).toContainText('2일 · 참석');
 await page.getByRole('button',{name:`${title(openDates[1])} 선택 해제`,exact:true}).click();await expect(page.locator('.bulk-summary')).toContainText('1일 · 참석');await dateButton(openDates[1]).click();
 await expect(page.getByRole('group',{name:'일괄 메뉴'}).locator('.meal-option')).toHaveText(['도시락만','도시락선호','상관없음','외식선호','외식만']);
 await expect(page.getByRole('group',{name:'일괄 메뉴'}).getByRole('button',{name:'상관없음',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('group',{name:'일괄 메뉴'}).getByRole('button',{name:'외식선호',exact:true}).click();
 pending=write();await page.getByRole('button',{name:'참석으로 저장',exact:true}).click();const bulkJoin=await pending;expect(bulkJoin.status()).toBe(200);
 expect(bulkJoin.request().postDataJSON()).toEqual({dates:openDates.slice(0,2),choice:{status:'join',meal:'prefer_outside'}});
 await expect(page.locator('.bulk-editor')).toHaveCount(0);
 let saved=await readState();for(const d of openDates.slice(0,2))expect(saved.state.choices[d][payload.user.id]).toEqual({status:'join',meal:'prefer_outside'});
 expect(saved.state.choices[openDates[2]][payload.user.id]).toEqual(untouched);
 await page.getByRole('button',{name:'여러 날짜 참석/불참',exact:true}).click();
 await blankArea(openDates[0]);await blankArea(openDates[1]);await page.getByRole('group',{name:'일괄 참석 여부'}).getByRole('button',{name:'불참',exact:true}).click();
 await expect(page.getByRole('group',{name:'일괄 메뉴'})).toHaveCount(0);
 pending=write();await page.getByRole('button',{name:'불참으로 저장',exact:true}).click();expect((await pending).status()).toBe(200);
 await expect(page.locator('.bulk-editor')).toHaveCount(0);await page.reload();
 await expect(page.getByRole('heading',{name:'내 점심 일정',exact:true})).toBeVisible();saved=await readState();
 for(const d of openDates.slice(0,2))expect(saved.state.choices[d][payload.user.id].status).toBe('absent');
 expect(saved.state.choices[openDates[2]][payload.user.id]).toEqual(untouched);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByRole('button',{name:'이용 안내',exact:false}).first().click();await expect(page.getByRole('dialog')).toContainText('최근에 만난 사람과 다시 만나는 일을 가장 먼저 피합니다');await expect(page.getByRole('dialog')).toContainText('상관없음은 양쪽 모두 배정');await page.getByRole('button',{name:'닫기',exact:true}).click();
 await page.locator('.profile-button').click();await page.getByRole('button',{name:'운영자 도구',exact:true}).click();
 await page.getByLabel('운영자 키',{exact:true}).fill('ci-operator-secret-at-least-32-chars');const adminCheck=page.waitForResponse(r=>r.url().endsWith('/api/admin'));await page.getByRole('button',{name:'운영자 인증',exact:true}).click();expect((await adminCheck).status()).toBe(200);await expect(page.getByLabel('작업',{exact:true})).toBeVisible();
 await page.getByLabel('작업',{exact:true}).selectOption('recover');await page.getByRole('button',{name:'실행',exact:true}).click();await expect(page.getByRole('dialog').getByRole('status')).toContainText('누락된 편성·마감 처리를 완료했습니다.');
 await page.getByRole('button',{name:'닫기',exact:true}).click();
 await page.locator('.profile-button').click();await page.getByRole('button',{name:'로그아웃',exact:true}).click();await expect(page.getByRole('heading',{name:'로그인',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});

test('operator rematch requires date and confirmation, submits the selected day and refreshes results',async({page})=>{
 // Isolate the time-dependent UI. Production SQL and lock/cutoff behavior are covered by test:db.
 const person={id:'00000000-0000-4000-8000-000000000001',name:'권도영',className:'4반'};
 const date='2026-10-22';let refreshed=false;let requested:any=null;
 const payload=()=>({demo:false,user:person,people:[person],dates:[date,'2026-10-23'],now:`${date}T10:00:00+09:00`,state:{choices:{[date]:{[person.id]:{status:'join',meal:'any'}}},days:{[date]:{phase:'matched',matchedAt:'2026-10-21T22:00:00+09:00',...(refreshed?{rematchedAt:`${date}T10:00:00+09:00`}:{}),groups:[{id:'a',meal:'lunchbox',members:[person]}]}},events:[]}});
 await page.route('**/api/state',route=>route.fulfill({json:payload()}));
 await page.route('**/api/admin',async route=>{const body=route.request().postDataJSON();if(body.action==='rematch'){requested=body;refreshed=true;}await route.fulfill({json:{ok:true,message:body.action==='rematch'?'전체 조를 재편성했습니다.':'운영자 인증이 완료되었습니다.'}});});
 await page.goto('/');await page.locator('.profile-button').click();await page.getByRole('button',{name:'운영자 도구',exact:true}).click();
 await page.getByLabel('운영자 키',{exact:true}).fill('ci-operator-secret-at-least-32-chars');await page.getByRole('button',{name:'운영자 인증',exact:true}).click();await page.getByLabel('작업',{exact:true}).selectOption('rematch');
 const submit=page.getByRole('button',{name:'전체 조 다시 편성',exact:true});await expect(submit).toBeDisabled();await expect(page.getByLabel('재편성 날짜')).toHaveValue(date);await expect(page.getByLabel('재편성 날짜').locator('option')).toHaveCount(2);
 await expect(page.getByRole('dialog')).toContainText('기존 조는 만남 횟수에 포함되지 않으며');
 await page.getByRole('checkbox',{name:'기존 조가 바뀌며',exact:false}).check();await submit.click();await expect(page.getByRole('dialog').getByRole('status')).toContainText('전체 조를 재편성했습니다.');expect(requested.action).toBe('rematch');expect(requested.date).toBe(date);
 await expect(submit).toBeDisabled();await page.getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('button',{name:'조 편성 결과',exact:true}).click();await expect(page.locator('.results-note')).toContainText('재편성했습니다');
});

test('group results display everyone outside groups with attendance and menu conditions',async({page})=>{
 const people=[{id:'p1',name:'권도영',className:'4반'},{id:'p2',name:'김서영',className:'4반'},{id:'p3',name:'손규영',className:'4반'},{id:'p4',name:'김민국',className:'4반'},{id:'p5',name:'김상규',className:'4반'}];
 const date='2026-10-22';const payload={demo:false,user:people[0],people,dates:[date],now:`${date}T10:00:00+09:00`,state:{choices:{[date]:{p1:{status:'join',meal:'lunchbox'},p2:{status:'join',meal:'outside'},p3:{status:'absent',meal:'prefer_lunchbox'},p4:{status:'unset',meal:'any'},p5:{status:'join',meal:'prefer_outside'}}},days:{[date]:{phase:'matched',matchedAt:'2026-10-21T22:00:00+09:00',groups:[{id:'a',meal:'lunchbox',members:[people[0]]},{id:'b',meal:'outside',members:[people[1]]}]}},events:[]}};
 await page.route('**/api/state',route=>route.fulfill({json:payload}));await page.goto('/');await page.getByRole('button',{name:'조 편성 결과',exact:true}).click();
 const section=page.getByRole('region',{name:'조 미포함 인원'});await expect(section).toContainText('전체 5명 · 조 배정 2명 · 조 미포함 3명');await expect(section.locator('li')).toHaveCount(3);await expect(page.locator('.group-card').filter({hasText:'권도영'}).locator('.mate-choice')).toHaveText('선택: 도시락만');await expect(page.locator('.group-card').filter({hasText:'김서영'}).locator('.mate-choice')).toHaveText('선택: 외식만');
 const row=(name:string)=>section.getByRole('listitem').filter({hasText:name});await expect(row('손규영')).toContainText('불참');await expect(row('손규영')).toContainText('도시락선호');await expect(row('김민국')).toContainText('미선택');await expect(row('김민국')).toContainText('상관없음');await expect(row('김상규')).toContainText('참석');await expect(row('김상규')).toContainText('외식선호');await expect(row('김상규')).toContainText('미배정');await expect(section.getByRole('alert')).toContainText('참석 신청자 1명');
 await page.getByRole('checkbox',{name:'내가 포함된 조만 보기',exact:true}).check();await expect(page.locator('.group-card')).toHaveCount(1);await expect(section.locator('li')).toHaveCount(3);await expect(section).not.toContainText('김서영');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('nonparticipants distinguish selected absence, default absence and legacy unknown origin',async({page})=>{
 const people=[{id:'a',name:'김범준',className:'12월 입사자',defaultStatus:'absent'},{id:'b',name:'박대원',className:'12월 입사자',defaultStatus:'absent'},{id:'c',name:'박진영',className:'12월 입사자',defaultStatus:'absent'},{id:'d',name:'권도영',className:'4반',defaultStatus:'unset'}];
 const date='2026-10-23';await page.route('**/api/state',route=>route.fulfill({json:{demo:false,user:people[0],people,dates:[date],now:'2026-10-23T10:00:00+09:00',state:{choiceOrigins:{[date]:{a:'selected',b:'default'}},choices:{[date]:{a:{status:'absent',meal:'outside'},b:{status:'absent',meal:'any'},c:{status:'absent',meal:'any'},d:{status:'unset',meal:'any'}}},days:{[date]:{phase:'matched',matchedAt:'2026-10-22T22:00:00+09:00',groups:[]}},events:[]}}}));
 await page.goto('/');await page.getByRole('button',{name:'조 편성 결과',exact:true}).click();const section=page.getByRole('region',{name:'조 미포함 인원'}),row=(name:string)=>section.getByRole('listitem').filter({hasText:name});
 await expect(row('김범준').locator('.status-label')).toHaveText('불참 선택');await expect(row('박대원').locator('.status-label')).toHaveText('기본 불참');await expect(row('박진영').locator('.status-label')).toHaveText('불참 · 선택 여부 미확인');await expect(row('권도영').locator('.status-label')).toHaveText('미선택');await expect(section.locator('.attendance-breakdown')).toHaveText('불참 3명 · 미선택 1명 · 참석 미배정 0명');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
