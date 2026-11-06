---
name: add-question
description: 사내 교육 수요 설문(survey/, survey-vercel/)에 질문을 하나 추가하는 순서. 응답 화면 → 서버 → DB → 결과 화면 → 테스트 → 반영 순으로 두 앱을 함께 고친다. 사용자가 "설문에 질문 추가", "문항 하나 더", "설문 항목 늘려 줘"처럼 말하면 쓴다.
argument-hint: <질문 내용과 형식, 예: "선호 강사 유형, 단일 선택: 사내 강사/외부 전문가/상관없음">
---

# 설문에 질문 하나 추가하기

**요청:** $ARGUMENTS

설문은 **두 벌**입니다.
- `survey/`: Python + SQLite, 로컬
- `survey-vercel/`: Vercel + Supabase, 운영

두 앱은 질문, 검증 규칙, 응답 화면을 같게 유지해야 하므로 **모든 단계를 두 앱에 똑같이** 합니다. 시작하기 전에 `docs/survey.md`와 `docs/survey-vercel.md`를 읽으세요.

## 0. 질문 정하기 (사용자에게 확인)
아래 표를 채워 사용자에게 보여 주고, 확인을 받은 뒤 시작합니다.

| 항목 | 예 | 정할 것 |
|---|---|---|
| 필드 키 | `trainer_type` | 영문 snake_case. 기존 키와 겹치면 안 됩니다. 선택지 목록 키는 복수형입니다 (예: `trainer_types`). |
| 형식 | 단일 선택 / 복수 선택 / 주관식 / 1~5 점수 | 기존에 같은 형식의 질문이 있으면 그것을 본보기로 삼습니다: 단일 선택 `duration`, 복수 선택 `methods`, 주관식 `priority_topic`, 점수 `skill` |
| 필수 여부 | 필수 / 선택 | **이미 응답한 사람의 행에는 값이 없습니다.** 필수로 하더라도 DB 열은 비어 있어도 되게 만듭니다 (3단계 참고). |
| 화면 문구 | "10. 선호하는 강사 유형" | 번호는 마지막 질문 다음입니다. 지금은 9번 "자유 의견"이 마지막이라, 그 앞에 넣으면 번호를 다시 매겨야 합니다. |
| 오류 문구 라벨 | "선호 강사 유형" | `"{라벨}을(를) 선택해 주세요."` 같은 서버 오류 문구에 들어갑니다. |
| 선택지 | ["사내 강사", "외부 전문가", "상관없음"] | 선택형일 때만. "기타"를 넣으면 `area_other`처럼 직접 입력칸과 규칙을 함께 만들어야 합니다. |
| 결과 표시 | 막대 그래프 / 주관식 목록 / 평균 타일 | 결과 화면에 어떻게 보일지 |
| CSV 열 제목 | "선호 강사 유형" | CSV에서 어느 열 뒤에 넣을지 |

## 1. 응답 화면 (`index.html` 두 벌은 바이트까지 같아야 함)
대상: `survey/static/index.html`, `survey-vercel/public/index.html`

1. 넣을 자리에 `<fieldset><legend>번호. 문구 <span class="req">*</span></legend>…</fieldset>`를 추가합니다. `*`는 필수일 때만 씁니다.
   - **선택형:** `<div class="opts" id="<key>"></div>`. 선택지는 `/api/config`에서 받아 그리므로 HTML에 적지 않습니다.
   - **주관식:** `<input type="text" name="<key>" maxlength="…">` 또는 `<textarea>`
2. 선택형이면 `fetch("/api/config")` 블록에 `opts("<key>", "<key>", c.<keys>, "radio"|"checkbox");`를 추가합니다.
3. 제출할 때 만드는 `body` 객체에 `<key>: fd.get("<key>")`를 추가합니다. 복수 선택이면 `fd.getAll("<key>")`입니다.
4. 뒤 질문의 번호를 바꿨다면 legend 번호를 모두 다시 맞춥니다.
5. 같은 수정을 다른 쪽 파일에도 복사합니다. 다음 명령이 **`True`**여야 합니다.
   ```
   (Get-FileHash survey\static\index.html).Hash -eq (Get-FileHash survey-vercel\public\index.html).Hash
   ```

