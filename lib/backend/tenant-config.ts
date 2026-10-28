import {ROSTER} from '../roster.ts';
import {TMT_ROSTER} from './tmt-roster.ts';
import {GLOBAL_ROSTER} from './global-roster.ts';
import {DEAL_ROSTER} from './deal-roster.ts';
import {matchingPolicy} from './matching-policy.ts';
import type {MatchingPolicy} from '../domain.ts';
import type {HeadquartersId} from '../headquarters.ts';
const sharedPolicy={effectiveDate:'2026-10-01',genderByName:{},balanceClasses:true} satisfies MatchingPolicy;
const tenants={
 ax:{roster:ROSTER,policy:matchingPolicy},
 global:{roster:GLOBAL_ROSTER,policy:sharedPolicy},
 tmt:{roster:TMT_ROSTER,policy:sharedPolicy},
 deal:{roster:DEAL_ROSTER,policy:sharedPolicy},
};
export const tenantConfig=(id:HeadquartersId)=>tenants[id];
