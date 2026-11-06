# survey/ — 사내 교육 수요 조사 (Python 로컬 버전)

## Purpose
A small web app for a company's internal training-needs survey (사내 교육 수요 조사). Employees fill in one form. An admin logs in with a password to see aggregate charts, free-text answers and a CSV export. Each employee number (emp_no) keeps one response, and submitting again overwrites it. The UI text is Korean.

Files:
- `server.py` (361 lines)
- `static/index.html`, `static/login.html`, `static/results.html`
- `survey.db`: SQLite, journal_mode=delete
- `admin_password.txt`: the admin password. Never print its contents.

## Run
- `python survey/server.py`. You can also use the `survey` preview in `.claude/launch.json`.
- It listens on **127.0.0.1:8000** (server.py:22, 360). Only the local machine can connect. LAN access would need `0.0.0.0`.
- Dependencies: **standard library only** (`http.server.ThreadingHTTPServer`, sqlite3, csv, hmac, secrets, http.cookies).
- At startup (server.py:353-360):
  - stdout is set to UTF-8.
  - `init_db()` creates the table if it is missing.
  - `admin_password()` creates the password file if it is missing.
- Paths are relative to the script folder (`BASE`, server.py:23-26).
- Request log format: `[HH:MM:SS] <ip> <request line> <status>` (server.py:349-350).

## Admin password
- `admin_password()` (server.py:79-82): if the file is missing, it writes `secrets.token_urlsafe(9)` (12 characters).
- The file is re-read on every login, so editing it takes effect without a restart.
- The check uses `hmac.compare_digest`.

## Survey options (server.py:30-40, served by /api/config)
- ranks: 사원, 주임·대리, 과장, 차장, 부장 이상
- areas: 직무 전문성, 디지털·AI·데이터, 리더십·관리, 커뮤니케이션·협업, 문서·보고서 작성, 외국어, 자기계발·건강, 기타 (`MAX_AREAS = 3`)
- methods: 오프라인 집합, 실시간 온라인, 녹화 강의(이러닝), 사내 멘토링·스터디, 외부 위탁
- time_slots: 근무시간 중, 점심시간, 퇴근 후, 주말
- durations: 1시간 이하, 2~4시간, 하루, 2일 이상
- barriers: 업무 부담, 시간 부족, 원하는 주제 없음, 교육 정보 부족, 기타
- `EMP_RE = ^[A-Za-z0-9-]{1,20}$`

## Validation (`validate`, server.py:124-160)
| field | rule |
|---|---|
| name | required, ≤30 |
| emp_no | required, ≤20, must match EMP_RE; case-sensitive |
| dept | required, ≤50, free text |
| rank | one of ranks |
| areas | 1 to 3 items; deduplicated and sorted in option order |
| area_other | ≤100; required if 기타 is selected, otherwise forced to "" |
| priority_topic | ≤100, optional |
| skill | int 1-5, required |
| methods | ≥1 item |
| time_slot, duration | one of the options |
| past_sat | ""/None → NULL; "none" → 0 (never received training); otherwise int 1-5 |
| barriers | 0 or more items; barrier_other works like area_other |
| comment | ≤1000 |

On failure the server returns 400 `{"error": "<Korean message>"}`.

## DB (`responses` table, server.py:54-76)
- `emp_no TEXT PRIMARY KEY`
- Required text fields: name, dept, rank.
- `areas`, `methods`, `barriers`: JSON array strings (`ensure_ascii=False`).
- `skill INTEGER CHECK 1-5`
- `past_sat INTEGER`: 0 = never received training, NULL = no answer.
- `created_at`, `updated_at`: local time, `%Y-%m-%d %H:%M:%S`.
- `save` (server.py:163-183) runs inside `db_lock`:
  - It checks whether the row already exists.
  - It runs `INSERT ... ON CONFLICT(emp_no) DO UPDATE`, which keeps created_at.
  - It returns the `updated` flag.

## Routes (Handler, server.py:270-350)
Every response sets `nosniff` and `Cache-Control: no-store`.

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| GET | `/`, `/index.html` | – | survey page |
| GET | `/api/config` | – | OPTIONS plus `max_areas` |
| GET | `/login` | – | login page |
| GET | `/logout` | – | deletes the session and the cookie; 302 to /login |
| GET | `/results` | session | 302 to /login if not logged in |
| GET | `/api/summary?dept=&rank=` | session | aggregate JSON; 401 if not logged in |
| GET | `/api/export.csv` | session | `education_survey_YYYYMMDD_HHMM.csv` |
| POST | `/api/responses` | – | 201 for a new row; 200 with `updated:true` for an overwrite; 400 on failure |
| POST | `/api/login` | – | `{"password"}`. Success: sets the `sid` cookie (HttpOnly, SameSite=Strict, 8 hours). Failure: sleeps 1 second, then 401 |

- Request bodies over 20,000 bytes are rejected.
- POST paths must match exactly, so a query string gives 404.
- Sessions are kept in an in-memory dict (token → expiry) and are lost on restart.

## Summary (server.py:187-225)
- Filters `dept` and `rank` use exact match.
- `depts` is always the full list of departments.
- `avg_skill`, rounded to 2 decimals.
- `avg_past_sat` excludes both 0 and NULL. `past_none` counts the zeros.
- Count dicts (areas, methods, barriers, time_slots, durations, ranks) start with every option at 0 and keep option order.
- `texts`: free-text answers, including name and emp_no.

## CSV (server.py:228-249)
- Covers all rows, ignoring the filters, ordered by dept then emp_no.
- 17 columns with Korean headers.
- List fields are joined with ", ". past_sat 0 is written as "받은 적 없음".
- Values starting with `= + - @` get a `'` prefix.
- The file starts with a UTF-8 BOM.

## Frontend
- **index.html**:
  - Options are built from /api/config.
  - The unchecked area boxes are disabled once 3 areas are selected.
  - `toggleOther` shows or hides the 기타 input.
  - Submits JSON built from FormData.
  - No client-side validation; all validation is on the server.
- **login.html**: POSTs /api/login, then redirects to /results.
- **results.html**:
  - Dept and rank filters, 3 tiles, 6 bar charts (`bars()`) and a free-text list.
  - Refreshes automatically every 30 seconds. Redirects to /login on 401.
  - Renders with textContent only.

## Gotchas
- No respondent authentication: anyone who knows an emp_no can overwrite that person's answer.
- The login delay is 1 second, but requests run in parallel threads and there is no lockout.
- Logout is a GET request. There is no CSRF check on POST.
- sqlite connections are never explicitly closed.
- `_int` accepts `true` and floats.
- A negative Content-Length can make the read block.
- The CSV guard doesn't cover leading tab or CR.

## Relationship to survey-vercel
- `survey-vercel/public/index.html` is byte-identical to this one.
- The login.html copy differs only at line 26 (the password-file hint is removed).
- The results.html copy differs only at line 41 (the `/logout` link is removed).
