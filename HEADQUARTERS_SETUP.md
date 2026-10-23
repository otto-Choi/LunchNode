# AX Node + Global 운영 전환

두 본부는 같은 사이트를 사용하지만 **서로 다른 Supabase 프로젝트**에 연결합니다. AX Node의 기존 사용자 ID, PIN, 세션, 신청 및 확정 조는 유지됩니다. 본부 변경은 프로필 메뉴에서 가능합니다. 초대 코드를 확인한 후 해당 본부의 이름 목록만 표시되며, PIN과 운영자 키는 본부별로 구분됩니다.

### 1. 기존 AX Node DB 업데이트

기존 Supabase SQL Editor에서 `supabase/migrations/20261023090000_headquarters_operations.sql`만 실행합니다. 기존 `20261021090300_admin_tools.sql`, `20261021090400_admin_rematch.sql`이 먼저 적용되어 있어야 합니다. 이번 파일은 사용자/신청/확정 조를 삭제하지 않으며, 운영 종료일을 2026-11-30까지 연장하고 본부 식별·작업 상태·첫날 편성 함수를 추가합니다. 기존 프로젝트에 `global-schema.sql`을 실행하지 마세요.

### 2. Global 전용 새 Supabase 프로젝트

새 프로젝트 SQL Editor에서 `supabase/global-schema.sql`을 실행합니다. IOA 12명, IPO 8명이 생성되며 기본값은 모두 미응답입니다. 이름 수정: 박인홍, 백재호, 유영채 반영. 설치 시 한국 시간 오전 11시 이전이면 당일 평일, 이후면 다음 평일부터 운영하며 종료일은 2026-11-30입니다. 주말 설치 시 다음 월요일부터 운영합니다. 기존 LunchNode 테이블이 있으면 실행을 거부하는 새 설치 전용 파일입니다. 이후 공통 변경은 개별 migration 파일을 적용합니다. Global 프로젝트는 기존 AX용 `supabase/` 폴더를 대상으로 GitHub 자동 DB 배포를 켜지 마세요. 초기 AX 명단 migration이 포함되어 있으므로 Global 설치는 이 전용 파일로 진행합니다.

### 3. Vercel 환경변수

기존 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INVITE_CODE`, `ADMIN_SECRET`, `CRON_SECRET`은 AX Node용으로 그대로 둡니다. 다음 네 개를 **Production**에 추가하고 재배포합니다.

| Key | Value |
| --- | --- |
| `GLOBAL_SUPABASE_URL` | 새 Global 프로젝트 URL |
| `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` | 새 Global 프로젝트 service_role 키 |
| `GLOBAL_INVITE_CODE` | 직접 정한 Global 전용 초대 코드 |
| `GLOBAL_ADMIN_SECRET` | 직접 정한 32자 이상 Global 전용 운영자 키 |

Global URL, 초대 코드, 운영자 키는 AX Node와 달라야 합니다. 미설정 시 Global은 준비 중으로 표시됩니다. `DEMO_MODE=false`, `APP_ORIGIN=https://lunch-node.vercel.app`을 사용합니다. 키에 `NEXT_PUBLIC_`를 붙이지 마세요. 비밀키/PIN을 문의 이메일이나 저장소에 올리지 마세요. 선택 사항인 `AX_` 접두사 변수는 `.env.example`을 참고하세요.

### 4. 오픈 확인

Global 선택 → 전용 초대 코드 → 이름 선택 → 최초 등록 → 참석 저장 → 새로고침 후 유지되는지 확인합니다. 운영자 도구는 현재 로그인한 본부의 키만 허용합니다. 당일 11시 이전이면 첫 운영일 최초 편성 또는 전체 조 다시 편성을 실행해 결과를 확인합니다. 초기 편성이 이미 자동 생성되었다면 전체 재편성을 사용합니다. 다음 평일이 첫날인 경우 전날 22시까지 신청을 받고 정상 예약 작업을 사용합니다.

매칭은 전날 22시, 최종 확정은 당일 11시(한국 시간)입니다. Cron은 두 본부를 독립 실행하며 한 본부 장애가 다른 본부 실행을 막지 않습니다. 실패가 있으면 HTTP 503을 반환합니다. 운영자 도구에서 해당 본부의 마지막 성공 시각과 최근 실패 여부를 확인하고 누락 복구를 실행할 수 있습니다. 화면 접속 시에도 누락 처리를 보완합니다. Vercel 요금제에 따른 Cron 실행 빈도/정확도 제한은 계속 적용됩니다.

필수 메뉴와 조 인원을 지킨 뒤 최근/누적 만남을 줄이고, Global은 IOA·IPO 혼합을, AX Node는 기존 구성 균형을 적용합니다. 확정되지 않은 재편성 전 조는 만남 기록에 포함하지 않습니다. PC는 월별 달력, 모바일은 오늘 이후 운영일을 표시합니다. 공통 문의는 `AX Node 최철원 · cheolwon.choi@pwc.com`으로 연결되며 별도 Global 담당자는 표시하지 않습니다.

`npm test`는 본부 코드/키/쿠키/신청 격리 및 독립 Cron을, `npm run test:db`는 별도 PostgreSQL DB 설치와 AX 데이터 보존 및 첫날 편성을, 브라우저 테스트는 초대 코드부터 등록·일정 변경까지 검증합니다. 테스트 DB는 폐기 가능한 DB만 사용합니다. SQL 재생성은 `python scripts/build-global-schema.py`로 합니다.
