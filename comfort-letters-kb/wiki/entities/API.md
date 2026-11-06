---
type: entity
tags: [기술, 서버]
sources: [src-프로젝트문서, code:api/, code:lib/common.js, code:lib/rooms.js]
updated: 2026-11-06
---
# API (Vercel 서버 함수)

`api/*.js` 파일 하나가 경로 하나입니다.
- **공통 코드:** `lib/common.js`, `lib/rooms.js`
- **DB 접근:** service role 키로 [[데이터베이스]]에 접근합니다. RLS를 우회합니다.
- **인증:** Bearer [[열쇠]]
- **응답:** JSON이며 `no-store`, `nosniff`가 붙습니다.
- **사용자 오류:** `{error: "한국어 문구"}`로 돌려줍니다.
- **그 밖의 오류:** 500과 일반 문구로 돌려줍니다.
- **허용 안 된 메서드:** 405를 돌려줍니다.

| 경로 | 메서드 | 하는 일 |
|---|---|---|
| `/api/me` | GET | 내 프로필 `{id, nickname, emoji, comforter}` |
| | POST | 가입. 열쇠 발급, 201. IP당 하루 20개 |
| | PATCH | 닉네임·이모지 변경 |
| | DELETE | 계정 삭제 (연쇄 삭제) |
| `/api/comforters` | GET | 하소연 받기를 켠 [[편들어-주는-사람]] 목록. 공개, 최대 200, 나 제외 |
| | POST | 내 등록 저장 `{intro, active}` |
| `/api/rooms` | GET | 목록 `{comforter, mine, others, hidden}` |
| | POST | 쏟아내기 → `{id, reach}`. 계정당 하루 10개 |
| `/api/room?id=` | GET (`&after=`) | 방 내용. 메시지, `removed`, `readers`, `reactions`, `participants`. **부르기만 해도 읽음 처리** |
| | POST | 답장. 닫혔거나 그만둔 방은 400 |
| | PATCH | `close` · `hide` · `unhide` · `stop` · `resume` |
| `/api/message?id=` | DELETE | [[메시지-회수]] |
| `/api/reactions` | POST | [[공감-반응]] 켜기·끄기 |
| `/api/blocks` | GET / POST / DELETE | [[차단]] 목록 / 차단 / 차단 풀기 |
| `/api/reports` | POST | [[신고]]. 응답 `{ok, blocked}` |
| `/api/admin` | GET / POST | [[관리자-화면]] |

## 공통 규칙
- **볼 권한:** 방에 접근하는 모든 경로는 `loadRoom` → `canView`를 거칩니다. 볼 수 없으면 404입니다. → [[방-볼-권한]]
- **id 검사:** uuid는 정확한 8-4-4-4-12 형식만, 숫자 id는 `^\d{1,15}$`만 받습니다. 그 밖에는 404입니다.
- **글 검사:** 문자열만 받습니다. CRLF를 LF로 바꾸고, 앞뒤 공백을 지운 뒤 길이를 검사합니다.
- **CORS:** 허용 헤더가 없습니다. 그래서 다른 사이트에서 이 API를 호출할 수 없습니다.

관련: [[악용-방지-제한]], [[에러-문구-사전]]
