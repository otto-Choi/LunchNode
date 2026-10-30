import type {AccountTenantId} from '../cohorts.ts';
export const CATEGORIES={hiking:'등산',boardgame:'보드게임',sports:'스포츠',food:'맛집',etc:'기타'} as const;
export type Category=keyof typeof CATEGORIES;
export type GroupView='browse'|'mine'|'clubs'|'past';
export type MeetupKind='one_off'|'club';
export type Member={id:string;tenant:AccountTenantId;name:string;className:string;isAdmin?:boolean};
export type Candidate={id:string;date:string;time:string|null;voters:Member[]};
export type Meetup={kind:MeetupKind;id:string;title:string;description:string;category:Category;minPeople:number;visibility:'all'|'cohort'|'headquarters';proposer:Member;participants:Member[];dates:Candidate[];status:'open'|'confirmed'|'cancelled';confirmedDateId:string|null;version:number;createdAt:string};
export type Comment={id:string;body:string;createdAt:string;member:Member};
export type MeetupDetail=Meetup&{comments:Comment[]};
export type MeetupInput={kind?:MeetupKind;title:string;description:string;category:Category;minPeople:number;visibility:'all'|'cohort'|'headquarters';dates:{id?:string;date:string;time:string|null}[]};
export function sameMember(a:Pick<Member,'id'|'tenant'>,b:Pick<Member,'id'|'tenant'>){return a.id===b.id&&a.tenant===b.tenant;}

export const visibilityLabel=(visibility:Meetup['visibility'])=>visibility==='all'?'전체':visibility==='cohort'?'동기만':'우리 본부만';
