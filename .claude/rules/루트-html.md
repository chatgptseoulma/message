---
paths:
  - "/*.html"
---

# 루트의 단일 파일 HTML 앱

- Read [docs/root-html.md](../../docs/root-html.md) first.
- The four HTML files at the root (`wake-alarm.html`, `출근 전 점검표.html`, `콩알이키우기.html`, `퇴근길쉼표.html`) are fragments with no `<!doctype>`/`<head>`, written for the Claude artifact preview. Before deploying one, add the document wrapper the way `commute-break/index.html` does.
- `퇴근길쉼표.html` and `commute-break/index.html` have the same body, so a change to one should go into the other too.
- These are user files: do not move or delete them.
