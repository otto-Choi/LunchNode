'use client';
import {useEffect,useState} from 'react';
import {HEADQUARTERS,type HeadquartersId} from '@/lib/headquarters';
import {api} from '@/lib/client/api';

export default function HeadquartersDirectory({onGuide}:{onGuide:()=>void}){
 const [availability,setAvailability]=useState<Partial<Record<HeadquartersId,boolean>>>({});
 const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
 useEffect(()=>{let active=true;
  void api('/api/tenants').then((data:{headquarters:{id:HeadquartersId;available:boolean}[]})=>{
   if(active){setAvailability(Object.fromEntries(data.headquarters.map(h=>[h.id,h.available])));setStatus('ready');}
  }).catch(()=>{if(active)setStatus('error');});return()=>{active=false;};
 },[]);
 return <div className="headquarters-directory"><h2 id="modal-title">본부 목록</h2><p className="information-intro">추가된 순서대로 표시합니다.</p>
  <ol className="headquarters-list" aria-label="추가된 순서의 본부" role="list">{HEADQUARTERS.map((h,i)=><li key={h.id}><span className="headquarters-order" aria-hidden="true">{String(i+1).padStart(2,'0')}</span><strong>{h.label}</strong><span className={`headquarters-status ${availability[h.id]===true?'available':''}`}>{availability[h.id]===true?'이용 가능':availability[h.id]===false?'준비 중':status==='loading'?'확인 중':'상태 확인 불가'}</span></li>)}</ol>
  {status==='error'&&<p className="information-note" role="status">이용 상태를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p>}
  <p className="information-note">Lunch Node는 같은 본부끼리 편성합니다. Group Node의 ‘전체 본부’ 모임은 이용 가능한 모든 본부가 함께 참여합니다.</p>
  <button className="subtle-button information-back" onClick={onGuide}>이용 안내 보기</button>
 </div>;
}
