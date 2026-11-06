# comfort-letters/

"퇴근길 빡침 우체통", an anonymous venting messenger (redesigned 2026-11-05 into broadcast rooms that every comforter can see; legacy 1:1 threads are still readable). Vercel + Supabase.

**Before you answer a question or start work, read [docs/comfort-letters.md](../docs/comfort-letters.md) first.**

- **Shared Supabase project** (ref `fwpxfnbjwkzuglyrmraz`) with `survey-vercel`. Because of that, this app's migrations folder also contains survey's `20261105000000_responses.sql`. **Do not delete it.** The migration history has to stay in sync.
- **API pattern** (same as `survey-vercel`):
  - `lib/common.js` holds a lazily created Supabase client, `db()`, that uses the service-role key, plus the `send` and validation helpers.
  - `api/*.js` contains the functions.
  - Every table has RLS enabled with no policies, and access is revoked from anon and authenticated. Only the server can reach the data.
- Secrets are Vercel production sensitive variables, set with `vercel env add <NAME> production --sensitive --force`.
- `setup.ps1` is interactive: it prompts with `Read-Host`. The user has to run it in their own window.
- Never print or commit secret values: `.env.local`, `supabase/.temp/pooler-url`.
- How to run, deploy, and push the DB: see the root `CLAUDE.md`.
