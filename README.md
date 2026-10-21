# LunchNode · 런치노드

20명 전용 점심 신청·조 편성 앱입니다. Next.js 15 / React 19, Supabase PostgreSQL, Vercel을 사용합니다.

## 실행

Node.js 24를 사용합니다.

```sh
npm install
cp .env.example .env.local
npm run dev
```

실제 운영 모드는 `DEMO_MODE=false`입니다. Supabase 키가 없으면 연결 오류를 보여주며 데모로 자동 전환하지 않습니다. UI만 보려면 `DEMO_MODE=true`를 명시합니다. `browser-demo/index.html`과 과거 HTML은 별도의 브라우저 로컬 체험 파일이며 실제 DB를 사용하지 않습니다.

## Supabase / Vercel 설정

1. `supabase/README.md`를 따라 DB를 만듭니다. 새 DB는 `supabase/schema.sql` 전체 실행 또는 GitHub 통합의 순차 마이그레이션 중 하나를 선택합니다.
2. Vercel에서 저장소 루트 `./`, Next.js, Node.js 24를 선택합니다. 빌드/설치 명령은 기본값입니다.
3. 서버 환경변수 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INVITE_CODE`, `CRON_SECRET`, `DEMO_MODE=false`를 설정합니다. 비밀값에 NEXT_PUBLIC_ 접두사를 붙이지 않습니다.
4. `APP_ORIGIN`은 선택입니다. 지정한다면 배포 주소의 origin(예: https://lunchnode.example.com)을 넣습니다. 비우면 요청 URL의 origin과 비교합니다.
5. 배포 후 `/api/health`가 200과 `{ "ok": true }`를 반환하는지 확인하고, 알려진 참가자 이름으로 최초 등록합니다. 초대 코드는 초대받은 사용자에게 운영자가 전달합니다.

운영 날짜의 기준은 DB `lunch_settings`입니다. 최초 기간은 **2026-10-22 ~ 2026-11-03, 평일 9일**입니다. 로컬 데모 날짜는 `lib/operation.ts`로 별도 관리합니다.

## API

| 경로 | 메서드 | 용도 |
|---|---|---|
| `/api/auth` | GET | 현재 로그인 사용자 또는 null |
| `/api/auth` | POST | action=register/login/logout |
| `/api/state` | GET | 전체 일정·조·본인 신청; 로그인 필요 |
| `/api/state` | POST | dates 배열 + choice(status,meal); 본인 신청만 변경 |
| `/api/profile` | POST | currentPin/newPin으로 PIN 변경 및 전체 세션 폐기 |
| `/api/cron` | GET | Bearer CRON_SECRET으로 누락 편성·확정 처리 |
| `/api/health` | GET | 비밀값을 노출하지 않는 DB/스키마 상태 확인 |

POST는 같은 origin의 JSON만 받습니다. 미인증은 401, 잘못된 입력은 400, 다른 origin은 403, 마감·충돌은 409, 과도한 로그인은 429, DB 연결/설정 오류는 503입니다. 응답은 캐시하지 않습니다. 쿠키는 운영 환경에서 Secure·HttpOnly·SameSite=Lax이며 최대 21일입니다.

자동 편성은 전날 22시, 최종 확정은 당일 11시(Asia/Seoul)입니다. `vercel.json`의 UTC 예약 작업 두 개가 이를 실행합니다. 장애 복구를 위해 일반 상태 읽기/쓰기 요청도 누락된 작업을 보완합니다. cron이 여러 번 실행돼도 기존 조를 다시 섞지 않습니다. 늦은 최초 실행은 당시 저장된 신청으로 복구하므로 정상 시각 실행과 완전히 같은 결과를 보장하지 않습니다.

## 검증

```sh
npm test
npm run typecheck
npm run build
```

GitHub Actions는 폐기 가능한 PostgreSQL 17에서 실제 SQL과 RPC를 실행한 뒤 Next.js 빌드 및 데스크톱/모바일 Chromium 테스트를 수행합니다. 브라우저 테스트의 HTTP 전송 어댑터는 PostgREST 규약을 흉내 내지만, 인증·저장 로직과 SQL은 실제 앱/DB 코드를 사용합니다. 실제 Supabase PostgREST 및 Vercel 예약 실행은 배포 후 추가 확인이 필요합니다.

DB 통합 테스트는 **스키마를 삭제합니다**. 테스트 전용 DB에서만 `DATABASE_URL`과 `ALLOW_DATABASE_RESET=1`을 설정하고 `npm run test:db`를 실행합니다. 운영 DB URL을 사용하지 않습니다.

`npm run preview:build`는 별도의 HTML 체험 파일을 재생성합니다. 과거 `ui-preview-v*.html`은 이전 작업 보존용이며 운영 앱은 `/app`, `/lib`, `/components`입니다.


## 확인된 검증 결과

[GitHub Actions](https://github.com/otto-Choi/LunchNode/actions/runs/39586447958)에서 타입 검사, 규칙/서버 21개, 실제 PostgreSQL 6개, 프로덕션 빌드, 데스크톱/모바일 브라우저 2개가 통과했습니다. 상세 상태는 `전달상태.txt`에 있습니다.

실제 연결 완료 순서는 다음과 같습니다.

1. Supabase SQL Editor에서 현재 `supabase/schema.sql` 전체를 실행합니다. GitHub 통합으로 순차 마이그레이션을 적용했다면 중복 실행할 필요는 없습니다.
2. Vercel Production에 `.env.example`의 서버용 변수를 설정하고 `DEMO_MODE=false`로 둡니다.
3. Vercel에서 최신 main을 Redeploy합니다.
4. 실제 배포 주소 뒤에 `/api/health`를 붙여 `{ "ok": true }`를 확인합니다.
5. 첫 화면에서 본인 이름을 선택하고 공통 초대 코드와 PIN으로 등록합니다. 참석·불참을 변경한 뒤 새로고침하여 저장을 확인합니다.
6. Vercel의 Cron Jobs에서 등록된 두 예약 작업과 실행 로그를 확인합니다. 자동 DB 배포를 켜려면 Supabase의 migration 이력을 먼저 맞춥니다.


## 메뉴 선택

메뉴는 도시락만(`lunchbox`), 도시락선호(`prefer_lunchbox`), 상관없음(`any`), 외식선호(`prefer_outside`), 외식만(`outside`) 순서입니다. 기본값은 `any`이며 개별·여러 날짜 신청에 동일하게 적용합니다. 기존 `lunchbox`/`outside` 값은 원래의 엄격한 조건으로 유지하므로 데이터 변환이나 추가 SQL이 필요 없습니다.

최초 편성은 엄격한 조건을 반드시 지키고, 1~2명 소수 조를 줄인 다음 선호 위반, 5명 조, 과거 반복 순으로 줄입니다. 추가 참여는 기존 조를 유지하며 소수 인원 조 충원, 선호, 인원수, 과거 만남 순으로 빈자리를 고릅니다. 선호에 맞는 자리가 없으면 다른 식사 방식에도 합류할 수 있습니다. 결과 조의 실제 식사 방식은 도시락/외식 두 가지입니다.


### 운영자 복구 도구

Vercel 환경변수에 초대 코드·CRON_SECRET과 다른 32자 이상 무작위 `ADMIN_SECRET`을 추가하고 재배포합니다. Supabase에는 `supabase/migrations/20261021090300_admin_tools.sql`을 SQL Editor에서 실행하거나 GitHub 마이그레이션으로 적용합니다. 신규 DB는 최신 `supabase/schema.sql` 전체를 적용하면 됩니다.

로그인 후 오른쪽 위 사용자 메뉴 → 운영자 도구 → 운영자 키 인증으로 이용합니다. 키는 브라우저 저장소에 저장하지 않습니다. PIN 재설정과 전체 세션 종료는 하나의 DB 트랜잭션이며, 사용자 신청과 확정 기록은 유지합니다. 복구는 누락된 최초 편성과 최종 마감만 처리하며 이미 편성된 조를 다시 섞지 않습니다. 작업자·대상·시간·작업 종류는 `lunch_admin_events`에 기록하며 PIN이나 키는 기록하지 않습니다. 운영자 키 보유자는 모든 계정 복구 권한을 가지므로 운영자에게만 전달합니다.

모바일 일정에는 한국 시간 기준 오늘 이후 날짜만 표시하며, PC에는 전체 날짜를 표시하고 지난 날짜는 회색으로 표시합니다. 지난 매칭 기록 탭에서는 모바일에서도 확정 기록을 조회할 수 있습니다.


### 반복 만남 최소화

최초 편성은 도시락만·외식만과 최대 5명 제한을 지킵니다. 우선 1~2명 조를 최소화하고, 가장 최근의 재회를 피하는 것을 우선합니다. 재회가 불가피하면 마지막 만남이 더 오래전인 조합을 선택하고, 동률이면 누적 만남 횟수 → 메뉴 선호 → 5명 조 수를 줄입니다. 최근 만남의 중요도가 오래전 만남 여러 건에 묻히지 않도록 날짜별 비용을 정수로 구분합니다. 이전 날짜의 최종 확정 기록만 참고합니다.

160개 초기 후보로 시작하여 가능한 1~5명 조를 열거하고 분기 한정 탐색과 메모이제이션으로 조합을 개선합니다. 서버 응답을 위해 최대 20,000개 탐색 노드 또는 500,000개 후보 검사로 제한하며, 전체 조합의 수학적 최적해를 항상 보장하지는 않습니다. 최대 20명의 고정 명단을 전제로 합니다.

추가 참석도 최근 재회 → 누적 만남 횟수 → 소수 조 충원 → 메뉴 선호 → 적은 인원 순으로 기존 빈자리를 선택합니다. 엄격한 메뉴 선택은 항상 지키고, 기존 조원과 확정 기록은 재편성하지 않습니다.

서비스 로고와 브라우저 탭 아이콘은 첨부된 주황색 노드 디자인을 SVG로 재현한 `public/lunchnode.svg`, `app/icon.svg`를 사용합니다.
