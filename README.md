# Lunch Node · Group Node

모바일과 PC에서 점심 신청·조 편성과 동기 소모임을 함께 이용하는 Next.js 앱입니다.

[Group Node 기능·구조·DB 설치·QA](docs/GROUP_NODE.md)와 [1회성 모임·소모임 구분](docs/PERSISTENT_CLUBS.md)을 참고하세요. 기존 Lunch Node는 주황색, Group Node는 하늘색으로 구분하며 같은 계정으로 전환합니다.

- 서비스: https://lunch-node.vercel.app/
- 본부: **AX Node**, **Global**, **TMT**. 본부 선택 → 초대 코드 확인 → 이름 선택 → 숫자 6자리 PIN으로 등록·로그인합니다.
- 하나의 Supabase 프로젝트 안에서 `ax_lunch_*`, `global_lunch_*`, `tmt_lunch_*` 테이블·RPC·세션·초대 코드·운영자 키를 분리합니다.
- 운영 기간은 각 본부의 DB 설정을 따릅니다. AX Node·Global·TMT 모두 **종료일 없이** 운영하며 운영일은 평일입니다. 이번 달과 다음 두 달의 신청 일정이 자동으로 열립니다. 모든 운영 시각은 **한국 시간**입니다.

## 개발

Node.js 24가 필요합니다. 의존성 버전은 `package-lock.json`으로 고정하며 설치는 `npm ci`를 사용합니다.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

`.env.local`에 실제 서버 설정을 입력합니다. 화면만 살펴볼 때는 `DEMO_MODE=true`를 사용합니다. 체험 모드는 브라우저에 예시 데이터를 저장하며 실제 DB를 사용하지 않습니다. 초기 시안 HTML과 ZIP은 Git 이력에 보관하고 현재 소스에서는 제거했습니다.

```sh
npm run typecheck
npm test
npm run build
```

## 구조

| 경로 | 역할 |
| --- | --- |
| `app/` | Next.js 페이지·스타일·브라우저 아이콘·API 진입점 |
| `components/lunch-app.tsx` | 일정, 조 편성 결과, 과거 기록, 인증, 운영자 화면 |
| `lib/domain.ts` | 참석·취소·최초 편성·추가 참여·재편성·확정 로직 |
| `lib/backend/` | 인증, 본부 분리, RPC, 운영자 권한, 서버 설정 |
| `lib/client/` | 브라우저 API 요청과 탭별 본부 선택 |
| `lib/roster.ts`, `lib/backend/{global,tmt}-roster.ts` | 본부별 고정 명단 |
| `public/` | 서비스 로고 |
| `supabase/` | 설치·전환 SQL과 기존 마이그레이션 이력 |
| `scripts/` | SQL 및 전환 문서 생성 스크립트 |
| `tests/` | 도메인·인증·분리 테스트, PostgreSQL 통합 테스트 |
| `tests/browser/` | PC·모바일 브라우저 QA |
| `docs/` | 코드리뷰와 QA 범위 기록 |

관리자 계정과 권한 범위는 [관리자 계정 안내](docs/ADMINISTRATOR_ACCOUNTS.md)를 참고하세요.

## 운영 설정

환경변수 목록은 [.env.example](.env.example)을 기준으로 합니다. 비밀값은 Git에 저장하지 않습니다. `SUPABASE_SERVICE_ROLE_KEY`, 초대 코드와 운영자 키를 `NEXT_PUBLIC_*` 변수로 만들면 안 됩니다.

| 변수 | 값·용도 |
| --- | --- |
| `SUPABASE_URL` | 공통 Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 공통 서버 전용 서비스 키 |
| `AX_INVITE_CODE`, `GLOBAL_INVITE_CODE`, `TMT_INVITE_CODE` | 서로 다른 본부 초대 코드 |
| `AX_ADMIN_SECRET`, `GLOBAL_ADMIN_SECRET`, `TMT_ADMIN_SECRET` | 서로 다른 32자 이상의 운영자 키 |
| `CRON_SECRET` | Vercel 예약 작업 인증 키 |
| `APP_ORIGIN` | `https://lunch-node.vercel.app` |
| `DEMO_MODE` | 운영에서는 `false` |
| `MAINTENANCE_MODE` | 정상 운영 `false`, 점검 시 `true` |
| `OPERATION_START`, `OPERATION_END` | 이전 설정 변수이며 현재 사용하지 않음. 삭제 가능. 운영 날짜는 DB, 데모는 `lib/operation.ts`에서 관리 |

