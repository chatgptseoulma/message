# 퇴근길 빡침 우체통 — LLM Wiki

`comfort-letters` 앱(https://comfort-letters-five.vercel.app)의 지식 베이스입니다.
- 형식: Andrej Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴
- 사람은 자료를 넣고 질문합니다. Claude가 위키를 쓰고 관리합니다.

## 구조
| 위치 | 내용 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | **스키마.** 위키 규칙과 넣기·묻기·점검 작업 흐름 |
| [raw/](raw/) | 원자료 (고치지 않음). 프로젝트 문서, 테스트 결과서, 보안 점검 결과서, 실제 주소 확인 기록 |
| [wiki/index.md](wiki/index.md) | 모든 페이지 목록 (여기서 시작) |
| [wiki/log.md](wiki/log.md) | 작업 기록 |
| [wiki/overview.md](wiki/overview.md) | 전체 그림 |
| `wiki/entities/` `concepts/` `sources/` `analyses/` | 페이지 36쪽 |

## 보는 법
- **Obsidian:** 이 폴더(`comfort-letters-kb`)를 vault로 엽니다.
  - `[[링크]]`를 따라가거나 그래프 보기로 연결을 봅니다.
- **그냥 읽기:** `wiki/index.md`부터 열면 됩니다.

## 쓰는 법 (Claude에게)
Claude Code를 이 폴더에서 열면 `CLAUDE.md`를 자동으로 읽습니다. 다음처럼 말하면 됩니다.

| 하고 싶은 것 | 이렇게 말하기 |
|---|---|
| 자료 넣기 | "`raw/`에 ○○ 넣었어, ingest 해 줘" |
| 질문하기 | "신고하면 바로 가려져?" (좋은 답은 `analyses/`에 남습니다) |
| 점검하기 | "위키 lint 해 줘" |

실제 사용자의 하소연·메시지 내용은 넣지 않습니다.