## 2. 서버 (선택지 목록과 검증)
| | `survey/server.py` | `survey-vercel/lib/common.js` |
|---|---|---|
| 선택지 | `OPTIONS["<keys>"] = [...]` | `OPTIONS.<keys> = [...]` |
| 검증 | `validate()`의 dict에 `"<key>": _one(...)` / `_many(...)` / `_text(...)` / `_int(...)` | `validate()`의 `r`에 `one(...)` / `many(...)` / `text(...)` / `int(...)` |

- `/api/config`는 `OPTIONS`를 그대로 내보내므로 따로 고칠 필요가 없습니다.
- 라벨과 오류 문구는 두 앱에서 **글자까지 같게** 합니다. 테스트가 문구를 비교합니다.
- 선택 사항인 선택형 질문은 빈 값(`""`/`null`)을 허용하는 처리를 `past_sat`처럼 직접 넣습니다. 기존 `one()`은 빈 값을 거부합니다.

## 3. DB (기존 응답은 절대 지우지 않음)
### survey/ (SQLite)
- `init_db()`의 `CREATE TABLE IF NOT EXISTS`에 열을 추가합니다. **이것만으로는 이미 있는 `survey.db`에 반영되지 않습니다.**
- 그래서 `init_db()` 끝에 다음을 넣습니다.
  - `PRAGMA table_info(responses)`로 열이 있는지 확인합니다.
  - 없으면 `ALTER TABLE responses ADD COLUMN <key> TEXT`를 실행합니다.
  - 기존 행을 고려해 `NOT NULL`은 붙이지 않습니다.
- 복수 선택은 JSON 문자열로 저장합니다.
  - `save()`에서 `json.dumps(..., ensure_ascii=False)`로 바꿉니다.
  - 읽는 곳(`summary`, `export_csv`)에서는 `json.loads`로 되돌립니다.
- `save()`의 SQL 세 곳에 모두 추가합니다: 열 목록, `VALUES`, `ON CONFLICT ... DO UPDATE SET`.

### survey-vercel/ (Supabase, comfort-letters와 같은 프로젝트)
- **이미 적용된 `20261105000000_responses.sql`은 고치지 않습니다.**
- 새 파일 `supabase/migrations/<YYYYMMDDhhmmss>_responses_<key>.sql`을 만듭니다.
  - 내용 예: `alter table public.responses add column if not exists <key> text not null default '';`
  - 단일 선택은 `text`(필수가 아니면 null 허용), 복수 선택은 `text[] not null default '{}'`, 점수는 `smallint` + `check`입니다.
  - 기존 행을 바꾸거나 지우는 문(update/delete/drop)은 넣지 않습니다.
- **같은 파일을 `comfort-letters/supabase/migrations/`에도 똑같이 복사합니다.** 두 앱이 마이그레이션 이력을 공유하고, 실제 반영은 comfort-letters 폴더에서 하기 때문입니다. comfort-letters 폴더에만 전체 이력이 있습니다.
- `api/responses.js`는 `validate()` 결과를 그대로 upsert하므로 고칠 필요가 없습니다.

## 4. 결과 화면 (`summary` → `results.html` → CSV)
| 대상 | 고칠 곳 |
|---|---|
| `survey/server.py` `summary()` | 선택형: `"<keys>": count("<key>", OPTIONS["<keys>"], is_json)`. 주관식: `texts` 조건과 키 목록에 추가 |
| `survey-vercel/api/summary.js` | 같은 내용: `count(rows, "<key>", OPTIONS.<keys>, isArray)`. 주관식: `texts`의 `filter`와 `map` |
| `results.html` 두 벌 | 선택형: `<section><h2>제목</h2><div id="<keys>"></div></section>`을 추가하고, `for (const k of [...]) bars(...)` 목록에 `"<keys>"`를 넣습니다. 주관식: `const lines = [...]`에 `["<key>", "표시 이름"]` |
| `survey/server.py` `export_csv()` | 헤더 목록과 행 값 목록의 **같은 위치**에 추가 |
| `survey-vercel/api/export.js` | `head`와 `lines.push([...])`의 같은 위치에 추가 |

