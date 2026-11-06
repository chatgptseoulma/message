// Characterization tests for C:\2026CC\wake-alarm.html ("기상 공고 알람").
// Black-box: DOM ids, clicks, fake clock, localStorage "wake-flyer", stub calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp, appPath, submit } from "./helpers/html-harness.js";

const FILE = appPath("wake-alarm.html");
const KEY = "wake-flyer";

// deterministic Math.random (seeded) so problem generation is reproducible
function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function open(opts = {}) {
  const rnd = seeded(opts.seed ?? 7);
  return loadApp(FILE, { ...opts, beforeParse(w) { w.Math.random = rnd; } });
}
const text = (app, id) => app.$(id).textContent;
const visible = (app, id) => !app.$(id).hidden;

/** compute the answer to the current problem from the visible question text */
function answerFor(app) {
  const q = text(app, "q");
  const m = q.match(/^(\d+) × (\d+) \+ (\d+) = \?$/);
  if (m) return String(+m[1] * +m[2] + +m[3]);
  const t = q.match(/^“(.*)”$/);
  assert.ok(t, `unrecognized question: ${q}`);
  return t[1];
}
function answer(app, value) {
  app.setValue("ans", value);
  submit(app, "solve");
}
function solveAll(app) {
  let guard = 0;
  while (visible(app, "ring")) {
    answer(app, answerFor(app));
    if (++guard > 20) throw new Error("too many problems");
  }
}
function arm(app, time) {
  if (time) app.setValue("alarmTime", time);
  submit(app, "order");
}

