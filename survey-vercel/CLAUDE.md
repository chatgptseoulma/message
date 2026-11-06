# survey-vercel/

Vercel + Supabase port of `survey/` (https://education-survey.vercel.app).

**Before you answer a question or start work, read [docs/survey-vercel.md](../docs/survey-vercel.md) first.**

- **Shared Supabase project** (ref `fwpxfnbjwkzuglyrmraz`) with `comfort-letters`. Because of that, the `comfort-letters` migrations folder also contains this app's `20261105000000_responses.sql`. **Do not delete it.** The migration history has to stay in sync.
- **API pattern** (same as `comfort-letters`):
  - `lib/common.js` holds a lazily created Supabase client, `db()`, that uses the service-role key, plus the `send` and validation helpers.
  - `api/*.js` contains the functions.
  - Every table has RLS enabled with no policies, and access is revoked from anon and authenticated. Only the server can reach the data.
- `survey/` and `survey-vercel/` share the same survey questions (`OPTIONS`) and validation rules, and `public/index.html` is identical in both. If you change a question, update `survey/server.py`, `lib/common.js`, both HTML copies, and the migration (if needed) together.
- `RESULTS_PUBLIC = true` (`lib/common.js:16`), so the results and the CSV, which include personal data, are public. If you switch it to `false`, you must also remove the `/login → /results` redirect in `vercel.json`, otherwise you get an infinite redirect loop.
- Secrets are Vercel production sensitive variables, set with `vercel env add <NAME> production --sensitive --force`.
- The PowerShell scripts in this folder are interactive: they prompt with `Read-Host`. The user has to run them in their own window.
- Never print or commit secret values: `.env.local`, `supabase/.temp/pooler-url`.
- How to run, deploy, and push the DB: see the root `CLAUDE.md`.