- **새 질문에 답이 없는 기존 행:** `count()`가 `""`나 `null`을 칸으로 세어 "빈 막대"가 생깁니다.
  - 새 필드는 빈 값을 건너뛰게 합니다. 예: `if v` / `if (v)`
  - 응답자 수 대비 비율이 어색하면 결과 화면에 "응답 n명"을 함께 표시합니다.
- `results.html` 두 벌은 원래 한 줄(41행, `/logout` 링크)만 다릅니다. 그 차이 말고는 같게 유지합니다.

## 5. 테스트 (새 동작이므로 테스트도 함께 고침)
`tests/README.md` 규칙대로 합니다. **기존 동작을 바꾸지 않았는데 테스트가 깨지면 앱 쪽 수정이 잘못된 것**입니다.

| 파일 | 고칠 곳 |
|---|---|
| `tests/survey_py/base.py` | `EXPECTED_OPTIONS`에 선택지, `valid_payload()` 기본값에 새 필드 |
| `tests/survey_py/test_responses.py` | 새 필드 검증 테스트를 추가합니다: 정상 값, 잘못된 값의 오류 문구, 빈 값 |
| `tests/survey_py/test_summary.py` | 결과 키 목록과 집계 값. 기존 행(값 없음)이 빈 막대를 만들지 않는지 |
| `tests/survey_py/test_csv.py` | 헤더 목록(지금 17열)과 행 값 |
| `tests/survey_py/test_routes.py` | `index.html`/`results.html`에 있어야 하는 `id=`/`name=` 목록 |
| `tests/node/helpers/fake-supabase.js` | `SURVEY_SCHEMA().responses.columns`에 새 열 (마이그레이션과 같은 타입·기본값) |
| `tests/node/survey-vercel.test.js` | `OPTIONS`, 유효한 payload 두 곳, 검증 실패 표, summary 기대값, CSV `head` |

- 추가로 확인할 것: 새 열이 없는 **옛 `survey.db`로 서버를 켜도** 열이 추가되고 기존 응답이 그대로인지 확인하는 테스트를 하나 넣습니다.
- 실행:
  ```
  powershell -ExecutionPolicy Bypass -File C:\2026CC\tests\run-all.ps1
  ```
  **모두 통과**해야 다음 단계로 갑니다. 테스트 수가 늘었으면 루트 `CLAUDE.md`와 `tests/CLAUDE.md`의 개수도 고칩니다.

## 6. 반영 (순서 중요: DB → 서버)
1. **로컬 확인:** `python survey/server.py` → http://127.0.0.1:8000 에서 제출하고, 결과 화면과 CSV에 새 질문이 나오는지 봅니다.
2. **Supabase DB 반영은 사용자가 직접 합니다.** DB 비밀번호가 필요한 대화형 스크립트입니다.
   - `powershell -ExecutionPolicy Bypass -File C:\2026CC\comfort-letters\migrate.ps1`
   - 끝나면 `comfort-letters/migrate.log`의 `exit code: 0`을 확인합니다.
3. DB가 반영된 **뒤에** `survey-vercel`에서 `vercel deploy --prod --yes`를 실행합니다. 순서가 바뀌면 새 열이 없는 DB에 저장하려다 500 오류가 납니다.
4. 운영 주소(https://education-survey.vercel.app)에서 제출해 보고, 결과와 CSV를 확인합니다.
   - 테스트 응답은 테스트용 사번으로 넣고, 확인한 뒤 지워 달라고 사용자에게 알립니다.
   - 결과가 공개(`RESULTS_PUBLIC = true`)라 테스트 응답도 보입니다.

## 7. 문서
- `docs/survey.md`: 선택지(Survey options), 검증 표, DB 열, CSV 열 수
- `docs/survey-vercel.md`: DB 절에 새 마이그레이션 파일을 적습니다.
- 사용자에게 보고할 것: 바꾼 파일, 테스트 결과(개수), DB 반영과 배포를 했는지 아직인지