test("initial screen: defaults, clock, status, strips", () => {
  const app = open();
  assert.equal(app.$("alarmTime").value, "07:00");
  assert.equal(app.$("count").value, "4");
  assert.equal(app.$("checkin").checked, true);
  assert.equal(text(app, "status"), "발송 전입니다.");
  assert.equal(text(app, "nowTime"), "08:00");
  assert.equal(text(app, "nowSec"), ":00");
  assert.equal(app.$("stamp").hidden, true);
  assert.equal(app.$("ring").hidden, true);
  assert.equal(app.$("checkinBox").hidden, true);
  const strips = app.$("strips").querySelectorAll(".strip");
  assert.equal(strips.length, 4);
  assert.equal(strips[0].textContent, "쪽지 1일어나서 풀 것");
  assert.equal(app.storage.raw(KEY), null, "nothing saved before arming");
  app.tick(1500);
  assert.equal(text(app, "nowSec"), ":01");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("changing #count re-renders the strips", () => {
  const app = open();
  app.setValue("count", "6");
  assert.equal(app.$("strips").querySelectorAll(".strip").length, 6);
  app.setValue("count", "3");
  assert.equal(app.$("strips").querySelectorAll(".strip").length, 3);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("settings are restored from localStorage 'wake-flyer'", () => {
  const app = open({ storage: { [KEY]: { time: "06:30", count: 6, checkin: false } } });
  assert.equal(app.$("alarmTime").value, "06:30");
  assert.equal(app.$("count").value, "6");
  assert.equal(app.$("checkin").checked, false);
  assert.equal(app.$("strips").querySelectorAll(".strip").length, 6);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("corrupt saved settings are ignored", () => {
  const app = open({ storage: { [KEY]: "{not json" } });
  assert.equal(app.$("alarmTime").value, "07:00");
  assert.equal(app.$("count").value, "4");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("arming saves settings, locks the form, shows stamp and countdown (today)", () => {
  const app = open();
  app.setValue("count", "5");
  app.$("checkin").checked = false;
  arm(app, "08:05");
  assert.deepEqual(app.storage.get(KEY), { time: "08:05", count: 5, checkin: false });
  assert.equal(visible(app, "stamp"), true);
  assert.equal(text(app, "stamp"), "발송됨");
  assert.equal(text(app, "status"), "오늘 08:05 발송 완료 · 5분 0초 남음");
  for (const id of ["alarmTime", "count", "checkin", "send", "tryNow"]) assert.equal(app.$(id).disabled, true, id);
  assert.equal(app.$("preview").disabled, false, "preview is not locked while armed");
  assert.ok(app.calls.includes("AudioContext"), "audio is initialised on arm");
  assert.ok(app.calls.includes("wakeLock"), "screen wake lock requested");
  app.tick(60_000);
  assert.equal(text(app, "status"), "오늘 08:05 발송 완료 · 4분 0초 남음");
  app.tick(4 * 60_000 - 1000);
  assert.equal(text(app, "status"), "오늘 08:05 발송 완료 · 1초 남음");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("arming a time already passed today targets tomorrow", () => {
  const app = open();
  arm(app, "07:00");
  assert.equal(text(app, "status"), "내일 07:00 발송 완료 · 23시간 0분 남음");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("a time within the next second counts as tomorrow", () => {
  const app = open({ now: new Date(2026, 10, 5, 7, 59, 59, 500) });
  arm(app, "08:00");
  assert.match(text(app, "status"), /^내일 08:00 발송 완료 · 24시간 0분 남음$/);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("rings at the target time: overlay, problem 1, sound, vibrate", () => {
  const app = open();
  arm(app, "08:02");
  app.tick(2 * 60_000 - 1000);
  assert.equal(app.$("ring").hidden, true);
  app.tick(1000);
  assert.equal(visible(app, "ring"), true);
  assert.equal(text(app, "status"), "울리는 중. 쪽지를 뜯으세요.");
  assert.equal(text(app, "qCount"), "쪽지 1 / 4 · 계산해서 입력");
  assert.match(text(app, "q"), /^\d+ × \d+ \+ \d+ = \?$/);
  assert.equal(text(app, "ringSub"), "쪽지를 전부 뜯어야 꺼집니다");
  assert.ok(app.calls.includes("vibrate"));
  assert.ok(app.calls.filter(c => c === "audio.createOscillator").length > 1, "alarm tones scheduled");
  assert.equal(app.$("ans").placeholder, "답");
  assert.equal(app.$("ans").inputMode, "numeric");
  const mini = [...app.$("mini").children].map(s => s.className);
  assert.deepEqual(mini, ["cur", "", "", ""]);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("math problems follow a×b+c with documented ranges; last slip is a typing problem", () => {
  for (let seed = 1; seed <= 15; seed++) {
    const app = open({ seed });
    app.setValue("count", "6");
    app.click("tryNow");
    for (let i = 0; i < 5; i++) {
      const m = text(app, "q").match(/^(\d+) × (\d+) \+ (\d+) = \?$/);
      assert.ok(m, `slip ${i + 1} is math`);
      const [a, b, c] = [+m[1], +m[2], +m[3]];
      assert.ok(a >= 13 && a <= 49 && b >= 3 && b <= 9 && c >= 12 && c <= 98, `${a} ${b} ${c}`);
      answer(app, String(a * b + c));
    }
    assert.equal(text(app, "qCount"), "쪽지 6 / 6 · 문장을 그대로 입력");
    const t = text(app, "q").match(/^“(.*)”$/);
    assert.ok(t);
    assert.ok([
      "나는 지금 일어났고 다시 눕지 않는다",
      "이불 밖으로 나와서 물 한 잔 마신다",
      "오늘 아침은 내가 이긴다",
      "다섯 걸음 걷고 창문을 연다",
    ].includes(t[1]));
    assert.equal(app.$("ans").placeholder, "문장 입력 (붙여넣기 불가)");
    assert.equal(app.$("ans").inputMode, "text");
    assert.deepEqual(app.errors, []);
    app.close();
  }
});

test("correct answers advance the slips and update the mini tracker", () => {
  const app = open();
  app.setValue("count", "3");
  app.click("tryNow");
  answer(app, answerFor(app));
  assert.equal(text(app, "qCount"), "쪽지 2 / 3 · 계산해서 입력");
  assert.deepEqual([...app.$("mini").children].map(s => s.className), ["torn", "cur", ""]);
  assert.equal(app.$("ans").value, "", "answer cleared");
  assert.equal(text(app, "msg"), "");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("wrong answer: message, shake, problem replaced, slip index kept", () => {
  const app = open();
  app.click("tryNow");
  const before = text(app, "q");
  answer(app, "1");
  assert.equal(text(app, "msg"), "틀렸습니다. 문제가 바뀌었고 소리가 커집니다.");
  assert.ok(app.$("solve").classList.contains("shake"));
  assert.equal(text(app, "qCount"), "쪽지 1 / 4 · 계산해서 입력");
  assert.match(text(app, "q"), /^\d+ × \d+ \+ \d+ = \?$/);
  assert.notEqual(text(app, "q"), before, "new problem (with this seed)");
  assert.equal(visible(app, "ring"), true);
  // a correct answer clears the message
  answer(app, answerFor(app));
  assert.equal(text(app, "msg"), "");
  assert.equal(text(app, "qCount"), "쪽지 2 / 4 · 계산해서 입력");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("wrong typing answer replaces it with another typing problem", () => {
  const app = open();
  app.setValue("count", "3");
  app.click("tryNow");
  answer(app, answerFor(app));
  answer(app, answerFor(app));
  assert.match(text(app, "q"), /^“.*”$/);
  answer(app, "틀린 문장");
  assert.equal(text(app, "msg"), "틀렸습니다. 문제가 바뀌었고 소리가 커집니다.");
  assert.match(text(app, "q"), /^“.*”$/);
  assert.equal(text(app, "qCount"), "쪽지 3 / 3 · 문장을 그대로 입력");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("typing answer tolerates extra/collapsed whitespace", () => {
  const app = open();
  app.setValue("count", "3");
  app.click("tryNow");
  answer(app, answerFor(app));
  answer(app, answerFor(app));
  const phrase = answerFor(app);
  answer(app, "   " + phrase.split(" ").join("    ") + "  ");
  assert.equal(app.$("ring").hidden, true, "solved");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("paste and drop are blocked on the answer field", () => {
  const app = open();
  app.click("tryNow");
  const paste = new app.window.Event("paste", { bubbles: true, cancelable: true });
  assert.equal(app.$("ans").dispatchEvent(paste), false);
  assert.equal(paste.defaultPrevented, true);
  const drop = new app.window.Event("drop", { bubbles: true, cancelable: true });
  assert.equal(app.$("ans").dispatchEvent(drop), false);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("tryNow (test mode): no check-in, finishes with trial message", () => {
  const app = open();
  assert.equal(app.$("checkin").checked, true);
  app.click("tryNow");
  assert.equal(visible(app, "ring"), true);
  assert.equal(text(app, "status"), "울리는 중. 쪽지를 뜯으세요.");
  solveAll(app);
  assert.equal(app.$("ring").hidden, true);
  assert.equal(text(app, "status"), "체험 끝. 실제 알람은 시각을 정하고 발송하세요.");
  assert.equal(text(app, "send"), "다시 발송하기");
  app.tick(4 * 60_000);
  assert.equal(app.$("checkinBox").hidden, true, "no check-in after a test ring");
  assert.equal(app.storage.raw(KEY), null, "tryNow does not save settings");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("quirk: after a tryNow test the stamp shows '기상 완료'", () => {
  // documented gotcha: finish() is shared by test mode, so the stamp says "기상 완료" after a mere trial
  const app = open();
  app.click("tryNow");
  solveAll(app);
  assert.equal(visible(app, "stamp"), true);
  assert.equal(text(app, "stamp"), "기상 완료");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("real alarm without check-in: finishes immediately after solving", () => {
  const app = open();
  app.$("checkin").checked = false;
  arm(app, "08:01");
  app.tick(60_000);
  assert.equal(visible(app, "ring"), true);
  solveAll(app);
  assert.equal(text(app, "status"), "오늘 기상 완료. 내일 것도 발송하려면 다시 누르세요.");
  assert.equal(text(app, "stamp"), "기상 완료");
  assert.equal(text(app, "send"), "다시 발송하기");
  for (const id of ["alarmTime", "count", "checkin", "send", "tryNow"]) assert.equal(app.$(id).disabled, false, id);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("check-in flow: 3 minutes later asks, button confirms", () => {
  const app = open();
  arm(app, "08:01");
  app.tick(60_000);
  solveAll(app);
  assert.equal(app.$("ring").hidden, true);
  assert.equal(text(app, "status"), "쪽지 완료. 3분 뒤 깨어 있는지 재확인합니다. 다시 눕지 마세요.");
  assert.equal(app.$("send").disabled, true, "form stays locked until check-in");
  app.tick(3 * 60_000 - 1000);
  assert.equal(app.$("checkinBox").hidden, true);
  const oscBefore = app.calls.filter(c => c === "audio.createOscillator").length;
  app.tick(1000);
  assert.equal(visible(app, "checkinBox"), true);
  assert.equal(text(app, "ciCount"), "60");
  app.tick(10_000);
  assert.equal(text(app, "ciCount"), "50");
  assert.ok(app.calls.filter(c => c === "audio.createOscillator").length > oscBefore, "soft beeps");
  app.click("ciBtn");
  assert.equal(app.$("checkinBox").hidden, true);
  assert.equal(text(app, "status"), "기상 확인 완료. 좋은 아침입니다.");
  assert.equal(text(app, "stamp"), "기상 완료");
  assert.equal(app.$("send").disabled, false);
  app.tick(120_000);
  assert.equal(app.$("ring").hidden, true, "no re-ring after confirming");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("check-in timeout: no response in 60 s rings again with new sub text", () => {
  const app = open();
  arm(app, "08:01");
  app.tick(60_000);
  solveAll(app);
  app.tick(3 * 60_000);
  assert.equal(visible(app, "checkinBox"), true);
  app.tick(59_500);
  assert.equal(app.$("ring").hidden, true);
  assert.equal(text(app, "ciCount"), "1");
  app.tick(500);
  assert.equal(app.$("checkinBox").hidden, true);
  assert.equal(visible(app, "ring"), true);
  assert.equal(text(app, "ringSub"), "재확인에 응답이 없어 다시 울립니다");
  assert.equal(text(app, "qCount"), "쪽지 1 / 4 · 계산해서 입력");
  assert.equal(text(app, "status"), "울리는 중. 쪽지를 뜯으세요.");
  // solving the re-ring schedules another check-in (check-in still on, not testing)
  solveAll(app);
  assert.equal(text(app, "status"), "쪽지 완료. 3분 뒤 깨어 있는지 재확인합니다. 다시 눕지 마세요.");
  app.tick(3 * 60_000);
  assert.equal(visible(app, "checkinBox"), true);
  app.click("ciBtn");
  assert.equal(text(app, "status"), "기상 확인 완료. 좋은 아침입니다.");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("quirk: #ringSub keeps the 'no response' text on later rings", () => {
  // documented gotcha: ring() never resets #ringSub
  const app = open();
  arm(app, "08:01");
  app.tick(60_000);
  solveAll(app);
  app.tick(3 * 60_000 + 60_000);
  assert.equal(text(app, "ringSub"), "재확인에 응답이 없어 다시 울립니다");
  solveAll(app);
  app.tick(3 * 60_000);
  app.click("ciBtn");
  app.click("tryNow");
  assert.equal(visible(app, "ring"), true);
  assert.equal(text(app, "ringSub"), "재확인에 응답이 없어 다시 울립니다");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("quirk: math check strips non-digits, so '2-3-4' style answers count", () => {
  // documented gotcha: v.replace(/\D/g, "") === ans
  const app = open();
  app.click("tryNow");
  const ans = answerFor(app);
  answer(app, "답:" + ans.split("").join("-"));
  assert.equal(text(app, "msg"), "");
  assert.equal(text(app, "qCount"), "쪽지 2 / 4 · 계산해서 입력");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("preview plays ~3 s of sound and re-enables itself", () => {
  const app = open();
  app.click("preview");
  assert.equal(app.$("preview").disabled, true);
  assert.ok(app.calls.includes("AudioContext"));
  app.tick(2999);
  assert.equal(app.$("preview").disabled, true);
  app.tick(1);
  assert.equal(app.$("preview").disabled, false);
  assert.equal(app.$("ring").hidden, true);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("re-arming after finishing works and saves again", () => {
  const app = open();
  app.$("checkin").checked = false;
  arm(app, "08:01");
  app.tick(60_000);
  solveAll(app);
  arm(app, "09:00");
  assert.equal(text(app, "stamp"), "발송됨");
  assert.equal(text(app, "status"), "오늘 09:00 발송 완료 · 59분 0초 남음");
  assert.deepEqual(app.storage.get(KEY), { time: "09:00", count: 4, checkin: false });
  assert.deepEqual(app.errors, []);
  app.close();
});

test("armed state is not persisted: reload shows fresh status", () => {
  const app = open();
  arm(app, "08:05");
  const saved = app.storage.raw(KEY);
  app.close();
  const app2 = open({ storage: { [KEY]: saved } });
  assert.equal(text(app2, "status"), "발송 전입니다.");
  assert.equal(app2.$("stamp").hidden, true);
  assert.equal(app2.$("alarmTime").value, "08:05");
  app2.tick(10 * 60_000);
  assert.equal(app2.$("ring").hidden, true);
  assert.deepEqual(app2.errors, []);
  app2.close();
});
