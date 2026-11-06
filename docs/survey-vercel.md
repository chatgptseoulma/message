# survey-vercel/ — 사내 교육 수요 조사 (Vercel + Supabase 버전)

This is a port of `survey/` (the Python version) to Vercel serverless functions plus Supabase Postgres. The UI, the survey options, and the validation rules are the same as `survey/`; see [survey.md](survey.md). This document covers only what is different.

## Deployment info
- **Vercel project:** `education-survey`, under the `yhma1` account.
- **Production URL:** https://education-survey.vercel.app
  - The latest deploy is recorded in `deploy.log`. It succeeded, despite the NativeCommandError header at the top of that file. That header comes from PowerShell `*>` capturing a stderr line and is cosmetic.
- **Supabase project:** ref `fwpxfnbjwkzuglyrmraz`, region ap-northeast-2, Postgres 17.
  - **The same Supabase project is shared with comfort-letters.**
- **Migration:** `push.log` shows it succeeded, with exit code 0.
- ⚠ **Possibly undeployed change:** `lib/common.js`, `public/results.html` and `vercel.json` were edited at 15:25, after the last logged deploy at 15:20. That edit is the one that made results public. Unless you have confirmed a later deploy, re-run `vercel deploy --prod --yes`.

## Environment variables
| Name | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL (common.js:23) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server key, either `sb_secret_…` or a legacy `eyJ…` JWT. It is also part of the cookie HMAC secret. |
| `ADMIN_PASSWORD` | Admin password. It is also part of the HMAC secret. |

- All three are set as Vercel **production sensitive** variables. Sensitive variables cannot be pulled, so `.env.local` contains only `VERCEL_OIDC_TOKEN`.
- For `vercel dev`, set the variables above by hand.

## Commands
- **Install:** `npm install`. There are no npm scripts and no build step. The project is ESM and needs Node 20 or later.
- **Local:** `vercel dev`.
- **Deploy:** `vercel deploy --prod --yes`. The CLI path is `%APPDATA%\npm\vercel.cmd`.
- **DB:** `npx supabase db push --remote --yes`. This needs `$env:SUPABASE_DB_PASSWORD` and an already linked project.
- **Secrets:** `vercel env add <NAME> production --sensitive --force` with the value piped on stdin.

## PowerShell scripts (in the order they were used)
Run each one in its own interactive window with `powershell -ExecutionPolicy Bypass -File <script>`. Each script waits for a keypress (`Read-Host`) at the end.
1. `login.ps1`: logs in to Supabase and Vercel through the browser.
2. `supabase-login-token.ps1`: logs in to Supabase with a personal access token (`sbp_`). This is the fallback when browser login isn't possible.
3. (Run directly, not from a script) `npx supabase link`.
4. `supabase-setup.ps1`: asks for the DB password, then runs `db push` and writes the output to `push.log`.
5. `vercel-secrets.ps1`: prompts for the service key and for ADMIN_PASSWORD (at least 8 characters), then sets both as sensitive variables.
6. `vercel-key.ps1`: re-enters the service key and redeploys.
   - It rejects keys that start with `sb_publishable_`.
   - Writes the deploy output to `deploy.log`.
7. `vercel-key-auto.ps1`: does the same as step 6, but reads the key automatically with `npx supabase projects api-keys --reveal -o json`.

## lib/common.js
- **`OPTIONS`, `MAX_AREAS=3`, `validate(d)`:** the same rules as the Python version.
  - `int()` uses `parseInt`, so `"3abc"` is accepted as 3.
- **`RESULTS_PUBLIC = true`** (line 16): results and the CSV are public, made so at the user's request on 2026-11-05. `isAdmin()` always returns true while this is set.
- **Authentication (when `RESULTS_PUBLIC` is false):**
  - The cookie is stateless: `sid=<expMs>.<HMAC>`, with `HttpOnly`, `Secure`, `SameSite=Strict`, and a lifetime of 8 hours.
  - The secret is `sha256(ADMIN_PASSWORD \0 SERVICE_KEY)`.
  - `checkPassword` compares with `timingSafeEqual`.
- **Other helpers:**
  - `kst(iso)`: formats a time in Asia/Seoul.
  - `fetchAll(filters)`: pages through results 1,000 rows at a time, ordered by `updated_at desc`.
  - `send()`: sets the response headers `no-store` and `nosniff`.

## API
| Method | Path | Auth | Notes |
|---|---|---|---|
| any | `/api/config` | – | Returns OPTIONS plus `max_areas` |
| POST | `/api/responses` | – | Validates, checks whether `emp_no` already exists, then upserts on `emp_no`. Returns 201 for a new row, or 200 with `updated:true` for an overwrite. |
| POST | `/api/login` | – | `{password}`. On failure it waits 1 second and returns 401. |
| any | `/api/logout` (also `/logout`) | – | Clears the cookie and redirects (302) to `/login` |
| GET | `/api/summary?dept=&rank=` | isAdmin | Same aggregation as the Python version. Times are in KST. |
| GET | `/api/export` (also `/api/export.csv`) | isAdmin | CSV with a BOM, CRLF line endings, and a CSV-injection guard. The file name is `education_survey_YYYYMMDDHHMM.csv`. |

## DB (`supabase/migrations/20261105000000_responses.sql`)
- **Columns:** `public.responses`, keyed by `emp_no`.
  - `emp_no` is the text PK, with a regex CHECK.
  - `areas`, `methods` and `barriers` are **`text[]`**. The Python version stores them as JSON strings instead.
  - `skill` is a smallint between 1 and 5.
  - `past_sat` is a smallint between 0 and 5, or null.
  - The free-text fields default to `''`.
  - `created_at` and `updated_at` are timestamptz.
- **Indexes:** `dept` and `updated_at desc`.
- **Access:** RLS is enabled with no policies, and access is revoked from anon and authenticated. Only the service role can reach the table.

## vercel.json
- `cleanUrls`.
- **Rewrites:** `/api/export.csv` → `/api/export`, and `/logout` → `/api/logout`.
- **Redirect:** `/login` → `/results`. This was added together with the public-results change.
  - ⚠ If you set `RESULTS_PUBLIC=false`, **you must remove this redirect**. Otherwise the 401 response sends the browser to `/login`, which redirects back to `/results`, in an infinite loop.
- **Headers:** nosniff, `Referrer-Policy: same-origin` and `X-Frame-Options: DENY` everywhere. `noindex` on results and the API.

## Frontend differences from the Python version
- `public/index.html` is byte-for-byte identical.
- `login.html` drops the line that pointed to the password file.
- `results.html` has no `/logout` link.

## Gotchas
- With `RESULTS_PUBLIC=true`, **personal information (names, employee numbers, comments) is public**.
- The department list in `summary.js:14` doesn't page, so it is capped at 1,000 rows.
- Paging by `updated_at` has no tiebreaker. Rows with the same timestamp can be skipped or appear twice.
- If `SUPABASE_SERVICE_ROLE_KEY` is missing, `secret()` reports the error as ADMIN_PASSWORD being missing.
