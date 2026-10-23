# Supabase 설정

프로젝트 하나에서 `public.ax_lunch_*`와 `public.global_lunch_*`를 사용합니다.

기존 운영 DB는 [통합 전환 실행서](../CUTOVER_GUIDE.md)를 따릅니다. `upgrade-shared-db.sql` 한 번으로 기존 AX 테이블의 이름을 바꾸고 필요한 기능과 Global 테이블을 추가합니다. 함수·시퀀스·인덱스·제약조건·트리거도 함께 이름을 맞춥니다. 사용자 ID·PIN·세션·신청·확정 기록은 보존합니다.

신규 빈 DB만 `schema.sql`을 사용합니다. `ax-schema.sql`은 이름을 맞춘 AX 정의, `global-schema.sql`은 Global 정의입니다. 기존 `lunch_*`가 있는 DB에 `ax-schema.sql`부터 실행하지 않습니다. `ax-rename.sql`은 생성기 내부 조각이며 단독 실행 파일이 아닙니다.

과거 migration은 이미 적용된 배포 이력을 보존하기 위해 이전 이름을 유지합니다. 이름 변경은 자동 migration에 넣지 않았습니다. 수동 전환 뒤 과거 migration을 재실행하지 않으며, 이후 변경은 최종 접두사를 기준으로 작성합니다. 전체 신규 DB에는 `schema.sql`을 권장합니다.

서버는 같은 서비스 키로 본부별 RPC를 호출합니다. 브라우저 역할에는 테이블·함수 접근을 부여하지 않습니다. PIN은 scrypt 해시, 세션은 토큰 SHA-256으로 저장합니다. 각 본부 함수는 DB 잠금 후 마감 시각을 검사하고 확정된 조의 변경을 차단합니다.
