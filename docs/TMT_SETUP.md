# TMT 운영 설정

TMT Tech 8명, TMT ICT 10명: 총 18명. 초대 코드는 `TMT36`입니다.
명단은 `lib/backend/tmt-roster.ts`가 기준이며 모든 인원은 기본 미선택, 메뉴 상관없음입니다.

## 데이터와 인증

기존 Supabase 프로젝트 내 `tmt_lunch_*` 테이블/RPC와 `tmt_lunch_session`, `tmt_lunch_roster` 쿠키를 사용합니다.
AX/Global 계정·PIN·신청·과거 조 데이터는 복사하지 않습니다. 명단 외 가입은 서버와 DB 양쪽에서 거절합니다.
서버 환경변수 `TMT_INVITE_CODE`, `TMT_ADMIN_SECRET`이 필요합니다. 운영자 키는 다른 본부와 다르게 32자 이상으로 설정합니다.

## 운영 및 편성

운영 시작은 구축 시각 기준 신청 가능한 첫 평일, 종료는 2026-11-30입니다.
전날 22시 최초 편성, 당일 11시 마감, 13시 결과 날짜 전환을 유지합니다.
필수 메뉴 조건 → 조 인원 구성 → 최근 만남 회피/누적 횟수 → 두 팀 혼합 → 메뉴 선호 순이며 성별은 수집하거나 사용하지 않습니다.
Group Node에서는 전체 본부 모임에 참여하며 TMT 전용 모임도 만들 수 있습니다.

## 설치 및 검증

`python scripts/build-tmt-schema.py`로 두 설치 파일을 생성합니다.
기존 AX/Global 및 Group Node 설치 후 `supabase/tmt-schema.sql`, `supabase/tmt-group-node.sql` 순서로 적용합니다.
기존 AX/Global 설치 SQL을 다시 실행할 필요는 없습니다.
통합 마이그레이션은 두 파일을 한 트랜잭션으로 묶어 적용합니다.
단위·PostgreSQL·PC/모바일 브라우저 테스트로 본부별 인증, 명단, 기존 상태 보존 및 Group Node 권한을 확인합니다.
