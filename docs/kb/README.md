# docs/kb — 카카오톡 대화 LLM Wiki (Obsidian 볼트)

Andrej Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴으로 만든 지식 베이스입니다.
- 사람은 카카오톡 내보내기 파일을 넣고 질문합니다. Claude가 위키를 쓰고 관리합니다.
- **이 폴더 전체가 Obsidian 볼트 하나입니다.**

## 구성
| 위치 | 역할 |
|---|---|
| `index.md` | 볼트 홈 (Obsidian 북마크 1번) |
| `log.md` | 볼트 전체 작업 기록 |
| `CLAUDE.md` | **스키마.** 규칙과 넣기·묻기·점검 절차 |
| `<방>_KakaoTalk_<날짜>_<시각>/` | 내보내기 파일 하나당 폴더 하나. `raw/` 원자료, `wiki/` 페이지 |
| `_templates/` | Obsidian 템플릿 (entity, concept, source, analysis, log-entry) |
| `_tools/` | 파이썬 도구: `kb_lint.py` 점검, `kb_search.py` 검색, `kakao_stats.py` 카톡 통계 |
| `.claude/commands/` | Claude Code 명령: `/ingest`, `/query`, `/lint` |
| `.obsidian/` | Obsidian 설정: 위키 링크, txt 표시, 템플릿, 그래프 색, 북마크 |

| 위키 | 원본 파일 | 쪽수 |
|---|---|---|
| AI영상방 | `KakaoTalk_20261106_0943_31_784_group.txt` + 요약 md | 36 |
| 아침인사방 | `KakaoTalk_20261106_0929_17_298_group.txt` | 6 |

## Obsidian으로 보기
- **설치:** 설치돼 있습니다 (1.15, `%LOCALAPPDATA%\Programs\Obsidian`). 이 폴더는 `kb`라는 볼트로 등록돼 있습니다.
- **다시 열기:** 시작 메뉴에서 Obsidian을 엽니다. 다른 볼트가 열리면 왼쪽 아래 볼트 전환에서 `kb`를 고릅니다.
- **그래프 (Ctrl+G):** 폴더별로 색이 다릅니다. 파랑은 AI영상방, 주황은 아침인사방, 회색은 자료 요약, 빨강은 홈과 기록입니다.
- **새 페이지:** 만든 뒤 Alt+T로 템플릿을 넣습니다.
- **선택 사항:** Dataview 같은 커뮤니티 플러그인은 설치하지 않았습니다. 필요하면 설정 → 커뮤니티 플러그인에서 직접 켜세요.

## Claude로 관리하기
`C:\2026CC\docs\kb`에서 Claude Code를 열고 다음 명령을 씁니다.

| 하고 싶은 것 | 명령 |
|---|---|
| 새 카톡 파일 넣기 | `/ingest KakaoTalk_….txt` (먼저 `C:\2026CC\카카오톡\`에 저장) |
| 질문하기 | `/query 실사 영상은 어떤 모델이 나아?` |
| 점검하기 | `/lint` |

직접 실행하려면:
```bash
python -I _tools/kb_lint.py .
```
```bash
python -I _tools/kb_search.py . "시댄스 대사"
```
```bash
python -I _tools/kakao_stats.py "C:\2026CC\카카오톡\KakaoTalk_….txt"
```
