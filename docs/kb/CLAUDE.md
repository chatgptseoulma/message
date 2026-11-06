# CLAUDE.md — docs/kb LLM Wiki 스키마

이 폴더는 Andrej Karpathy의 **LLM Wiki** 패턴을 구현한 지식 베이스이자 **Obsidian 볼트**입니다.
- 원문: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f (2026-04-04)
- 사람은 자료(카카오톡 내보내기)를 넣고 질문합니다. Claude는 위키를 쓰고, 고치고, 점검합니다.
- **역할 비유:** Obsidian은 IDE, Claude는 프로그래머, 위키는 코드베이스입니다.

## 세 층
| 층 | 위치 | 누가 | 규칙 |
|---|---|---|---|
| 원자료 | `<폴더>/raw/` | 사람이 넣음 | **고치지 않습니다.** 내보낸 txt와 그 파일의 요약을 둡니다. |
| 위키 | `<폴더>/wiki/` | Claude | 페이지를 만들고 고칩니다. |
| 스키마 | 이 파일 | 함께 | 규칙이 바뀌면 여기를 고칩니다. |

## 볼트 구조
```
docs/kb/                      ← Obsidian 볼트 루트
  index.md                    볼트 홈: 파일별 위키 표, 자주 찾는 페이지
  log.md                      볼트 전체 작업 기록 (추가만)
  CLAUDE.md                   이 스키마
  README.md                   사람용 안내
  _templates/                 Obsidian 템플릿 (entity, concept, source, analysis, query-log)
  _tools/                     파이썬 도구 (표준 라이브러리만)
  .claude/commands/           Claude Code 명령: /ingest /query /lint
  .obsidian/                  Obsidian 설정
  <방>_KakaoTalk_<YYYYMMDD>_<HHMM>/   내보내기 파일 하나당 폴더 하나
    raw/                      원자료
    wiki/
      <방>-개요.md            이 파일의 전체 그림
      <방>-목차.md            이 폴더의 모든 페이지 목록 (index 역할)
      <방>-기록.md            이 폴더의 작업 기록 (log 역할)
      entities/  concepts/  sources/  analyses/
```
- **원본 위치:** 내보내기 원본은 `C:\2026CC\카카오톡\`에 있습니다. 거기서 `raw/`로 복사합니다.
- **이름 규칙:** 볼트 전체에서 **페이지 이름이 겹치면 안 됩니다.** 위키 링크가 이름으로 찾기 때문입니다.
  - 그래서 개요·목차·기록 페이지에는 방 이름을 붙입니다.
  - 새 페이지를 만들기 전에 `python -I _tools/kb_lint.py .`로 겹침을 확인합니다.
- **같은 도구가 여러 파일에 나오면:**
  - 기존 페이지(예: [[시댄스]])에 "○○ 파일 기준" 단락을 추가합니다.
  - 페이지를 새로 만들어야 하면 `시댄스-아침인사방`처럼 이름을 다르게 합니다.

## 페이지 규칙
- **링크:** `[[페이지]]`, `[[페이지|보이는 글]]`
  - **표 안에서는** `[[페이지\|보이는 글]]`처럼 `|`를 escape합니다.
- **머리 정보 (Obsidian Properties):**
  ```yaml
  ---
  type: entity | concept | source | analysis | overview
  tags: [도구, 영상모델]          # 공백 없는 낱말
  rooms: [AI영상방]
  sources: [src-AI영상방-대화 L41-99]
  updated: YYYY-MM-DD
  ---
  ```
- **본문 순서:** 한 줄 정의 → 사실(표·목록, 줄 번호 `L1234`) → 관련 페이지
- **믿는 순서:** 원문 대화 > 사람이 만든 요약. 가격·한도·버전은 "○월 대화 기준"이라고 적습니다.
- **추정:** "(불확실)"로 표시합니다. 회원 의견은 검증하지 않았다는 점을 밝힙니다.

## 넣지 않는 것
- 전화번호, 이메일, 실명, 주소, 계좌, 닉네임에 붙은 지역
- AI 안전장치·검열 우회, 여러 계정으로 약관을 어기며 할인을 받는 방법, 저작권 필터 회피
- 선정적인 내용, 다툼에서 누구를 탓하는 서술, 노래 가사, 남의 글 전문 (인용은 15자 안팎으로 짧게)

## 작업 흐름

### 넣기 (ingest) — `/ingest <파일>`
1. `C:\2026CC\카카오톡\`의 새 txt를 `<방>_KakaoTalk_<날짜>_<시각>/raw/`로 복사합니다.
2. `python -I _tools/kakao_stats.py <txt>`로 기간, 날짜 경계 줄, 메시지 수, 많이 말한 사람을 뽑습니다.
3. 날짜 경계로 나눠 읽습니다. 2천 줄이 넘으면 기간별로 나눠 병렬로 읽습니다.
4. `sources/src-…`, `entities/`, `concepts/`, `analyses/` 페이지를 만들거나 고칩니다. 템플릿은 `_templates/`에 있습니다.
5. `<방>-목차`, `<방>-기록`, 볼트 [[index]]의 표, [[log]]를 고칩니다.
6. `_tools/kb_lint.py`로 점검합니다.

### 묻기 (query) — `/query <질문>`
1. [[index]] → 해당 `<방>-목차`를 읽습니다. `python -I _tools/kb_search.py . "<낱말>"`로 찾습니다.
2. 페이지를 읽고, 필요하면 `raw/` 원문 줄을 확인합니다.
3. 페이지를 링크로 인용해 답합니다.
4. 다시 쓸 만한 답은 `analyses/`에 페이지로 남기고, 목차와 기록에 추가합니다.

### 점검 (lint) — `/lint`
1. `python -I _tools/kb_lint.py .`를 실행합니다. 다음을 확인합니다.
   - 깨진 링크
   - 고아 페이지
   - frontmatter 누락
   - 이름 겹침
   - 표 안 escape 안 된 별칭
   - 줄 번호 없는 sources
2. 직접 읽고 다음을 확인합니다.
   - 모순
   - 낡은 가격·버전
   - 자주 나오는데 페이지가 없는 개념
3. 고칠 것은 고치고, 나머지는 기록 페이지에 제안으로 남깁니다.

기록 형식: `## [YYYY-MM-DD] ingest|query|lint|setup | 제목`
최근 기록 보기: `Select-String '^## \[' log.md | Select-Object -Last 5`
