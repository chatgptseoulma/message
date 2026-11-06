---
type: concept
tags: [운영]
sources: [src-프로젝트문서, src-소스보안점검결과서, src-테스트시나리오-결과서]
updated: 2026-11-06
---
# 배포와 DB 변경

## 배포
- **명령:** `comfort-letters` 폴더에서 `vercel --prod`를 실행합니다. 프로젝트는 `.vercel/project.json`으로 연결돼 있습니다.
- **빌드와 npm 스크립트:** 없습니다.
- **비밀값 (Vercel production 전용 sensitive 변수):**
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `ADMIN_PASSWORD`
- **로컬 실행:** `vercel dev`나 프리뷰 배포에는 위 값이 없어서 모든 API가 500을 냅니다. 로컬에서는 직접 넣어야 합니다.
- **배포 후 확인:**
  1. `/start`와 `/api/comforters`가 200인지
  2. [[편들어-주는-사람]] 수가 그대로인지 (2026-11-06 기준 16명)

## DB 변경
1. `supabase/migrations/`에 `YYYYMMDDhhmmss_이름.sql`을 추가합니다.
2. 사용자가 `migrate.ps1`을 직접 실행합니다. DB 비밀번호를 묻는 대화형 스크립트이고, `migrate.log`에는 비밀값을 쓰지 않습니다.
   - 또는 `npx supabase db push --remote --yes`로 적용합니다. 이때 `$env:SUPABASE_DB_PASSWORD`가 필요합니다.

**원칙**
- **추가만 합니다.** 기존 행을 바꾸거나 지우지 않습니다. 매번 delete/update/drop이 없는지 확인합니다.
- `20261105000000_responses.sql`(설문 앱 파일)은 **지우지 않습니다.** 마이그레이션 이력이 맞아야 합니다.
- 비밀번호가 틀리면 접속 단계에서 거절돼 아무것도 바뀌지 않습니다. 2026-11-06에 실제로 한 번 있었습니다.

## 테스트
- **자동 회귀 테스트:** `powershell -ExecutionPolicy Bypass -File C:\2026CC\tests\run-all.ps1`
  - 최근 결과: Python 90, Node 416 통과
  - **서버 기능만** 검사합니다.
- **화면:** 실제 주소에서 직접 확인합니다.
  - 테스트 계정은 `검증…` 같은 이름으로 만들고, 끝나면 "내 기록 모두 지우기"로 지웁니다.

관련: [[데이터베이스]], [[src-테스트시나리오-결과서]]
