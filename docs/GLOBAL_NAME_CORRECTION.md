# Global 명단 정정 · 이윤서 → 이은서

앱 코드 배포 후 Supabase SQL Editor에서 아래 파일 **전체를 한 번** 실행합니다.

[`supabase/migrations/20261024090000_global_name_correction.sql`](../supabase/migrations/20261024090000_global_name_correction.sql)

같은 Supabase 프로젝트의 Global 테이블만 변경합니다. 기존 ID·PIN·로그인 세션·참석 및 메뉴 선택·조 ID·식사 기록은 보존하며 해당 인원의 명단·계정·조 안의 표시 이름을 정정합니다. 기존 조 안의 오타가 바뀐 경우에는 동시 저장 보호를 위해 상태 버전만 1 증가합니다. 원래 철자와 새 철자의 계정이 모두 있는 등 예상과 다른 상태에서는 롤백합니다.

앱은 SQL 적용 전에는 기존 이름으로 계속 동작하고 적용 후에는 이은서로 전환합니다. SQL 실행 후 페이지를 새로고침합니다. 이미 등록한 사람은 **기존 PIN 그대로 이은서**를 선택해 로그인합니다. 새로 등록하거나 계정을 삭제하지 않습니다. 초대 코드와 환경변수 변경은 필요하지 않습니다.

실행 후 확인:

```sql
select r.id, r.name, r.class_name, (u.id is not null) as registered
from public.global_lunch_roster r
left join public.global_lunch_users u on u.id=r.id
where r.name in ('이윤서','이은서');
```

`이은서 / IOA` 한 줄이 나와야 합니다. `registered=false`는 아직 최초 등록을 하지 않았다는 의미입니다.
