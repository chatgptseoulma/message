# 루트의 단일 HTML 앱 4종 + 스크린샷

## What the four files share
- **Fragment format:** none of the four has `<!doctype>`, `<html>`, `<head>` or `<body>`. Each file starts at `<title>` and contains `<meta name="claude:viewport-fit-sides">`, a Google Fonts link, `<style>`, markup, and one `<script>` IIFE. They were written for the Claude artifact preview. Opened directly in a browser they render in quirks mode.
  - If one is deployed, add a document wrapper the way commute-break/index.html does.
- **No libraries or build step:** each file is self-contained. The only external dependency is Google Fonts. Each script uses the helper `const $ = id => document.getElementById(id)`.
- **Dark mode:** handled with `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` plus a `:root[data-theme="dark"]` override. None of the files has a theme toggle in the UI.
- **Line numbers:** the numbers below are actual line numbers in each file.

---

## wake-alarm.html — "기상 공고 알람" (545 lines)
An alarm clock that is hard to turn off, styled as a fluorescent yellow flyer taped to a concrete wall.
- When it rings, the sound stops only after every problem slip has been "torn off": math problems plus typing a sentence.
- A wrong answer makes the alarm louder. There is no snooze and no cancel.
- Fonts: Black Han Sans, IBM Plex Sans KR, IBM Plex Mono.

**Screens**
- `#flyer` (L235-280): settings form `#order`.
  - `#alarmTime` (default 07:00).
  - `#count`: 3 to 6 slips, default 4.
  - `#checkin`: re-check after dismissal, on by default.
  - `#preview` (plays the sound for 3 seconds), `#tryNow` (rings now), `#send` (arms the alarm).
  - Also on this screen: `#status`, `#stamp` ("발송됨" when armed, "기상 완료" when finished), `#strips`.
- `#ring` (L282-295): full-screen overlay flashing yellow and red. Problem form `#solve` with `#q`, `#ans`, `#msg`, `#mini`.
- `#checkinBox` (L297-304): "아직 깨어 있나요?" with a 60-second countdown.

**Logic**
- **Audio:** `initAudio` (L334) creates an AudioContext, a compressor, a master gain, and a silent keep-alive oscillator.
  - `schedule` (L361) looks ahead 2.5 seconds and runs every 250 ms.
  - Volume is `min(1, 0.18 + elapsed/45 + boost)`.
  - The pattern changes every 20 seconds: 988 Hz square beep → 620↔1650 Hz sawtooth siren → arpeggio.
- **Problems:**
  - Math (`mathProblem`, L435): `a×b+c`, where a is 13–49, b is 3–9, and c is 12–98.
  - Typing (`textProblem`): one of 4 PHRASES (L309-314). The last slip is always a typing problem.
  - Paste and drop are blocked on the answer field.
  - A wrong answer adds 0.12 to `boost` (maximum 0.6) and replaces the problem with a new one.
- **Flow:**
  - `ring()` (L459) builds the problems, starts the sound, and vibrates.
  - `solved()` (L492): if check-in is on, it schedules a check-in 3 minutes later; otherwise it calls `finish()` (L505).
  - `showCheckin()` (L515) beeps softly every 2.5 seconds. If no one presses the button within 60 seconds, the alarm rings again.
  - `tick()` (L557) runs every 500 ms. It updates the clock, fires the alarm, updates the status, and handles check-ins.
- **Screen awake:** the Wake Lock API is held during `holdScreen`, and re-acquired on `visibilitychange`.
- **Storage:** localStorage key `"wake-flyer"` holds `{time, count, checkin}`.
  - The **armed state is not saved**, so a reload cancels the alarm.
  - The alarm only rings while the tab stays open.
- **Gotchas:**
  - Once `#ringSub` changes to the "no response" text, it is never reset.
  - After a `tryNow` test, the stamp still shows "기상 완료".
  - `preview` is not locked while the alarm is armed.
  - The math check strips every non-digit character, so "2-3-4" counts as 234.
  - With a Korean IME, pressing Enter can submit before the last character is composed.

---

## 출근 전 점검표.html — "출근 전 점검표" (437 lines)
A pre-commute checklist styled like a station departure board.
- Items can be limited to certain weekdays and marked as important.
- Tracks a streak of fully checked days. Checks clear at midnight.
- Fonts: Do Hyeon, Gothic A1, IBM Plex Mono.

**Screen**
- `#board`: date and clock, `#count` (done/total), `#pill`, `#barFill`, `#left`.
  - `#pill` reads "점검 중", or "중요 N개 남음", or "출발해도 됩니다".
  - `#left` lists the remaining important items first.
  - Also shows `#streak` and `#lastDone`.
- `#groups`: three groups, `bag` 챙길 것, `home` 집 단속, `out` 나가기 직전.
- `.tools`: `#editToggle`, `#resetToday`.
- `#editor`: add an item (text up to 40 characters, group, weekdays, important), and `#restore` (resets to defaults; needs two clicks within 4 seconds).
  - In edit mode every item is shown, including items for other weekdays, and each item has a delete button.

**Data**
- `DEFAULT_ITEMS` (L231-247) has 15 items.
  - 주간 보고 is Monday only.
  - 음식물 쓰레기 is Tuesday and Friday.
