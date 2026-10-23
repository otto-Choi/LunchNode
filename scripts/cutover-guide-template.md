# 런치노드 AX / Global 전환 실행서

이 문서는 **최근 안내받은 SQL을 아직 하나도 실행하지 않은 기존 AX 운영 DB**를 기준으로 합니다. Supabase 프로젝트 하나에서 기존 `lunch_*` 데이터는 `ax_lunch_*`로 이름을 바꾸고, Global은 `global_lunch_*`로 생성합니다. 최근 업데이트가 이미 일부 적용되어 있어도 같은 SQL로 처리합니다. SQL 재실행은 기존 계정과 데이터를 유지합니다.

## 전환 후 이름

| 구분 | AX Node | Global |
| --- | --- | --- |
| 테이블·서버 함수 | `ax_lunch_*` | `global_lunch_*` |
| 초대 코드 환경변수 | `AX_INVITE_CODE` | `GLOBAL_INVITE_CODE` |
| 운영자 키 환경변수 | `AX_ADMIN_SECRET` | `GLOBAL_ADMIN_SECRET` |
| 로그인 쿠키 | `ax_lunch_session` | `global_lunch_session` |
| 이름 목록 확인 쿠키 | `ax_lunch_roster` | `global_lunch_roster` |

공통 연결은 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, 예약 작업 인증은 `CRON_SECRET`을 사용합니다. 사용자 ID·PIN 해시·신청·편성·확정 만남 기록은 그대로 유지합니다. 쿠키 이름이 바뀌므로 전환 후 기존 사용자는 **기존 PIN으로 다시 로그인**합니다. 최초 등록을 다시 하지 않습니다. 초대 코드와 운영자 키도 실제 값은 기존 것을 유지할 수 있습니다.

## 1. 배포 버전 확인 및 백업

Vercel Production이 최신 main 버전인지 확인합니다. 이번 앱은 SQL 전환 전에는 기존 `lunch_*`를 사용하고, 전환 후에는 `ax_lunch_*`를 자동으로 사용합니다. DB 장애가 발생했다고 다른 테이블로 전환하지는 않습니다. 구버전 앱을 그대로 사용하는 상태에서 SQL부터 실행하지 않습니다.

Supabase 기존 프로젝트의 백업 또는 별도 DB 덤프를 확보합니다. 새 Supabase 프로젝트는 필요하지 않습니다. Supabase의 GitHub 자동 DB 배포를 켜둔 경우 수동 전환 동안 자동 적용을 일시 중지합니다. 이름 변경 SQL은 자동 migration 폴더에 추가하지 않았으며 아래 절차에서 직접 실행합니다.

## 2. 점검 모드로 전환

Vercel → 프로젝트 → **Settings → Environment Variables**에서 Production의 `MAINTENANCE_MODE`를 `true`로 설정하고, 최신 main을 **Redeploy**합니다. 재배포는 환경변수를 수정한 뒤 수행합니다.

서비스에 접속해 **점검 중** 표시를 확인합니다. `/api/health`는 이때 HTTP 503과 `code: MAINTENANCE`를 반환하는 것이 정상입니다. 로그인·신청 저장·운영자 작업·Cron 모두 DB를 건드리기 전에 차단됩니다. 전날 22시 편성이나 당일 11시 마감 실행 중에는 전환하지 말고 Vercel 로그에서 기존 요청이 끝난 것을 확인합니다.

## 3. 실행 전 현재 상태 확인 — 읽기 전용 SQL

**기존 AX Supabase 프로젝트 → SQL Editor → New query**를 엽니다. 아래 쿼리를 실행하고 결과를 보관합니다.

```sql
select to_regclass('public.lunch_users') as current_ax_users,
       to_regclass('public.ax_lunch_users') as renamed_ax_users,
       to_regclass('public.global_lunch_users') as global_users;

select count(*) as registered_accounts from public.lunch_users;
select id, name, class_name from public.lunch_users order by name;
select id, version, md5(data::text) as state_fingerprint
from public.lunch_state;
```

처음 전환이면 `current_ax_users`가 `lunch_users`, `renamed_ax_users`가 NULL인 것이 정상입니다. 이미 전환을 마친 뒤 문서를 다시 확인하는 경우 위의 `lunch_users`와 `lunch_state`를 `ax_lunch_users`, `ax_lunch_state`로 바꿔 조회합니다.

