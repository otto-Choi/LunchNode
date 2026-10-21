import type { Person } from './domain';

export const ROSTER: Person[] = [
  ['권도영','4반'],['김서영','4반'],['손규영','4반'],['김민국','4반'],
  ['김상규','4반'],['안소이','4반'],['유태상','4반'],['최철원','4반'],
  ['김주연','5반'],['박서연','5반'],['박진홍','5반'],['양우진','5반'],
  ['장은영','5반'],['김영탁','5반'],['부유경','5반'],['서유빈','5반'],['오성현','5반'],
  ['김범준','12월 입사자'],['박대원','12월 입사자'],['박진영','12월 입사자'],
].map(([name,className],i)=>({
  id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,
  name,className,defaultStatus:className==='12월 입사자'?'absent' as const:'unset' as const,
}));
export function rosterMember(name:string){return ROSTER.find(p=>p.name===name.normalize('NFKC').trim());}
