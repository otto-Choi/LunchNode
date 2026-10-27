'use client';
import {useState} from 'react';
import {api} from '@/lib/client/api';
import {HEADQUARTERS,type HeadquartersId} from '@/lib/headquarters';
import {sameMember,type Member} from '@/lib/group-node/types';
export default function MemberPicker({id,tenant,participants,busy,onAdd}:{id:string;tenant:HeadquartersId;participants:Member[];busy:boolean;onAdd:(target:Member)=>Promise<boolean>}){
 const [people,setPeople]=useState<Member[]|null>(null),[target,setTarget]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState('');
 async function open(){setLoading(true);setError('');try{const result=await api('/api/group-node?'+new URLSearchParams({participantsFor:id}),undefined,tenant);setPeople(result.people);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 const candidates=people?.filter(p=>!participants.some(m=>sameMember(m,p)))||[];
 return <div className="gn-member-picker">{!people?<button className="gn-secondary" disabled={busy||loading} onClick={()=>void open()}>{loading?'명단 확인 중…':'참여자 추가'}</button>:<form onSubmit={async e=>{e.preventDefault();const person=candidates.find(p=>p.tenant+':'+p.id===target);if(person&&await onAdd(person))setTarget('');}}><label>추가할 참여자<select aria-label="추가할 참여자" required value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}><option value="">이름 선택</option>{HEADQUARTERS.map(h=><optgroup key={h.id} label={h.label}>{candidates.filter(p=>p.tenant===h.id).map(p=><option key={p.tenant+p.id} value={p.tenant+':'+p.id}>{p.name} · {p.className}</option>)}</optgroup>)}</select></label><button className="gn-secondary" disabled={busy||!target}>추가</button><button type="button" className="gn-secondary" disabled={busy} onClick={()=>{setPeople(null);setTarget('');}}>닫기</button>{!candidates.length&&<p className="gn-muted">추가할 수 있는 인원이 없습니다.</p>}</form>}{error&&<p className="gn-error" role="alert">{error}</p>}</div>;
}