Vercel의 Root Directory는 저장소 루트, Framework Preset은 Next.js로 설정합니다. 빌드와 출력 경로는 기본값을 사용합니다. 환경변수 변경 후에는 재배포해야 반영됩니다.

### DB 설치와 이력

**이미 전환한 운영 DB에 신규 설치 SQL을 다시 실행할 필요가 없습니다.** 현재 운영 데이터에 대한 임의 초기화나 테스트 실행은 금지합니다.

| 파일 | 대상 |
| --- | --- |
| `supabase/migrations/20261026124241_group_node.sql` | AX·Global 설치 후 Group Node 추가 |
| `supabase/migrations/20261027141019_tmt_headquarters.sql` | TMT 18명과 Group Node 본부 연동 추가 |
| `supabase/migrations/20261027143019_continuous_operation.sql` | AX·Global·TMT 종료일 제거 및 연속 운영 적용 |
| `supabase/migrations/20261027144612_persistent_clubs.sql` | 지속형 소모임·기존 모임 전환·모임장 참여자 추가 |
| `supabase/migrations/20261027151113_headquarters_administrators.sql` | 본부별 관리자 계정·통합 모임 관리 권한 |
| `supabase/migrations/20261027154741_four_person_strict_meals.sql` | 필수 메뉴 우선·일반 조 최대 4명·도시락만 전원 조 최대 5명 |
| `supabase/schema.sql` | 비어 있는 프로젝트에 AX·Global 신규 설치 |
| `supabase/global-schema.sql` | AX만 있는 기존 프로젝트에 Global 추가 |
| `supabase/upgrade-shared-db.sql` | 기존 `lunch_*` 구조에서 AX 이름 변경 및 Global 추가. 재실행 지원 |
| `supabase/upgrade-before-cutover.sql` | 기존 `lunch_*`만 있는 전환 전 상태를 검사하는 1회용 전환 SQL |
| `supabase/ax-rename.sql` | 설치기가 사용하는 내부 이름 변경 조각. 단독 실행용 아님 |
| `supabase/migrations/` | 이미 배포된 변경 이력. 적용된 파일을 수정하거나 현재 운영 DB에 처음부터 재적용하지 않음 |

전환 절차·조회 쿼리·환경변수 이름 변경은 [통합 전환 실행서](CUTOVER_GUIDE.md)를 참고합니다. 이 문서는 **전환 전 DB를 위한 절차**입니다. 현재 `ax_lunch_users`와 `global_lunch_users`가 모두 있는 서비스는 전환 완료 상태입니다.

SQL 생성기는 다음과 같습니다. 파일을 재생성하는 명령이며 DB에 접속하지 않습니다.

```sh
python scripts/build-global-schema.py
python scripts/build-before-cutover.py
```

생성 결과는 검토하고 통합 테스트를 통과한 뒤 반영합니다. 새로운 DB 변경은 별도 마이그레이션으로 추가합니다.

### 편성 및 예약 작업

