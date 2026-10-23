import type { Person } from '../domain.ts';
export const GLOBAL_ROSTER:Person[]=[
 ['류지환','IOA'],['박인홍','IOA'],['백재호','IOA'],['이상원','IOA'],
 ['이윤서','IOA'],['최유정','IOA'],['김현태','IOA'],['유영채','IOA'],
 ['유한혁','IOA'],['이다혜','IOA'],['이시연','IOA'],['정지우','IOA'],
 ['강준현','IPO'],['고수현','IPO'],['김혜진','IPO'],['마승희','IPO'],
 ['문채윤','IPO'],['윤두하','IPO'],['곽종우','IPO'],['이기하','IPO'],
].map(([name,className],i)=>({id:`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,name,className,defaultStatus:'unset'}));
