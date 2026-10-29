'use client';
import {useState} from 'react';
import {LUNCHBOX_POOL_START_DATE} from '@/lib/domain';
import type {NodeService} from './service-sidebar';

function LunchGuide(){return <div className="service-guide-content" aria-label="Lunch Node 이용 안내">
 <section><h3>1. 참석·불참 신청</h3><p>달력에서 날짜를 선택한 뒤 참석 여부와 메뉴를 저장하세요. ‘여러 날짜 참석/불참’으로 한 번에 입력할 수도 있습니다. 메뉴 기본값은 ‘상관없음’입니다.</p>
  <dl className="guide-meals"><div><dt>도시락만</dt><dd>인원 제한 없는 하나의 ‘도시락’ 묶음에 표시합니다.</dd></div><div><dt>도시락선호 · 외식선호</dt><dd>해당 메뉴를 선호하지만 인원 구성에 따라 다른 메뉴로 편성될 수 있습니다.</dd></div><div><dt>상관없음</dt><dd>일반 조에서 도시락·외식 모두 배정 가능합니다.</dd></div><div><dt>외식만</dt><dd>외식하는 일반 조에만 배정합니다.</dd></div></dl>
 </section>
 <section><h3>2. 편성·마감 시간</h3><dl className="guide-times"><div><dt>전날 22:00</dt><dd>현재 참석자를 처음 편성합니다.</dd></div><div><dt>당일 11:00</dt><dd>신청 변경을 마감하고 최종 명단을 확정합니다.</dd></div><div><dt>당일 13:00</dt><dd>결과 화면의 기본 날짜가 다음 운영일로 바뀝니다. 날짜를 선택해 오늘 결과도 볼 수 있습니다.</dd></div></dl><p className="information-note">모든 시간은 한국 시간 기준입니다.</p></section>
 <section><h3>3. 조는 이렇게 구성해요</h3><ul><li>‘도시락만’은 별도 묶음, 나머지 참석자는 최대 4명씩 편성합니다. 도시락선호·상관없음은 도시락 묶음에 합류하지 않습니다.</li><li>일반 조는 외식만 조건과 인원 구성을 먼저 맞춘 뒤, 최근 만난 사람과의 재회를 줄이고 누적 만남 횟수와 본부별 혼합 기준을 고려합니다.</li><li>인원이 맞지 않으면 1~2명 조가 생길 수 있지만 참석자를 제외하지 않습니다. 도시락 묶음은 만남 횟수에 포함하지 않습니다.</li></ul><p className="information-note">도시락 묶음 규칙은 {LUNCHBOX_POOL_START_DATE.replaceAll('-','.')} 식사분부터 적용하며, 이전 편성 기록은 유지합니다.</p></section>
 <section><h3>4. 신청을 바꾸거나 조를 확인할 때</h3><p>마감 전까지 추가 참석·취소·메뉴 변경이 가능합니다. 도시락만 추가 참석자는 도시락 묶음에, 나머지는 빈자리 또는 새 조에 배정됩니다. 메뉴를 바꾸면 이전 자리는 보장되지 않습니다.</p><p>일반 변경에서는 다른 조원을 옮기지 않습니다. 운영자가 전체 재편성을 실행한 경우에는 조가 바뀔 수 있으니 최종 명단을 확인하세요. 최종 확정된 일반 조만 이후 만남 기록에 반영합니다.</p><p>상단 ‘오늘 내 조’와 ‘조 편성 결과’에서 확인하세요. 결과 하단에서는 불참·미선택·참석 미배정 인원을 구분해 볼 수 있습니다.</p></section>
 </div>;}
function GroupGuide(){return <div className="service-guide-content" aria-label="Group Node 이용 안내">
 <section><h3>1. 모임 찾기</h3><dl className="guide-meals"><div><dt>모임 둘러보기</dt><dd>앞으로 열릴 1회성 모임과 지속형 소모임을 봅니다.</dd></div><div><dt>내 모임</dt><dd>내가 만들거나 참여한 모임을 모아 봅니다.</dd></div><div><dt>소모임</dt><dd>지속적으로 모이는 소모임만 봅니다.</dd></div><div><dt>지난 모임</dt><dd>날짜가 지난 1회성 모임을 봅니다.</dd></div></dl></section>
 <section><h3>2. 만들기·참여하기</h3><p>‘모임 만들기’에서 1회성 모임 또는 소모임을 고르고, 설명·최소 인원·후보 날짜·모집 범위를 입력하세요. 모임을 만들면 자동으로 참여합니다.</p><dl className="guide-meals"><div><dt>전체</dt><dd>이용 가능한 모든 사번·본부에서 조회·참여할 수 있습니다.</dd></div><div><dt>동기만</dt><dd>작성자와 같은 사번끼리 본부에 관계없이 조회·참여할 수 있습니다.</dd></div><div><dt>우리 본부만</dt><dd>같은 본부의 사용자에게만 공개됩니다.</dd></div></dl><p>마음에 드는 모임에서 ‘참여하기’를 누르면 후보 날짜에 투표할 수 있습니다.</p></section>
 <section><h3>3. 날짜 투표와 확정</h3><p>참여 후 가능한 날짜를 모두 선택하세요. 최소 인원이 모여도 날짜가 자동 확정되지는 않습니다. 모임장이 후보 중 하나를 최종 확정합니다.</p><p>참여를 취소하면 내 투표도 삭제됩니다. 후보 날짜를 변경하면 해당 후보의 투표가 초기화되므로 다시 확인하세요.</p></section>
 <section><h3>4. 소모임 관리</h3><p>소모임은 날짜가 지나도 ‘모임 둘러보기’와 ‘소모임’에 남습니다. 모임장은 지난 1회성 모임도 소모임으로 전환하고 참여자를 추가할 수 있습니다.</p><p>Teams 페이지 등을 활용해 소모임 일정과 활동을 적극 관리해 보세요. 앱에서는 모집글·참여자·후보 일정·댓글을 관리할 수 있습니다.</p></section>
 </div>;}
export default function ServiceGuide({service,groupOnly=false,onHeadquarters}:{service:NodeService;groupOnly?:boolean;onHeadquarters:()=>void}){
 const [selected,setSelected]=useState<NodeService>(groupOnly?'group':service);
 return <div className="service-guide"><h2 id="modal-title">이용 안내</h2><div className="guide-service-switch" role="group" aria-label="서비스별 이용 안내">{!groupOnly&&<button aria-pressed={selected==='lunch'} onClick={()=>setSelected('lunch')}>Lunch Node</button>}<button aria-pressed={selected==='group'} onClick={()=>setSelected('group')}>Group Node</button></div>{selected==='lunch'?<LunchGuide/>:<GroupGuide/>}<div className="guide-directory-link"><span>함께 이용하는 본부가 궁금하다면</span><button className="subtle-button" onClick={onHeadquarters}>본부 목록 보기</button></div></div>;
}
