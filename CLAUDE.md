# CLAUDE.md — 실행과 테스트

폴더별 규칙은 각 폴더의 `CLAUDE.md`에 있습니다. 저장소 전체 규칙(새 파일 위치, 앱 목록, 비밀값)은 `.claude/rules/`에 있습니다.

## 테스트
- **Regression tests (run before and after a refactor):** `powershell -ExecutionPolicy Bypass -File C:\2026CC\tests\run-all.ps1` — 90 Python + 416 Node tests, about 30 seconds.
- Single file: `cd tests\node; node --test --experimental-test-module-mocks <file>.test.js`

## 실행
- **survey:** `python survey/server.py` → http://127.0.0.1:8000 (preview `survey`). Standard library only. Run it from `C:\2026CC` or inside `survey/`; from another folder it fails with Errno 2.
- **survey-vercel, comfort-letters:** `npm install` (no npm scripts, no build, Node 20+). Local: `vercel dev` — `.env.local` only has `VERCEL_OIDC_TOKEN`, so set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` yourself (survey-vercel also `ADMIN_PASSWORD`).
  - Deploy: `vercel deploy --prod --yes` (CLI: `%APPDATA%\npm\vercel.cmd`).
  - DB: `npx supabase db push --remote --yes` (needs `$env:SUPABASE_DB_PASSWORD`).
- **commute-break:** static site. Deploy with `vercel --prod` from inside the folder.
- **Single-file HTML at the root:** open it directly in a browser. Nothing to build.
- **voice-notes** (from inside `voice-notes/`): `시작.bat` (watch mode), or `.venv\Scripts\python.exe app.py --once` (process pending files and exit).
- **kb-viewer:** `python kb-viewer/server.py` → http://127.0.0.1:8765 (or `KB뷰어-실행.bat`; preview `kb-viewer` uses port 8768). Shareable HTML: `python kb-viewer/build.py` → `kb-viewer/dist/`.
- **docs/kb wiki check:** `python -I docs/kb/_tools/kb_lint.py docs/kb`
