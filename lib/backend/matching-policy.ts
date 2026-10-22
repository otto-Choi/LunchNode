import type { MatchingPolicy } from '../domain.ts';
// Server-side operational matching input. Do not add these values to Person,
// the shared roster, API responses, or client components.
// First affected lunch is Oct 23: its initial match runs Oct 22 at 22:00 KST.
export const matchingPolicy:MatchingPolicy={
 effectiveDate:'2026-10-23',
 genderByName:{
  '박서연':2,'서유빈':2,'최철원':1,'박진홍':1,'부유경':2,
  '오성현':1,'김서영':2,'김영탁':1,'권도영':1,'양우진':2,
  '장은영':2,'손규영':2,'안소이':2,'김상규':1,'김민국':1,
  '김주연':2,'유태상':1,'김범준':1,'박대원':1,'박진영':2,
 },
};
