# Supabase DB 설정

현재 구조는 **프로젝트 하나, 본부별 테이블**입니다.

- AX Node: `public.lunch_*`
- Global: `public.global_lunch_*`

기존 AX 프로젝트에는 `upgrade-shared-db.sql` 전체를 SQL Editor에서 실행합니다. 계정·PIN·신청·확정 기록을 유지하면서 필요한 선행 함수와 Global 테이블을 추가합니다. 실행 순서와 확인 쿼리는 [설정 안내](../HEADQUARTERS_SETUP.md)를 참고하세요.

새 프로젝트를 만드는 경우 `schema.sql` 전체 또는 `migrations/`의 번호 순서로 적용합니다. GitHub/CLI 자동 migration에는 Global 테이블 추가도 포함됩니다. 데이터가 있는 DB에서 reset을 실행하지 않습니다.

`global-schema.sql`은 현재 AX와 같은 DB에 Global 테이블만 추가하는 파일입니다. `20261023090000_headquarters_operations.sql`까지 적용된 프로젝트에서 사용할 수 있습니다. 일반 사용자는 선행 업데이트를 함께 포함한 `upgrade-shared-db.sql`을 사용하면 됩니다.

운영 기간은 `lunch_settings`, `global_lunch_settings`가 각각 관리합니다. Vercel의 날짜 환경변수로 DB 일정이 변경되지는 않습니다. 기본 종료일은 2026-11-30입니다.

브라우저 역할에는 테이블/서버 RPC 접근 권한이 없습니다. 서버는 같은 service_role 키로 본부별 함수만 호출하며, 본부를 변경해도 다른 본부 세션은 사용할 수 없습니다. PIN은 scrypt 해시, 세션 토큰은 SHA-256으로 저장합니다. DB 마감 시각과 확정 조 보존 조건은 각 본부 함수에서 동일하게 적용합니다.
