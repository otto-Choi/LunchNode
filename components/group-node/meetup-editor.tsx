'use client';
import {useState} from 'react';
import {CATEGORIES,type Meetup,type MeetupInput,type MeetupKind} from '@/lib/group-node/types';
export default function MeetupEditor({initial,busy,onSave,onCancel}:{initial?:Meetup;busy:boolean;onSave:(input:MeetupInput)=>void;onCancel:()=>void}) {
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [kind,setKind]=useState<MeetupKind>(initial?.kind||'one_off');
 const [title,setTitle]=useState(initial?.title||'');const [description,setDescription]=useState(initial?.description||'');
 const [category,setCategory]=useState<MeetupInput['category']>(initial?.category||'etc');const [minPeople,setMinPeople]=useState(initial?.minPeople||2);
 const [visibility,setVisibility]=useState<MeetupInput['visibility']>(initial?.visibility||'all');
 const [dates,setDates]=useState<MeetupInput['dates']>(initial?.dates.map(d=>({id:d.id,date:d.date,time:d.time}))||[{date:today,time:null}]);
 return <form className="gn-editor" onSubmit={e=>{e.preventDefault();onSave({kind,title,description,category,minPeople,visibility,dates});}}>
  <div className="gn-section-heading"><h2>{initial?'모임 수정':'모임 만들기'}</h2><button type="button" className="gn-secondary" disabled={busy} onClick={onCancel}>취소</button></div>
  <fieldset disabled={busy}>
   <label>모임 유형<select aria-label="모임 유형" value={kind} onChange={e=>{const next=e.target.value as MeetupKind;setKind(next);if(!initial&&next==='club')setDates([]);else if(next==='one_off'&&!dates.length)setDates([{date:today,time:null}]);}}><option value="one_off">1회성 모임</option><option value="club">소모임 · 지속적으로 모임</option></select></label>
   {kind==='club'&&<p className="gn-note">소모임은 날짜가 지나도 유지됩니다. Teams 페이지 등을 활용해 일정과 활동을 적극 관리해 보세요.</p>}
   <label>모임 이름<input aria-label="모임 이름" value={title} maxLength={60} required onChange={e=>setTitle(e.target.value)} placeholder="어떤 모임을 만들까요?"/></label>
   <div className="gn-form-row"><label>카테고리<select aria-label="카테고리" value={category} onChange={e=>setCategory(e.target.value as MeetupInput['category'])}>{Object.entries(CATEGORIES).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   <label>최소 인원<input aria-label="최소 인원" type="number" min={2} max={40} required value={minPeople} onChange={e=>setMinPeople(Number(e.target.value))}/></label></div>
   <label>모집 범위<select aria-label="모집 범위" value={visibility} onChange={e=>setVisibility(e.target.value as MeetupInput['visibility'])}><option value="all">전체 본부</option><option value="headquarters">우리 본부만</option></select></label>
   <label>{kind==='club'?'소모임 소개·모집글':'모임 설명'}<textarea aria-label={kind==='club'?'소모임 소개·모집글':'모임 설명'} rows={5} value={description} maxLength={2000} onChange={e=>setDescription(e.target.value)} placeholder="장소, 준비물, 예상 비용 등을 알려주세요."/></label>
   <div className="gn-section-heading"><h3>후보 날짜{kind==='club'&&' (선택)'}</h3><span>{dates.length}/5</span></div>
   {dates.map((d,i)=><div className="gn-date-fields" key={d.id||i}><label>날짜 {i+1}<input aria-label={`후보 날짜 ${i+1}`} type="date" required min={d.id?undefined:today} value={d.date} onChange={e=>setDates(rows=>rows.map((row,j)=>j===i?{...row,date:e.target.value}:row))}/></label><label>시간 (선택)<input aria-label={`후보 시간 ${i+1}`} type="time" step={600} value={d.time||''} onChange={e=>setDates(rows=>rows.map((row,j)=>j===i?{...row,time:e.target.value||null}:row))}/></label><button className="gn-secondary" type="button" aria-label={`후보 날짜 ${i+1} 삭제`} disabled={dates.length===(kind==='club'?0:1)} onClick={()=>setDates(rows=>rows.filter((_,j)=>i!==j))}>삭제</button></div>)}
   <button className="gn-secondary" type="button" disabled={dates.length===5} onClick={()=>setDates(rows=>[...rows,{date:today,time:null}])}>+ 날짜 추가</button>
   {initial&&<p className="gn-muted">변경·삭제한 후보의 투표는 초기화되고, 날짜 구성이 바뀌면 확정을 다시 해야 합니다.</p>}
   <button className="gn-primary gn-submit" type="submit">{busy?'저장 중…':initial?'수정 저장':kind==='club'?'소모임 만들기':'모임 만들기'}</button>
  </fieldset>
 </form>;
}
