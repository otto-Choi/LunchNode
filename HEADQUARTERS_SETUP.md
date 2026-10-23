# AX Node / Global 설정

최종 구조와 실행 순서는 **[통합 전환 실행서](CUTOVER_GUIDE.md)**를 따릅니다. 이전 안내 SQL을 아직 실행하지 않은 기존 운영 DB도 통합 쿼리 한 번으로 처리합니다.

같은 Supabase 프로젝트에서 AX는 `ax_lunch_*`, Global은 `global_lunch_*` 테이블과 함수를 사용합니다. 공통 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`을 유지하고 초대 코드·운영자 키는 `AX_` / `GLOBAL_`로 구분합니다. 점검 모드 전환, 읽기 전용 사전 확인 쿼리, 전체 전환 SQL, 실행 후 확인 쿼리, 환경변수 이름 변경·삭제 및 재오픈 순서가 한 문서에 모두 들어 있습니다.

코드 배포만으로 운영 DB 이름은 바뀌지 않습니다. SQL 실행 전에는 기존 이름으로 서비스하고, 전환이 완료되면 새 이름을 자동으로 사용합니다. DB 전환은 실행서에 따라 점검 모드에서 수행합니다.
