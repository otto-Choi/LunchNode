'use client';
import {useEffect,useRef} from 'react';
import {ArrowRight,CalendarDays,CircleHelp,Compass,History,Users,X} from 'lucide-react';
import type {GroupView} from '@/lib/group-node/types';
export type NodeService='lunch'|'group';
export default function ServiceSidebar({administrator=false,service,tab,groupView,remaining,mobile,open,onClose,onLunch,onGroup,onGuide}:{administrator?:boolean;service:NodeService;tab:string;groupView:GroupView;remaining:number;mobile:boolean;open:boolean;onClose:()=>void;onLunch:(tab:'schedule'|'groups'|'history')=>void;onGroup:(view:GroupView)=>void;onGuide:()=>void}) {
 const panel=useRef<HTMLElement>(null);const closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{
  if(!mobile||!open)return;const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
  const focusable=()=>Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)')||[]).filter(n=>n.getClientRects().length);
  focusable()[0]?.focus();
  const keydown=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();closeRef.current();}if(e.key==='Tab'){const nodes=focusable(),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
  document.addEventListener('keydown',keydown);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keydown);previous?.focus();};
 },[mobile,open]);
 return <>{mobile&&open&&<div className="drawer-backdrop" aria-hidden="true" onClick={onClose}/>}<aside id="service-navigation" ref={panel} className={`sidebar service-sidebar ${open?'is-open':''}`} role={mobile&&open?'dialog':undefined} aria-modal={mobile&&open?true:undefined} aria-label={`${service==='group'?'Group':'Lunch'} Node 메뉴`}>
  <div className="sidebar-heading"><a className="brand" href={service==='group'?'/?service=group':'/'}><span className="brand-mark"><img src={service==='group'?'/groupnode.svg':'/lunchnode.svg'} alt="" width="40" height="40"/></span><span>{service==='group'?'Group Node':'Lunch Node'}</span></a><button className="drawer-close" onClick={onClose} aria-label="메뉴 닫기"><X size={22}/></button></div>
  <span className="service-caption">{service==='group'?'함께하는 소모임':'오늘의 점심 연결'}</span>
  <nav aria-label="서비스 메뉴">{service==='lunch'?([[CalendarDays,'schedule','내 점심 일정'],[Users,'groups','조 편성 결과'],[History,'history','지난 매칭 기록']] as const).map(([Icon,key,label])=><button key={key} className={tab===key?'nav-item active':'nav-item'} aria-current={tab===key?'page':undefined} onClick={()=>{onLunch(key);onClose();}}><Icon size={19}/>{administrator&&key==='schedule'?'운영 관리':label}{key==='schedule'&&remaining>0&&<span className="nav-count">{remaining}</span>}</button>):([[Compass,'browse','모임 둘러보기'],[Users,'mine','내 모임'],[Users,'clubs','소모임'],[History,'past','지난 모임']] as const).map(([Icon,key,label])=><button key={key} className={groupView===key?'nav-item active':'nav-item'} aria-current={groupView===key?'page':undefined} onClick={()=>{onGroup(key);onClose();}}><Icon size={19}/>{label}</button>)}</nav>
  <button className="guide-link" onClick={()=>{onGuide();onClose();}}><CircleHelp size={18}/> 이용 안내 <ArrowRight size={15}/></button>
 </aside></>;
}