## 4. 통합 전환 SQL — 아래 코드 블록 전체를 한 번에 실행

새 쿼리를 열고 **아래 SQL 전체**를 복사해 실행합니다. 동일 내용은 저장소의 [`supabase/upgrade-shared-db.sql`](supabase/upgrade-shared-db.sql)에도 있습니다. 이전에 안내받은 SQL을 별도로 먼저 실행할 필요가 없습니다.

한 트랜잭션으로 기존 AX 테이블·인덱스·제약조건·시퀀스·트리거·함수를 이름 변경하고, 이름에 맞는 서버 함수와 누락된 운영자 기능을 갱신한 뒤 Global 명단/테이블을 추가합니다. 어느 단계든 오류가 나면 전체가 롤백됩니다. 기존/변경 후 AX 사용자 테이블이 동시에 존재하면 자동 합치기 대신 오류로 중단합니다.

Supabase가 destructive operations 경고를 보여줄 수 있습니다. 이 SQL에는 이름 변경, 기존 트리거·제약조건 교체, 함수 정의가 포함되어 있습니다. 운영 계정/신청/확정 기록을 삭제하거나 테이블을 초기화하는 설치 명령은 없습니다. 함수 내부의 DELETE는 로그아웃·세션 만료 정리 등을 위한 정의이며 설치 중 실행하는 문장이 아닙니다. 오류가 있으면 다음 단계로 넘어가지 말고 오류 문구와 함께 현재 상태를 확인합니다. 예전 앱을 되돌리는 것만으로 DB 이름 변경까지 되돌아가지는 않습니다.

<!-- CUTOVER_SQL -->

## 5. SQL 실행 결과 확인 — 읽기 전용 SQL

```sql
select public.ax_lunch_tenant_info() as ax_node,
       public.global_lunch_tenant_info() as global;

select 'AX Node' as headquarters, count(*) as roster_count
from public.ax_lunch_roster
union all
select 'Global', count(*) from public.global_lunch_roster;

select count(*) as registered_accounts from public.ax_lunch_users;
select id, name, class_name from public.ax_lunch_users order by name;
select id, version, md5(data::text) as state_fingerprint
from public.ax_lunch_state;

select name, class_name, default_status
from public.global_lunch_roster order by class_name, name;

select to_regclass('public.lunch_users') as old_ax_users,
       to_regclass('public.ax_lunch_users') as new_ax_users;
```

본부 값은 `ax` / `global`, 명단 인원은 각각 20명입니다. AX 등록 계정 수·ID·이름·`version`·`state_fingerprint`는 실행 전과 같아야 합니다. 구 `lunch_users`는 NULL이고 `ax_lunch_users`가 존재해야 합니다.

Global은 IOA 12명 / IPO 8명이고 기본값은 모두 `unset`입니다. 박인홍·백재호·유영채 정정도 포함합니다. AX 종료일은 2026-11-30으로 연장하며 기존 시작일은 유지합니다. Global 첫 시작일은 설치 시 한국 시각 11시 전이면 당일 평일, 이후면 다음 평일이며 종료일은 11월 30일입니다. 재실행해도 Global 시작일이 뒤로 이동하지 않습니다.

## 6. Vercel Production 환경변수 정리

아래는 **이름과 값의 출처**입니다. 설명/예시 문자열을 실제 비밀값 대신 입력하지 않습니다. Vercel에서 Key/Value 칸에 각각 입력합니다.

| Key | 입력할 값 |
| --- | --- |
| `SUPABASE_URL` | 현재 AX가 사용 중인 기존 Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 같은 프로젝트의 기존 service_role 키 |
| `CRON_SECRET` | 기존 예약 작업 인증값 유지 |
| `APP_ORIGIN` | `https://lunch-node.vercel.app` |
| `DEMO_MODE` | `false` |
| `AX_INVITE_CODE` | **기존 `INVITE_CODE`의 실제 값 그대로** 복사 |
| `AX_ADMIN_SECRET` | **기존 `ADMIN_SECRET`의 실제 값 그대로** 복사, 32자 이상 |
| `GLOBAL_INVITE_CODE` | 직접 정한 Global 전용 초대 코드, AX와 다른 값 |
| `GLOBAL_ADMIN_SECRET` | 직접 정한 Global 전용 운영자 키, AX와 다른 32자 이상 값 |
| `MAINTENANCE_MODE` | 검증 후 다시 열 때 `false`로 변경 |

