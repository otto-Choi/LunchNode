import {ROSTER} from '../roster.ts';
import {TMT_ROSTER} from './tmt-roster.ts';
import {GLOBAL_ROSTER} from './global-roster.ts';
import {matchingPolicy} from './matching-policy.ts';
import type {MatchingPolicy} from '../domain.ts';
import type {HeadquartersId} from '../headquarters.ts';
export const tenantConfig=(id:HeadquartersId)=>id==='ax'?{roster:ROSTER,policy:matchingPolicy}:{roster:id==='tmt'?TMT_ROSTER:GLOBAL_ROSTER,policy:{effectiveDate:'2026-10-01',genderByName:{},balanceClasses:true} satisfies MatchingPolicy};