- **전날 22:00** 최초 편성, **당일 11:00** 최종 확정. 11시 이후 수정은 DB에서도 차단합니다.
- 2026-10-29 식사분부터 도시락만 신청자는 인원 제한 없는 하나의 도시락 묶음에 표시합니다. 나머지 참석자는 최대 4명씩 편성합니다. 기존 조는 유지합니다. [도시락 묶음 규칙](docs/LUNCHBOX_POOL.md)을 참고하세요.
- 일반 조에서는 외식만 조건을 지키고 같은 필수 메뉴 신청자끼리 묶으며 반대 선호 혼합을 피하는 기준을 만남 이력보다 먼저 적용합니다. 인원이 맞지 않으면 1~2인 조도 허용해 참석자를 모두 배정합니다.
- 같은 인원 구성에서는 최근 재회를 피하고, 누적 만남 횟수를 고려합니다. AX는 그다음 성비·반 혼합, Global은 IOA·IPO 혼합을 고려합니다. 부드러운 메뉴 선호는 필수 메뉴와 다르게 상황에 따라 바뀔 수 있습니다.
- 일반 추가 참여·취소는 기존 조원의 배정을 유지합니다. 운영자 전체 재편성은 당일 11시 전, 최초 편성 후 가능합니다.
- 최종 확정된 과거 일반 조만 만남 기록에 사용합니다. 교체된 임시 조와 도시락 묶음은 누적하지 않습니다.
- 참석 인원·메뉴 조건과 제한된 탐색량 때문에 모든 경우의 최적 조합을 보장하지는 않습니다. 참석자는 모두 배정합니다.
- PC 월 달력은 일요일부터 시작하며 토·일은 내용 없는 좁은 칸으로 표시합니다. 날짜 카드 높이를 줄이고, 모바일은 앞으로의 날짜와 44px 참석·불참 버튼을 유지합니다.
- 조 결과의 기본 날짜는 당일 **13:00**에 다음 운영일로 바뀝니다.

`vercel.json`은 UTC 기준 13:00(일~목), 02:00(월~금)에 `/api/cron`을 호출합니다. Vercel이 `Authorization: Bearer <CRON_SECRET>`을 전송해야 합니다. 실제 작업은 각 본부의 운영일·시각을 다시 검사합니다. 예약 작업이 늦거나 누락되면 상태 조회와 운영자 복구에서도 지난 작업을 보완합니다. 예약 호출의 정확한 실행 시각과 플랫폼 이용 조건은 Vercel 운영 환경에서 확인해야 합니다.

## QA

DEAL 본부는 명단 수신 전 준비 단계이며 가입·자동 편성을 열지 않습니다. [DEAL 준비 및 개방 절차](docs/DEAL_SETUP.md)를 참고하세요.

GitHub Actions의 `Verify backend and application`이 타입 검사 → 단위 테스트 → PostgreSQL 17 통합 테스트 → 프로덕션 빌드 → PC·모바일 Chromium 브라우저 테스트를 실행합니다. 실행 기록과 실패 시 trace는 [Actions](https://github.com/otto-Choi/LunchNode/actions)에서 확인할 수 있습니다.

DB·브라우저 테스트는 **삭제해도 되는 전용 DB**에서만 실행합니다. `ALLOW_DATABASE_RESET=1`은 해당 DB 초기화를 허용하는 명시적 스위치입니다.

```sh
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/lunch_test ALLOW_DATABASE_RESET=1 npm run test:db
npm run build
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/lunch_test ALLOW_DATABASE_RESET=1 PLAYWRIGHT_CHANNEL=chrome npm run test:browser
```

브라우저 테스트는 포트 3000과 54329를 사용합니다. Chrome이 없다면 `npx playwright install chromium`으로 설치하고 `PLAYWRIGHT_CHANNEL`을 생략합니다. 모바일 테스트는 iPhone 크기의 Chromium 에뮬레이션이며 실제 Safari 기기 검증을 대체하지 않습니다.

[코드리뷰·QA 기록](docs/REVIEW_QA.md)

연속 운영 설정은 [docs/CONTINUOUS_OPERATION.md](docs/CONTINUOUS_OPERATION.md), 전체 코드 리뷰와 QA 범위는 [docs/CODE_REVIEW_QA.md](docs/CODE_REVIEW_QA.md)를 참고하세요.

편성 기준과 예외는 [필수 메뉴·인원 제한 안내](docs/FOUR_PERSON_MATCHING.md)를 참고하세요.

비어 있는 DB 신규 설치 순서는 `schema.sql` → Group Node → TMT → 연속 운영 → 지속형 소모임 → 관리자 계정 → 필수 메뉴·인원 제한 → 도시락 묶음입니다.
현재 운영 DB에는 적용된 마이그레이션을 다시 실행하지 않습니다.
