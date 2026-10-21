# DB 생성 및 업데이트

Supabase 키를 Vercel의 서버 환경변수에만 저장합니다. 브라우저는 DB에 직접 접근하지 않습니다.

## 새 DB: 아래 둘 중 한 가지만 사용

1. 수동: Supabase SQL Editor에서 `supabase/schema.sql` 전체를 한 번 실행합니다.
2. GitHub 통합 또는 CLI: `supabase/migrations/`의 14자리 번호 순서대로 실행합니다. `config.toml`이 포함되어 있습니다.

스키마 SQL과 마이그레이션을 새 DB에 중복 적용할 필요는 없습니다. 기존 DB에서도 새 마이그레이션은 계정·PIN·기록을 삭제하지 않습니다. 허용 명단 밖 계정이 있다면 해당 마이그레이션이 중단됩니다. 데이터를 확인한 뒤 처리해야 하며 자동 삭제하지 않습니다.

## 기존 초안 DB

번호가 다른 세 마이그레이션을 순서대로 적용하거나, 현재 `schema.sql`을 실행할 수 있습니다. 이전 파일 `20261021_fixed_roster.sql`은 같은 날짜 접두사가 중복되는 문제가 있어 새 14자리 마이그레이션으로 교체했습니다. 이미 Supabase CLI로 이전 버전을 배포했다면 `supabase migration list`로 기록을 먼저 확인하고, 수동 적용한 스키마의 이력을 `supabase migration repair`로 맞추세요. 데이터가 있는 DB에서 reset을 실행하지 않습니다.

## 운영 기간

`lunch_settings`가 DB 기준 운영 기간입니다. 초기값은 2026-10-22 ~ 2026-11-03입니다. Vercel의 OPERATION_START/END만 바꾸어도 운영 DB가 바뀌지는 않습니다. 기간은 다음처럼 변경합니다.

```sql
update public.lunch_settings
set start_date='2026-10-22',end_date='2026-11-03'
where id=1;
```

20명은 `lunch_roster`에 저장합니다. 12월 입사자 3명은 기본 불참이며 명시적 참석으로 변경할 수 있습니다. 미등록자도 명단과 기본 신청에 포함되지만 PIN은 최초 등록 때 생성됩니다. 이름과 소속은 직접 수정할 수 없습니다.

## 트랜잭션 및 권한

등록+세션 생성, PIN 변경+모든 세션 폐기, 버전 비교+신청 저장은 각각 DB 함수 안에서 원자적으로 실행합니다. 서버에서 본 마감 전 시각과 무관하게 DB가 잠금을 얻은 뒤 한국 시각 11시 마감을 재확인합니다. 이미 확정된 조 스냅샷은 cron도 덮어쓸 수 없습니다.

anon/authenticated는 테이블과 RPC에 접근할 수 없으며 service_role도 지정된 서버 전용 RPC만 실행합니다. PIN은 salted scrypt 해시, 세션은 토큰의 SHA-256만 저장합니다. 실제 토큰은 HttpOnly 쿠키로 전송합니다.

운영자 도구 추가 시 `migrations/20261021090300_admin_tools.sql`을 적용하고 Vercel에 별도 32자 이상 `ADMIN_SECRET`을 설정합니다. 자세한 이용법은 루트 README를 참고하세요.
