# 한끼

Next.js + Supabase + Vercel 점심 신청·조 편성 앱입니다.

## 현재 상태

- 20명 명단과 소속, 12월 입사자 기본 불참 규칙을 구현했습니다.
- 실제 Supabase/Vercel 연결은 없습니다. `ui-preview-v6.html`은 예시 데이터로 동작하는 독립형 UI 미리보기입니다.
- DB 적용: `supabase/README.md`를 참고하세요. 새 설치는 `schema.sql`, 기존 설치는 `migrations/20261021_fixed_roster.sql`입니다.
- 핵심 로직·명단·미리보기 7개 테스트가 통과했습니다. 패키지 설치가 완료되지 않아 Next.js 프로덕션 빌드 및 실제 DB 통합 테스트는 아직 실행하지 못했습니다.

## 실행

Node.js 24에서 `npm install` 후 `.env.example`을 `.env.local`로 복사하고 값을 설정한 다음 `npm run dev`로 실행합니다. DB 키는 서버 전용 환경변수입니다. 설정하지 않으면 데모로 열립니다.

`npm test`로 핵심 테스트를 실행하고, `npm run preview:build`로 의존성 설치 없이 미리보기 HTML을 생성합니다.

## 운영

시간대는 Asia/Seoul입니다. 운영 기간은 OPERATION_START/OPERATION_END에 설정합니다. INVITE_CODE는 최초 등록용, CRON_SECRET은 Vercel Cron 인증용입니다. 이름은 목록 선택만 가능하며 소속은 고정입니다. 12월 입사자도 본인 신청으로 참여할 수 있습니다.

Vercel 예약 작업은 UTC 13시(한국 전날 22시), UTC 02시(한국 당일 11시)입니다. 이용 요금제의 예약 작업 수·실행 시각 제한을 배포 전에 확인해야 합니다. 지연 시 서버의 상태 읽기/변경 요청도 누락된 편성·확정을 보완하고 서버 시각으로 마감 이후 변경을 차단합니다.

현재 기본 운영 기간은 **2026-10-22 ~ 2026-11-03 (평일 9일)**입니다. 기본 기간은 `lib/operation.ts` 한 곳에서 관리합니다.

파일 미리보기 화면은 스크립트를 차단할 수 있습니다. 동작 확인용 `hankki-demo.zip`을 내려받아 압축을 풀고 `index.html`을 Chrome/Safari/Edge에서 직접 열어 주세요. 화면에 스크립트 미실행 안내가 표시되면 앱이 실행되지 않은 상태입니다. 미리보기 데이터는 브라우저 로컬에만 저장됩니다.
