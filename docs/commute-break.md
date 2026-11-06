# commute-break/ (= 퇴근길쉼표.html) — 퇴근길 쉼표

## Relationship between the files
- `commute-break/index.html` (734 lines) has **the same content** as `C:\2026CC\퇴근길쉼표.html` (724 lines).
  - The only difference: index.html adds a document wrapper (`<!doctype html>`, `<html lang="ko">`, `<head>`, `<meta charset>`, a viewport meta tag, `</head><body>…</body></html>`).
  - The original is a fragment that starts at `<title>`.
- Line mapping:
  - head/CSS: original = index − 5
  - body/script: original = index − 6
- Deployment:
  - Static site on Vercel, project name `commute-break`. There is no package.json and no build step.
  - To redeploy, run `vercel --prod` inside the folder.
  - **If you edit one copy, check whether the other copy needs the same change.**

## Purpose
A calm, supportive page for office workers on the way home. It has three tabs. Nothing is persisted and there is no backend.

## Dependencies
- Google Fonts: Gaegu (handwriting style, `--hand`) and Gowun Dodum (body text).
- Browser APIs only: Web Audio (every sound is synthesized), Canvas 2D, SpeechSynthesis, and SpeechRecognition (ko-KR; Chrome/Edge; needs HTTPS or localhost).
- Dark mode follows `prefers-color-scheme`.
- The `data-theme` override exists, but there is no toggle in the UI.

## Screen (index:189-254)
- **Header:** "오늘도 버티느라 고생했어요".
- **`#note`:** a supportive message (aria-live, fade transition).
- **Tab: 뽁뽁이 (`p-pop`)**
  - 48 bubbles (8 columns, 6 columns below 480px).
  - `#popCount`, `#soundBtn`.
- **Tab: 속상한 일 버리기 (`p-worry`)**
  - Dictation button `#micBtn`, TTS toggle `#ttsBtn`, textarea `#worry`, `#thrownCount`.
  - Two ways to throw the paper away: `#burnBtn` (태워 버리기) and `#crumpleBtn` (구겨서 버리기).
- **Tab: 1분 숨 고르기 (`p-breath`)**
  - `#orb`, `#cue`, `#cycles` (0 / 5), `#breathBtn`.

## JS (one IIFE, index:257-730)
- **Supportive messages**
  - The `KIND` array holds 10 messages.
  - `kind(text?)` picks one at random and never repeats the previous one.
  - Every 25 seconds, when the tab is visible, a new message is shown automatically (729).
- **Tabs (281-291):** leaving a tab calls `stopBreath()` or `stopListening()`.
- **Sound (294-373)**
  - The AudioContext `ac` is created lazily.
  - `soundOn`, `popSound()`, `softTone(freq,dur)`, `swoosh()`, `fireSound(dur)`.
- **뽁뽁이 (376-406)**
  - `N=48`, `newSheet()`, `pop(b)`.
  - Every 12 pops shows a supportive message.
  - Popping all 48 builds a new sheet after 900ms.
- **Throwing away (409-589)**
  - `throwAway(kindOf)` takes a `throwing` lock, so only one throw runs at a time.
  - Crumple: the `.crumple` CSS animation plus `swoosh`, then `finish` after 1150ms.
  - Burn: `burnPaper(done)`.
    - Canvas overlay. Each cell gets a threshold: distance to 1-2 random ignition points, plus value noise (`makeNoise`).
    - Duration `T` = 3600ms (700ms with reduced-motion).
    - Burnt cells are erased by painting them with the **panel background color**.
    - The burn front has three bands: CHAR 18, GLOW 6, SCORCH 26. Particles are flames, embers, and smoke.
  - `finish`: clears the text, shows a `REPLY` or `BURN_REPLY` message (four each, rotating), and speaks it with TTS.
- **Breathing (592-635)**
  - `PHASES`: inhale 4s (392Hz), hold 2s, exhale 6s (294Hz).
  - One cycle is 12s, and 5 cycles take 1 minute.
- **TTS (638-661)**
  - `ttsOn` defaults to on.
  - `koVoice()` prefers Heami, SunHi, Yuna, or Google voices.
  - Rate 0.92.
- **Dictation (664-725)**
  - continuous + interim results.
  - `onend` restarts recognition automatically while `wantListen` is true.
  - Separate messages for each error type.

## Gotchas
- The 25-second supportive-message timer can overwrite a throw reply or a breathing reply.
- Turning sound off also mutes the breathing tones.
- Switching the theme while the paper is burning makes the erase color not match the background.
- Switching tabs does not cancel a burn in progress.
- After a `no-speech` error, recognition keeps restarting in a loop.
