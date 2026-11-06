# 카카오톡 대화 — LLM Wiki

PC 카카오톡에서 내보낸 단톡방 대화를 Andrej Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 방식으로 정리한 지식 베이스입니다.

| 위치 | 내용 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | **스키마.** 규칙, 넣지 않는 것, 넣기·묻기·점검 흐름 |
| [raw/](raw/) | 원자료 (고치지 않음). 대화 txt 2개와 요약 md 1개 |
| [wiki/index.md](wiki/index.md) | 모든 페이지 목록 (여기서 시작) |
| [wiki/overview.md](wiki/overview.md) | 전체 그림 |
| [wiki/log.md](wiki/log.md) | 작업 기록 |
| `wiki/entities` `concepts` `sources` `analyses` | 페이지 41쪽 |

## 보는 법
- **Obsidian:** 이 폴더를 vault로 엽니다.
- **그냥 읽기:** `wiki/index.md`부터 봅니다.

## 새 대화 넣기
1. 카카오톡 채팅방에서 ≡ → 설정 → **대화 내보내기**를 누릅니다.
2. 만든 txt를 `C:\2026CC\카카오톡\`에 저장합니다.
3. Claude에게 "카카오톡 위키에 새 대화 ingest 해 줘"라고 합니다.

- 질문: "시댄스랑 클링 중에 실사는 뭐가 나아?"
- 점검: "위키 lint 해 줘"
