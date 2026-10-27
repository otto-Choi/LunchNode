import type {Person} from '../domain.ts';
export const TMT_ROSTER:Person[]=
[
 [
  "김수연",
  "TMT Tech"
 ],
 [
  "김현준",
  "TMT Tech"
 ],
 [
  "이예현",
  "TMT Tech"
 ],
 [
  "이준섭",
  "TMT Tech"
 ],
 [
  "전성훈",
  "TMT Tech"
 ],
 [
  "정준원",
  "TMT Tech"
 ],
 [
  "김나경",
  "TMT Tech"
 ],
 [
  "박주혜",
  "TMT ICT"
 ],
 [
  "어제웅",
  "TMT ICT"
 ],
 [
  "이승주",
  "TMT ICT"
 ],
 [
  "이희무",
  "TMT ICT"
 ],
 [
  "조서윤",
  "TMT Tech"
 ],
 [
  "박진형",
  "TMT ICT"
 ],
 [
  "설제은",
  "TMT ICT"
 ],
 [
  "오유진",
  "TMT ICT"
 ],
 [
  "이신후",
  "TMT ICT"
 ],
 [
  "채수진",
  "TMT ICT"
 ],
 [
  "최한용",
  "TMT ICT"
 ]
].map(([name,className],i)=>({id:`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,name,className,defaultStatus:'unset'}));
