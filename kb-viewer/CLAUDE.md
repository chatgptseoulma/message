# kb-viewer/

Local web app that shows the KakaoTalk LLM Wiki in `docs/kb`: documents, original chat lines, search, link graph, stats, and a 💬 chat tab. Python standard library only. It only reads the vault and never changes it.

**Before you answer a question or start work, read [README.md](README.md) first.** The wiki's own rules are in `docs/kb/CLAUDE.md`.

- `server.py` (API + markdown rendering), `static/index.html` (the whole UI), `build.py` (shareable single-file HTML in `dist/`).
- The chat tab calls the Claude Code CLI (`%USERPROFILE%\.local\bin\claude.exe -p`) with all tools disabled (`--tools ""`). It needs a CLI login (`claude auth login`), which is separate from the desktop app's login.
- `dist/KB뷰어_원문포함.html` contains other people's chat messages. Do not share it or publish it without the user's explicit OK.
- How to run and build: see the root `CLAUDE.md`.