최종 `.env` 형태는 다음과 같습니다. 아래 `<...>`는 자리 표시이므로 그대로 저장하지 않습니다.

```dotenv
SUPABASE_URL=<현재 사용 중인 Supabase URL>
SUPABASE_SERVICE_ROLE_KEY=<기존 service_role 키>
CRON_SECRET=<기존 CRON_SECRET>
APP_ORIGIN=https://lunch-node.vercel.app
DEMO_MODE=false
AX_INVITE_CODE=<기존 초대 코드>
AX_ADMIN_SECRET=<기존 운영자 키>
GLOBAL_INVITE_CODE=<새 Global 초대 코드>
GLOBAL_ADMIN_SECRET=<새 Global 운영자 키>
MAINTENANCE_MODE=false
```

새 이름으로 값을 복사한 것을 확인한 뒤 **구 `INVITE_CODE`, `ADMIN_SECRET`을 삭제**합니다. `AX_SUPABASE_URL`, `AX_SUPABASE_SERVICE_ROLE_KEY`가 있다면 위 공통 `SUPABASE_*`에 값을 옮긴 후 삭제합니다. `GLOBAL_SUPABASE_URL`, `GLOBAL_SUPABASE_SERVICE_ROLE_KEY`도 사용하지 않으므로 삭제합니다. `OPERATION_START`/`OPERATION_END`는 실제 DB 기간을 바꾸지 않으며 데모 전용이므로 Production에서 제거해도 됩니다. `NEXT_PUBLIC_`를 비밀키 앞에 붙이지 않습니다.

## 7. 재배포 후 오픈 확인

`MAINTENANCE_MODE=false`와 최종 변수값을 저장하고 **Redeploy**합니다.

1. `/api/health`가 HTTP 200을 반환하는지 확인합니다.
2. AX Node 선택 → 기존 초대 코드 확인 → 본인 이름 → **로그인** → 기존 PIN을 입력합니다. 기존 신청과 지난 확정 조를 확인합니다.
3. Global 선택 → Global 코드 → 이름 선택 → **최초 등록** → 새 PIN을 만듭니다. 참석을 저장하고 새로고침 후 유지되는지 확인합니다.
4. 각 본부 운영자 도구에서 해당 키로 인증하고 명단/작업 상태를 확인합니다. 다른 본부 키는 인증되지 않아야 합니다.
5. Vercel Cron 설정과 이후 실행 로그를 확인합니다. 일시 중지한 GitHub DB 연동은 CLI 적용 이력과 최종 네임스페이스 정책을 맞춘 뒤 재개합니다. 과거 `lunch_*` migration 전체를 운영 DB에 다시 실행하면 구 테이블을 새로 만들 수 있으므로 수동 전환 후 과거 migration을 재적용하지 않습니다.

편성은 전날 22시, 최종 확정은 당일 11시, 결과 기본 날짜는 당일 13시 이후 다음 운영일로 바뀝니다. Global은 성별·학습반 대신 IOA·IPO 혼합을 적용합니다. 문의는 AX Node 최철원 · cheolwon.choi@pwc.com입니다.

## 생성 파일과 유지보수

`upgrade-shared-db.sql`이 기존 DB 수동 전환용 단일 파일입니다. `schema.sql`은 새 DB용이며 바로 `ax_lunch_*` / `global_lunch_*`를 만듭니다. 기존 DB에 새 설치 파일부터 실행하면 기존 `lunch_*`와 별도 AX 테이블이 생길 수 있으므로 이 문서의 통합 전환 SQL을 사용합니다. `ax-rename.sql`은 생성기에 포함하는 내부 조각이며 단독 실행용이 아닙니다.

전환 후 신규 SQL 변경은 `ax_lunch_*`와 `global_lunch_*`를 대상으로 작성합니다. 과거 migration은 이미 적용된 이력을 보존하기 위해 기존 이름으로 남겨두었습니다. CLI로 새 설치를 할 때도 최종 이름 변경은 별도의 수동 전환 단계를 거치거나 `schema.sql`을 사용합니다. 생성은 `python scripts/build-global-schema.py`로 재현합니다. 테스트는 폐기 가능한 DB에서만 실행합니다.
