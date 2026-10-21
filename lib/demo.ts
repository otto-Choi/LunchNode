import { emptyState, syncDue, weekdays, defaultChoice, type State } from './domain';
import { ROSTER } from './roster';
import { OPERATION_START, OPERATION_END, DEMO_NOW } from './operation';
export const demoPeople=ROSTER;
export const demoDates=weekdays(OPERATION_START,OPERATION_END);
export const demoNow=DEMO_NOW;
export function makeDemo():State {
  const state=emptyState();
  for(const [index,date] of demoDates.entries()) {
    state.choices[date]={};
    demoPeople.forEach((p,i)=>{state.choices[date][p.id]=p.defaultStatus==='absent'?defaultChoice(p):{status:i===0&&index>2?'unset':(index+i)%9===8?'absent':'join',meal:'any'};});

  }
  // Only dates whose actual match time has passed may show a group.
  // Seed the demo RNG so server markup and browser hydration agree.
  let seed=42;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  syncDue(state,demoDates,demoPeople,new Date(demoNow),random);
  return state;
}
