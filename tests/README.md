# 회귀(특성화) 테스트

Characterization tests that lock in **how the code behaves right now**. Before a refactor they all pass. If anything fails after a refactor, the behavior changed.

## How to run
```
powershell -ExecutionPolicy Bypass -File C:\2026CC\tests\run-all.ps1     # everything (~30s)
python -m unittest discover -s C:\2026CC\tests\survey_py -t C:\2026CC\tests\survey_py -v   # survey/ only
cd C:\2026CC\tests\node; npm test                                        # all Node tests
cd C:\2026CC\tests\node; node --test --experimental-test-module-mocks root-wake-alarm.test.js   # one file
cd C:\2026CC\tests\node; node --test --experimental-test-module-mocks --test-name-pattern="quirk" "*.test.js"  # by test name
```

## Layout
| Path | Target | How it works |
|---|---|---|
| `survey_py/` | `survey/server.py` | Copies the app into a temp folder and runs it on a random port, then sends HTTP requests. Only `harness.py` knows the server's internal names. Set `SURVEY_APP_DIR` to test a different copy. |
| `node/survey-vercel*.test.js`, `node/comfort-letters*.test.js` | Vercel `api/*.js` | `mock.module` swaps `@supabase/supabase-js` for the in-memory fake in `helpers/fake-supabase.js`. Network calls are blocked. File paths live only in `ROUTES` in `helpers/vercel-harness.js`. |
| `node/root-*.test.js` | Single-file HTML apps at the root, plus `commute-break` | Loads each page into jsdom through `helpers/html-harness.js`, with fake timers and stubs for Audio, Canvas, Speech and WakeLock. Tests touch only the DOM and localStorage. |
| `node/other-*.test.js` | The two `타인/` HTML apps | Same jsdom approach. The real-estate tests pin `TZ=Asia/Seoul` and a fixed clock. |

## Rules
- **Never change app code to make a test pass.** If a refactor makes a test fail, either fix the refactor, or, if you changed the behavior on purpose, update the test too.
- **`quirk:` / `test_quirk_*` tests** lock in known bugs exactly as they behave today. When you fix one of those bugs, update or delete its test as well.
- Snapshot-style assertions (dish names, the real-estate list, rounded values) break when the data or the rounding method changes. One example: the autoAcq result depends on floating-point rounding error.
- `comfort-letters` was redesigned into broadcast rooms on 2026-11-05, and its tests follow the new code. If that code keeps changing, update the tests to match.
