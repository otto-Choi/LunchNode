# 한 Supabase DB에서 AX Node / Global 운영

**기존 AX Node Supabase 프로젝트 하나를 사용합니다.** `public.lunch_*`는 AX, `public.global_lunch_*`는 Global 전용 테이블입니다. 서버 함수도 `lunch_*` / `global_lunch_*`로 구분합니다. DB 주소와 service_role 키는 공통이고 초대 코드·운영자 키·세션·신청·편성·작업 기록은 본부별입니다.

## 1. 기존 Supabase SQL Editor에서 한 번 실행

기존 AX 프로젝트 → **SQL Editor → New query**에서 [upgrade-shared-db.sql](supabase/upgrade-shared-db.sql) 전체를 붙여넣고 **Run**을 누릅니다. 이 파일에는 이전 운영자 기능의 선행 업데이트, AX 운영기간 연장, Global 테이블·함수·명단 생성이 모두 포함되어 있습니다. 이미 앞선 AX 업데이트를 적용했어도 실행할 수 있습니다.

계정·PIN·세션·신청·확정 조를 보존하며 재실행해도 운영 시작일과 저장 내역이 초기화되지 않습니다. 함수·트리거·제약조건 교체로 Supabase가 destructive operations 경고를 표시할 수 있습니다. 테이블이나 사용자 데이터를 삭제하는 설치 작업은 포함하지 않습니다. 쿼리 안의 DELETE 문은 로그아웃/만료 세션 정리 등의 서버 함수를 정의하는 부분입니다.

**별도 프로젝트를 만들 필요가 없습니다.** 예전에 안내한 별도 DB용 SQL을 저장해 뒀다면 현재 저장소의 파일로 교체하세요. 이미 별도 Global 프로젝트에 실제 신청을 저장했다면 이 설치는 그 데이터를 자동 이관하지 않으므로 별도 이관 작업이 필요합니다.

GitHub DB 연동이 설정되어 있다면 새 `20261023090100_global_tables.sql` migration이 같은 프로젝트에 적용됩니다. 수동 설치와 CLI 이력은 별개이므로 CLI 사용 시 적용 이력을 확인하세요. 새 프로젝트를 처음 만드는 경우에는 `schema.sql` 전체 또는 순차 migrations를 사용합니다.

## 2. 같은 SQL Editor에서 확인

```sql
select public.lunch_tenant_info() as ax_node,
       public.global_lunch_tenant_info() as global;

select 'AX Node' as headquarters, count(*) as members
from public.lunch_roster
union all
select 'Global', count(*)
from public.global_lunch_roster;

select name, class_name, default_status
from public.global_lunch_roster
order by class_name, name;
```

본부 값은 각각 `ax` / `global`, 인원은 각각 20명이어야 합니다. Global은 IOA 12명 / IPO 8명이며 기본값은 모두 `unset`입니다. 박인홍·백재호·유영채 정정도 포함되어 있습니다.

AX 종료일은 2026-11-30으로 연장됩니다. Global은 설치 시 한국 시각 11시 이전이면 당일 평일, 11시 이후면 다음 평일부터 시작하고 11월 30일까지 운영합니다. 주말 설치 시 다음 월요일이 첫 운영일입니다. 신청은 설치와 연결이 완료되면 바로 받습니다.

## 3. Vercel 환경변수 두 개 추가

기존 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INVITE_CODE`, `ADMIN_SECRET`, `CRON_SECRET`은 그대로 사용합니다. Vercel → Settings → Environment Variables → Production에 다음 두 개를 추가합니다.

| Key | Value |
| --- | --- |
| `GLOBAL_INVITE_CODE` | 직접 정한 Global 전용 초대 코드 |
| `GLOBAL_ADMIN_SECRET` | 직접 정한 32자 이상 Global 전용 운영자 키 |

각각 AX 코드·운영자 키와 다른 값을 사용합니다. **`GLOBAL_SUPABASE_URL`, `GLOBAL_SUPABASE_SERVICE_ROLE_KEY`는 사용하지 않습니다.** 이전 안내에 따라 넣었다면 삭제해도 됩니다. 공통 DB 연결은 기존 AX 연결 설정을 사용합니다. `AX_SUPABASE_URL` / `AX_SUPABASE_SERVICE_ROLE_KEY`를 사용하는 기존 설정도 두 본부의 공통 연결로 지원합니다.

`DEMO_MODE=false`, `APP_ORIGIN=https://lunch-node.vercel.app`을 확인하고 최신 main을 **Redeploy**합니다. 코드를 설정하지 않으면 Global은 준비 중으로 표시됩니다. 비밀값에는 `NEXT_PUBLIC_`를 붙이지 않습니다.

## 4. 오픈 확인

본부 Global 선택 → 초대 코드 확인 → 이름 선택 → 최초 등록 → 참석 저장 → 새로고침 후 유지 여부를 확인합니다. 프로필 메뉴의 본부 변경으로 전환할 수 있습니다. 문의는 공통으로 **AX Node 최철원 · cheolwon.choi@pwc.com**에 연결하며 별도 Global 담당자는 표시하지 않습니다.

운영자 도구는 해당 본부의 키만 허용합니다. 첫날 편성은 전날 22시부터 당일 11시 전까지 가능하며, 이미 편성된 조가 있으면 전체 재편성을 사용합니다. 최초 편성 전이면 운영 첫날 최초 편성을 선택합니다.

자동 편성은 전날 22시, 최종 확정은 당일 11시(한국 시간)입니다. 두 본부의 작업을 독립 실행하고 본부별 성공/실패 상태를 기록합니다. 같은 Supabase 프로젝트의 전체 장애에는 두 본부가 함께 영향을 받습니다. Vercel 요금제의 Cron 실행 제한은 계속 적용됩니다.

Global은 필수 메뉴·인원 조건을 지킨 뒤 최근/누적 만남을 줄이고 IOA·IPO 혼합을 적용합니다. AX는 기존 구성 균형을 사용합니다. 재편성으로 교체된 임시 조는 만남 기록에 포함하지 않습니다. PC는 월별 달력, 모바일은 오늘 이후 운영일을 표시합니다.

검증은 `npm test`, `npm run test:db`, `npm run test:browser`로 합니다. DB 테스트는 폐기 가능한 테스트 DB만 사용합니다. SQL 재생성은 `python scripts/build-global-schema.py`입니다.