- localStorage key `"commute-checklist-v1"`:
  ```
  { items:[{id, group, text, days:number[] (0=Sun; empty = every day), imp}],
    date:"YYYY-MM-DD", done:[id], completed:["YYYY-MM-DD"] (last 400), lastDoneAt:"YYYY-MM-DD HH:MM" }
  ```
  - New items get ids of the form `"u"+Date.now().toString(36)`.

**Functions**
- `rollDay` (L264), `todaysItems` (L270), `streak` (L275), `render` (L289-370).
- `toggle` (L372) is the only place that updates `completed` and `lastDoneAt`.
- `tickClock` runs every 15 seconds and re-renders when the date changes.

**Gotchas**
- Deleting or adding an item does not update `completed`, so the streak can be wrong.
- `restore` does not reset `completed`.
- Old saved data that lacks arrays will throw.

---

## 콩알이키우기.html — "콩알이 키우기" (542 lines)
A Tamagotchi-style pet bean on a coral-colored handheld with a green pixel LCD canvas.
- LCD size: 384×256, which is a 48×32 grid of 8-px cells.
- Fonts: Jua, Gowun Dodum, VT323.
- There is **no sound**.

**Screen**
- `canvas#lcd`, `#say`, and `#meters` (배부름, 기분, 청결, 체력; 5 segments each).
- Keys: 밥, 간식, 놀기, 청소, 약, 불.
- `#gameKeys`.
- Side card: name form (up to 8 characters), stage, age, weight, mistakes, `#alert`.
- Settings: `#speed` (×1, ×10 or ×60) and `#restart` (two clicks).

**State** (localStorage `"bean-pet-v1"`, saved every second)
```
{ name, stage:"egg"|"baby"|"child"|"adult", form:""|"bloom"|"droop", ageMin, hunger, happy, clean, energy,
  sick, sickMin, zeroMin, poops(≤4), poopIn, asleep, weight, mistakes, gone, lastTick, speed, eggTaps? }
```

**Simulation: `step(m)`** (L264-310, units are minutes)
- **Stages** (`stageFor`, L262): egg under 1 minute, baby under 30, child under 240, adult after that.
  - At adult, the form is bloom if there were 3 or fewer mistakes, otherwise droop.
- **Rates per minute:**

  | State | hunger | happy | energy | clean |
  |---|---|---|---|---|
  | Awake | −0.35 | −0.3 | −0.22 | −0.08 |
  | Asleep | −0.12 | −0.04 | +1.0 | −0.03 |

  - Being sick and each uncleaned poop add further penalties.
- **Poop:** one every 35–60 minutes.
- **Sickness:** chance `0.015*m` when clean < 20 or hunger < 10.
- **Mistakes:** a mistake is counted when a stat hits 0, or when the pet collapses from running out of energy.
- **Leaving:** the pet leaves (`gone`) after more than 720 minutes at hunger 0, or more than 720 minutes of being sick.

**Offline catch-up** (`catchUp`, L313-333): steps through missed time in 1-minute chunks, up to 48 hours. After more than 10 minutes away it shows a summary.

**Actions**
- `busy()` (L338): an egg hatches after 3 taps. Actions are blocked while asleep or after the pet has left.
- 밥: hunger +30, weight +1.
- 간식: happy +20, weight +2.
- 청소: clears poop.
- 약: cures sickness.
- 불: sleep toggle.
- 놀기 (L382): costs 8 energy and starts a 5-round left/right guessing game.
  - 3 or more wins: happy +25.
  - Fewer wins: happy +8.

**Drawing**
- Sprites `S` (L201-226) and icons `I` (L227-241).
- `draw()` (L482) runs every 500 ms.
- The LCD darkens while the pet sleeps (`setPal`). This is unrelated to the page's dark mode.

**Gotchas**
- The live 1-second loop passes elapsed time to `step` without chunking or a cap. After the computer sleeps, the sickness probability can go above 1, and only one poop is added.
- The subject particle "가" is hard-coded, which reads wrong for names that end in a final consonant (받침).
- During the game, arrow keys are captured globally.

---

## 퇴근길쉼표.html — "퇴근길 쉼표" (724 lines)
- Same content as `commute-break/index.html`; see [commute-break.md](commute-break.md).
- Reference line numbers in this file: `KIND` L252, `burnPaper` L452, 25-second interval L722.
- Additional gotchas:
  - During dictation, text typed by hand is overwritten by the next final speech result.
  - Right after a throw, a late `onresult` can write the thrown-away text back.
  - Errors such as `aborted` restart recognition in a loop.

---

## Screenshots
- **`스크린샷 2026-11-05 140835.png`** (14:08): the Claude desktop app, "DB Inc 홈페이지" session.
  - The user asks "설문조사를 내 노트북 내에서 서버랑 디비를 구축해서 띄워놔줘".
  - Claude is starting a 4-step plan.
  - The context panel shows 8% used (79.1k/1M).
- **`스크린샷 2026-11-05 141434.png`** (14:14): Claude reports that the survey server is running.
  - URLs: localhost:8000, /results, /api/export.csv.
  - The questions shown are a **provisional customer satisfaction/NPS survey**: satisfaction, channel, improvement areas, recommendation 0-10. These are different from today's `survey/` (the company training needs survey), so the questions were changed afterwards.
  - The terminal shows `python server.py` failing with Errno 2 because it was run from `C:\Users\yhma`. The command has to be run from inside `survey/`, or as `python survey/server.py`.
