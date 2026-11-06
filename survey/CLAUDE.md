# survey/

Company training-needs survey. Python standard library + SQLite, runs locally.

**Before you answer a question or start work, read [docs/survey.md](../docs/survey.md) first.** It records endpoints, schemas, line numbers, and known bugs.

- `survey/` and `survey-vercel/` share the same survey questions (`OPTIONS`) and validation rules, and `public/index.html` is identical in both. If you change a question, update `server.py`, `survey-vercel/lib/common.js`, both HTML copies, and the migration (if needed) together.
- Never print or commit the secret value in `survey/admin_password.txt`.
- How to run it: see the root `CLAUDE.md`.
