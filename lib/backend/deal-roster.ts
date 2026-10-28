import type {Person} from '../domain.ts';

// Enrollment and scheduled jobs remain closed until the confirmed roster is added.
// Reserve UUID prefix 30000000 for DEAL; never copy another headquarters' roster.
export const DEAL_ROSTER:Person[]=[];
