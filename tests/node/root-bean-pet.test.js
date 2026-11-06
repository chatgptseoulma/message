// Characterization tests for C:\2026CC\콩알이키우기.html ("콩알이 키우기").
// Black-box: key buttons, fake clock, Math.random control, localStorage "bean-pet-v1".
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp, appPath, submit } from "./helpers/html-harness.js";

const FILE = appPath("콩알이키우기.html");
const KEY = "bean-pet-v1";
const NOW = new Date(2026, 10, 5, 8, 0, 0).getTime();
const MIN = 60_000;

/** a saved pet (baby by default) whose lastTick is "now" so no catch-up happens */
const pet = (o = {}) => ({
  name: "", stage: "baby", form: "", ageMin: 5,
  hunger: 80, happy: 80, clean: 100, energy: 100,
  sick: false, sickMin: 0, zeroMin: 0, poops: 0, poopIn: 45,
  asleep: false, weight: 5, mistakes: 0, gone: false,
  lastTick: NOW, speed: 1, ...o,
});
/** open the app; Math.random is controllable through app.rng.fn (default constant 0.5) */
function open(opts = {}) {
  const rng = { fn: () => 0.5 };
  const app = loadApp(FILE, {
    now: NOW, ...opts,
    beforeParse(w) { w.Math.random = () => rng.fn(); opts.beforeParse?.(w); },
  });
  app.rng = rng;
  return app;
}
const withPet = (o, opts = {}) => open({ ...opts, storage: { [KEY]: pet(o) } });
const text = (app, id) => app.$(id).textContent;
const st = app => app.storage.get(KEY);
const near = (actual, expected, eps = 1e-6, msg) => assert.ok(Math.abs(actual - expected) < eps, `${msg ?? ""} expected ~${expected}, got ${actual}`);
const meters = app => [...app.$("meters").querySelectorAll(".meter")].map(m => ({
  name: m.firstElementChild.textContent,
  on: m.querySelectorAll("i.on").length,
  low: m.classList.contains("low"),
}));

test("fresh start: egg, default facts, saved state shape", () => {
  const app = open();
  assert.equal(text(app, "say"), "콩 하나가 굴러왔어요. 아무 버튼이나 세 번 눌러 깨워 보세요.");
  assert.equal(text(app, "petName"), "아직 이름 없는 콩");
  assert.equal(text(app, "fStage"), "콩 (알)");
  assert.equal(text(app, "fAge"), "0분");
  assert.equal(text(app, "fWeight"), "5g");
  assert.equal(text(app, "fMiss"), "0번");
  assert.equal(text(app, "alert"), "");
  assert.equal(text(app, "clock"), "08:00");
  assert.equal(text(app, "kLight"), "불 끄기");
  assert.equal(app.$("nameForm").hidden, true);
  assert.equal(app.$("speed").value, "1");
  assert.deepEqual(meters(app), [
    { name: "배부름", on: 4, low: false }, { name: "기분", on: 4, low: false },
    { name: "청결", on: 5, low: false }, { name: "체력", on: 5, low: false },
  ]);
  assert.deepEqual(st(app), {
    name: "", stage: "egg", form: "", ageMin: 0, hunger: 80, happy: 80, clean: 100, energy: 100,
    sick: false, sickMin: 0, zeroMin: 0, poops: 0, poopIn: 45, asleep: false, weight: 5,
    mistakes: 0, gone: false, lastTick: NOW, speed: 1,
  });
  assert.ok(app.calls.some(c => c.startsWith("canvas")), "LCD is drawn");
  assert.ok(!app.calls.includes("AudioContext"), "no sound in this app");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("egg hatches after 3 taps of any key; the tapped action itself is not applied", () => {
  const app = open();
  app.click("kFeed");
  assert.equal(text(app, "say"), "톡톡. 콩이 꿈틀거려요. (1/3)");
  assert.equal(st(app).eggTaps, 1);
  app.click("kLight");
  assert.equal(text(app, "say"), "톡톡. 콩이 꿈틀거려요. (2/3)");
  assert.equal(text(app, "kLight"), "불 끄기", "light did not toggle on an egg");
  app.click("kPlay");
  assert.equal(text(app, "say"), "콩이 톡 하고 갈라졌어요! 이름을 지어 주세요.");
  const s = st(app);
  assert.equal(s.stage, "baby");
  assert.equal(s.ageMin, 1);
  assert.equal(s.eggTaps, 3);
  assert.equal(s.hunger, 80);
  assert.equal(s.energy, 100, "play not started");
  assert.equal(app.$("gameKeys").hidden, true);
  assert.equal(text(app, "fStage"), "아기 콩");
  assert.equal(text(app, "petName"), "콩알이");
  assert.equal(app.$("nameForm").hidden, false);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("egg hatches by itself after one minute of live time", () => {
  const app = open();
  app.tick(59_000);
  assert.equal(st(app).stage, "egg");
  app.tick(2_000);
  assert.equal(st(app).stage, "baby");
  assert.equal(text(app, "say"), "콩이 톡 하고 갈라졌어요! 이름을 지어 주세요.");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("naming the pet", () => {
  const app = withPet({});
  assert.equal(app.$("nameForm").hidden, false);
  app.setValue("nameInput", "  두부  ");
  submit(app, "nameForm");
  assert.equal(st(app).name, "두부");
  assert.equal(text(app, "petName"), "두부");
  assert.equal(text(app, "say"), "반가워요, 두부!");
  assert.equal(app.$("nameForm").hidden, true);
  // blank names are ignored
  const app2 = withPet({});
  app2.setValue("nameInput", "   ");
  submit(app2, "nameForm");
  assert.equal(st(app2).name, "");
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app2.errors, []);
  app.close(); app2.close();
});

test("greeting on return within 10 minutes", () => {
  const app = withPet({ name: "두부", lastTick: NOW - 5 * MIN });
  assert.equal(text(app, "say"), "두부가 반겨요.");
  near(st(app).ageMin, 10);
  assert.equal(st(app).lastTick, NOW);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("quirk: subject particle '가' is hard-coded even after a final consonant", () => {
  // documented gotcha: "콩가 반겨요" instead of "콩이 반겨요"
  const app = withPet({ name: "콩" });
  assert.equal(text(app, "say"), "콩가 반겨요.");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("밥: hunger +30 and weight +1; refused when already full", () => {
  const app = withPet({ hunger: 50 });
  app.click("kFeed");
  assert.equal(text(app, "say"), "냠냠. 맛있게 먹었어요.");
  assert.equal(st(app).hunger, 80);
  assert.equal(st(app).weight, 6);
  assert.equal(text(app, "fWeight"), "6g");
  app.click("kFeed");
  assert.equal(st(app).hunger, 100, "clamped at 100");
  app.click("kFeed");
  assert.equal(text(app, "say"), "배불러서 고개를 돌려요.");
  assert.equal(st(app).weight, 7);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("간식: happy +20, hunger +5, weight +2; chubby message above 30 g", () => {
  const app = withPet({ happy: 40, hunger: 50 });
  app.click("kSnack");
  assert.equal(text(app, "say"), "간식이다! 신났어요.");
  assert.deepEqual([st(app).happy, st(app).hunger, st(app).weight], [60, 55, 7]);
  const fat = withPet({ weight: 29 });
  fat.click("kSnack");
  assert.equal(text(fat, "say"), "좋아하긴 하는데 너무 통통해졌어요.");
  assert.equal(st(fat).weight, 31);
  assert.equal(st(fat).happy, 100);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(fat.errors, []);
  app.close(); fat.close();
});

test("청소: clears poops and restores clean; 'already clean' otherwise", () => {
  const app = withPet({ poops: 3, clean: 40 });
  assert.equal(text(app, "alert"), "똥 3개");
  app.click("kClean");
  assert.equal(text(app, "say"), "반짝반짝 깨끗해졌어요.");
  assert.equal(st(app).poops, 0);
  assert.equal(st(app).clean, 100);
  assert.equal(text(app, "alert"), "");
  app.click("kClean");
  assert.equal(text(app, "say"), "이미 깨끗해요.");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("약: cures sickness; when healthy it costs 10 happy", () => {
  const app = withPet({ sick: true, sickMin: 30, happy: 50 });
  assert.equal(text(app, "alert"), "아파요, 약이 필요해요");
  app.click("kMed");
  assert.equal(text(app, "say"), "약을 먹고 나았어요.");
  assert.equal(st(app).sick, false);
  assert.equal(st(app).sickMin, 0);
  app.click("kMed");
  assert.equal(text(app, "say"), "아프지도 않은데 약은 싫대요.");
  assert.equal(st(app).happy, 40);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("불: sleep toggle; actions blocked while asleep; grumpy when woken early", () => {
  const app = withPet({ energy: 40, happy: 60 });
  app.click("kLight");
  assert.equal(text(app, "say"), "불을 껐어요. 콩알이가 잠들었어요.");
  assert.equal(st(app).asleep, true);
  assert.equal(text(app, "kLight"), "불 켜기");
  for (const k of ["kFeed", "kSnack", "kPlay", "kClean", "kMed"]) {
    app.click(k);
    assert.equal(text(app, "say"), "콩알이가 자고 있어요. 깨우려면 불을 켜세요.", k);
  }
  assert.equal(st(app).hunger, 80);
  app.click("kLight");
  assert.equal(text(app, "say"), "덜 잤는데 깨워서 투덜거려요.");
  assert.equal(st(app).happy, 50);
  assert.equal(st(app).asleep, false);
  const rested = withPet({ asleep: true, energy: 70 });
  rested.click("kLight");
  assert.equal(text(rested, "say"), "불을 켰어요. 일어났어요.");
  assert.equal(st(rested).happy, 80);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(rested.errors, []);
  app.close(); rested.close();
});

test("live simulation at ×1: awake per-minute rates", () => {
  const app = withPet({});
  app.tick(MIN);
  const s = st(app);
  near(s.hunger, 80 - 0.35, 1e-6, "hunger");
  near(s.happy, 80 - 0.3, 1e-6, "happy");
  near(s.energy, 100 - 0.22, 1e-6, "energy");
  near(s.clean, 100 - 0.08, 1e-6, "clean");
  near(s.ageMin, 6, 1e-6, "age");
  near(s.poopIn, 44, 1e-6, "poopIn");
  assert.equal(s.lastTick, NOW + MIN);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("live simulation: asleep rates, poop and sickness penalties", () => {
  const sleep = withPet({ asleep: true, energy: 50 });
  sleep.tick(MIN);
  let s = st(sleep);
  near(s.hunger, 80 - 0.12); near(s.happy, 80 - 0.04); near(s.energy, 51); near(s.clean, 100 - 0.03);
  near(s.poopIn, 45, 1e-9, "poop timer paused while asleep");
  const dirty = withPet({ poops: 2, sick: true, energy: 50, happy: 50, clean: 90 });
  dirty.tick(MIN);
  s = st(dirty);
  near(s.happy, 50 - 0.3 - 0.4 - 2 * 0.05, 1e-6, "happy");
  near(s.energy, 50 - 0.22 - 0.2, 1e-6, "energy");
  near(s.clean, 90 - 0.08 - 2 * 0.25, 1e-6, "clean");
  near(s.sickMin, 1, 1e-6, "sickMin");
  assert.deepEqual(sleep.errors, []);
  assert.deepEqual(dirty.errors, []);
  sleep.close(); dirty.close();
});

test("speed setting ×60 is saved, restored and accelerates the live loop", () => {
  const app = withPet({});
  app.setValue("speed", "60");
  assert.equal(st(app).speed, 60);
  app.tick(1000);
  near(st(app).hunger, 80 - 0.35, 1e-6);
  near(st(app).ageMin, 6, 1e-6);
  app.close();
  const again = withPet({ speed: 10 });
  assert.equal(again.$("speed").value, "10");
  again.tick(6000);
  near(st(again).ageMin, 6, 1e-6);
  assert.deepEqual(again.errors, []);
  again.close();
});

test("speed applies only while visible: hidden tab runs at ×1", () => {
  const app = withPet({ speed: 60 }, {
    visible: false,
    beforeParse(w) {
      Object.defineProperty(w.document, "visibilityState", { get: () => "hidden", configurable: true });
      Object.defineProperty(w.document, "hidden", { get: () => true, configurable: true });
    },
  });
  app.tick(1000);
  near(st(app).ageMin, 5 + 1 / 60, 1e-6);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("poop appears when the timer runs out, with message and alert", () => {
  const app = withPet({ poopIn: 0.5, speed: 60 });
  app.tick(1000);
  const s = st(app);
  assert.equal(s.poops, 1);
  near(s.poopIn, 35 + 0.5 * 25, 1e-9, "next poop in 35-60 min (random 0.5)");
  assert.equal(text(app, "say"), "콩알이가 똥을 쌌어요. 청소해 주세요.");
  assert.equal(text(app, "alert"), "똥 1개");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("poops are capped at 4", () => {
  const app = withPet({ poops: 4, poopIn: 0.5, speed: 60 });
  app.tick(1000);
  assert.equal(st(app).poops, 4);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("sickness: only when dirty or starving, with probability 0.015*m", () => {
  const app = withPet({ clean: 10, speed: 60 });
  app.rng.fn = () => 0.02; // > 0.015 -> no sickness
  app.tick(1000);
  assert.equal(st(app).sick, false);
  app.rng.fn = () => 0.01; // < 0.015 -> sick
  app.tick(1000);
  assert.equal(st(app).sick, true);
  assert.equal(text(app, "say"), "콩알이가 아파요. 약을 주세요.");
  assert.match(text(app, "alert"), /^아파요, 약이 필요해요/);
  const clean = withPet({ speed: 60 });
  clean.rng.fn = () => 0;
  clean.tick(3000);
  assert.equal(st(clean).sick, false, "healthy conditions never get sick");
  assert.deepEqual(app.errors, []);
  assert.deepEqual(clean.errors, []);
  app.close(); clean.close();
});

test("sleep: wakes up by itself at full energy", () => {
  const app = withPet({ asleep: true, energy: 99.5, speed: 60 });
  app.tick(1000);
  assert.equal(st(app).asleep, false);
  assert.equal(st(app).energy, 100);
  assert.equal(text(app, "say"), "콩알이가 푹 자고 일어났어요.");
  assert.equal(text(app, "kLight"), "불 끄기");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("collapse from exhaustion falls asleep and counts a mistake", () => {
  const app = withPet({ energy: 0.1, speed: 60 });
  app.tick(1000);
  assert.equal(st(app).asleep, true);
  assert.equal(st(app).mistakes, 1);
  assert.equal(text(app, "say"), "콩알이가 지쳐서 쓰러져 잠들었어요.");
  assert.equal(text(app, "fMiss"), "1번");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("a stat reaching 0 counts a mistake once", () => {
  const app = withPet({ hunger: 0.2, happy: 0.2, speed: 60 });
  app.tick(1000);
  assert.equal(st(app).hunger, 0);
  assert.equal(st(app).mistakes, 2);
  app.tick(1000);
  assert.equal(st(app).mistakes, 2, "staying at 0 is not another mistake");
  near(st(app).zeroMin, 2, 1e-6);
  assert.match(text(app, "alert"), /배고파요 · 심심해요/);
  assert.deepEqual(meters(app).slice(0, 2), [{ name: "배부름", on: 0, low: true }, { name: "기분", on: 0, low: true }]);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("stages: baby -> child at 30 min, child -> adult (bloom / droop) at 240", () => {
  const a = withPet({ ageMin: 29.5, speed: 60 });
  a.tick(1000);
  assert.equal(st(a).stage, "child");
  assert.equal(text(a, "fStage"), "떡잎 콩");
  assert.equal(text(a, "say"), "콩알이에게 떡잎이 났어요!");
  const b = withPet({ stage: "child", ageMin: 239.5, mistakes: 3, speed: 60 });
  b.tick(1000);
  assert.equal(st(b).stage, "adult");
  assert.equal(st(b).form, "bloom");
  assert.equal(text(b, "fStage"), "꽃 핀 콩");
  assert.equal(text(b, "say"), "콩알이가 꽃을 피웠어요! 잘 키우셨네요.");
  const c = withPet({ stage: "child", ageMin: 239.5, mistakes: 4, speed: 60 });
  c.tick(1000);
  assert.equal(st(c).form, "droop");
  assert.equal(text(c, "fStage"), "시든 잎 콩");
  assert.equal(text(c, "say"), "콩알이가 어른이 됐지만 잎이 시들었어요.");
  for (const x of [a, b, c]) { assert.deepEqual(x.errors, []); x.close(); }
});

test("age display formats minutes, hours and days", () => {
  const a = withPet({ ageMin: 59.9 });
  assert.equal(text(a, "fAge"), "59분");
  const b = withPet({ stage: "child", ageMin: 125 });
  assert.equal(text(b, "fAge"), "2시간 5분");
  const c = withPet({ stage: "adult", form: "bloom", ageMin: 1440 * 2 + 190 });
  assert.equal(text(c, "fAge"), "2일 3시간");
  for (const x of [a, b, c]) { assert.deepEqual(x.errors, []); x.close(); }
});

test("leaving: more than 720 sick minutes -> gone; care is refused", () => {
  const app = withPet({ sick: true, sickMin: 719.5, speed: 60 });
  app.tick(1000);
  assert.equal(st(app).gone, true);
  assert.equal(text(app, "say"), "콩알이가 더 좋은 화분을 찾아 떠났어요.");
  assert.equal(text(app, "fStage"), "떠남");
  assert.equal(text(app, "alert"), "");
  for (const k of ["kFeed", "kLight", "kPlay"]) {
    app.click(k);
    assert.equal(text(app, "say"), "떠난 뒤에는 돌볼 수 없어요. 새 콩으로 다시 시작해 주세요.", k);
  }
  const age = st(app).ageMin;
  app.tick(1000);
  assert.ok(st(app).ageMin > age, "age still accumulates after leaving");
  assert.equal(meters(app).some(m => m.low), false, "no low meters when gone");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("leaving: more than 720 minutes at hunger 0", () => {
  const app = withPet({ hunger: 0, zeroMin: 720, speed: 60 });
  app.tick(1000);
  assert.equal(st(app).gone, true);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("offline catch-up: 2 hours away summary with poops", () => {
  const app = withPet({ ageMin: 10, lastTick: NOW - 120 * MIN });
  const s = st(app);
  assert.equal(text(app, "say"), "2시간 0분 동안 자리를 비웠어요. 똥 2개.");
  assert.equal(s.poops, 2);
  near(s.ageMin, 130, 1e-6);
  assert.equal(s.stage, "child", "stage changes silently during catch-up");
  near(s.hunger, 80 - 0.35 * 120, 1e-6);
  near(s.poopIn, 20.5, 1e-6); // poops at minute 45 and 93, then 27 more minutes
  assert.equal(s.lastTick, NOW);
  assert.equal(text(app, "fStage"), "떡잎 콩");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("offline catch-up: hungry and sick notes, 'nothing happened' text", () => {
  const app = withPet({ hunger: 30, clean: 10, poopIn: 999, lastTick: NOW - 30 * MIN }, {
    beforeParse(w) { w.Math.random = () => 0.001; },
  });
  assert.equal(text(app, "say"), "30분 동안 자리를 비웠어요. 병이 남, 배고픔.");
  assert.equal(st(app).sick, true);
  const fine = withPet({ poopIn: 999, lastTick: NOW - 15 * MIN });
  assert.equal(text(fine, "say"), "15분 동안 자리를 비웠어요. 잘 지냈어요.");
  assert.deepEqual(app.errors, []);
  assert.deepEqual(fine.errors, []);
  app.close(); fine.close();
});

test("offline catch-up is capped at 48 hours; a neglected pet leaves", () => {
  const app = withPet({ ageMin: 10, lastTick: NOW - 100 * 60 * MIN });
  const s = st(app);
  assert.equal(s.gone, true);
  near(s.ageMin, 10 + 2880, 1e-6, "48 h cap");
  assert.equal(text(app, "say"), "콩알이가 떠났어요. 새 콩으로 다시 시작할 수 있어요.");
  assert.equal(text(app, "fStage"), "떠남");
  assert.equal(app.$("nameForm").hidden, true);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("offline: an egg left alone hatches silently and greets", () => {
  const app = open({ storage: { [KEY]: pet({ stage: "egg", ageMin: 0, lastTick: NOW - 5 * MIN }) } });
  assert.equal(st(app).stage, "baby");
  assert.equal(text(app, "say"), "콩알이가 반겨요.");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("quirk: live loop does not chunk elapsed time after the computer sleeps", () => {
  // documented gotcha: one step(600) instead of 1-minute chunks -> sickness chance > 1,
  // only one poop added, and stages can be skipped straight to adult.
  const app = withPet({ poopIn: 1 });
  app.clock.setSystemTime(NOW + 600 * MIN); // timers do not fire while "asleep"
  app.tick(1000);
  const s = st(app);
  assert.equal(s.poops, 1, "only one poop for 10 hours");
  assert.equal(s.sick, true, "0.015*600 > 1, so random 0.5 still triggers");
  assert.equal(s.stage, "adult", "baby -> adult in a single step");
  assert.equal(s.form, "bloom");
  assert.equal(s.mistakes, 3, "hunger, happy and collapse");
  assert.equal(s.asleep, true);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("play game: 5 wins -> big happy boost and weight -1", () => {
  const app = withPet({ happy: 50, name: "두부" });
  app.rng.fn = () => 0.1; // pet always looks left
  app.click("kPlay");
  assert.equal(st(app).energy, 92);
  assert.equal(app.$("keys").hidden, true);
  assert.equal(app.$("gameKeys").hidden, false);
  assert.equal(text(app, "say"), "두부는 어느 쪽을 볼까요? (1/5)");
  app.click("gLeft");
  assert.equal(text(app, "say"), "맞혔어요! (1승)");
  app.click("gLeft"); // ignored while the result is shown
  assert.equal(text(app, "say"), "맞혔어요! (1승)");
  app.tick(850);
  assert.equal(text(app, "say"), "어느 쪽을 볼까요? (2/5)");
  for (let r = 2; r <= 5; r++) { app.click("gLeft"); assert.equal(text(app, "say"), `맞혔어요! (${r}승)`); app.tick(850); }
  assert.equal(text(app, "say"), "5판 중 5판! 두부 기분 최고예요.");
  near(st(app).happy, 75, 0.1);
  assert.equal(st(app).weight, 4);
  assert.equal(app.$("keys").hidden, false);
  assert.equal(app.$("gameKeys").hidden, true);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("play game: losses -> small boost; arrow keys also guess", () => {
  const app = withPet({ happy: 50 });
  app.rng.fn = () => 0.9; // pet always looks right
  app.click("kPlay");
  app.click("gLeft");
  assert.equal(text(app, "say"), "오른쪽을 봤어요. 아쉬워요.");
  app.tick(850);
  // quirk: arrow keys are captured globally while a game runs (even from another field)
  app.fire("nameInput", "keydown", { key: "ArrowLeft" });
  assert.equal(text(app, "say"), "오른쪽을 봤어요. 아쉬워요.");
  app.tick(850);
  assert.equal(text(app, "say"), "어느 쪽을 볼까요? (3/5)");
  app.fire(app.document.body, "keydown", { key: "ArrowRight" });
  assert.equal(text(app, "say"), "맞혔어요! (1승)");
  app.tick(850);
  app.click("gLeft"); app.tick(850);
  app.click("gLeft"); app.tick(850);
  assert.equal(text(app, "say"), "5판 중 1판. 그래도 재밌었대요.");
  near(st(app).happy, 58, 0.1);
  assert.equal(st(app).weight, 5);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("play game: quitting gives no bonus; arrow keys ignored outside a game", () => {
  const app = withPet({ happy: 50 });
  app.rng.fn = () => 0.1;
  app.click("kPlay");
  app.click("gLeft");
  app.click("gQuit");
  assert.equal(text(app, "say"), "게임을 그만뒀어요.");
  assert.equal(app.$("gameKeys").hidden, true);
  app.tick(850);
  assert.equal(text(app, "say"), "게임을 그만뒀어요.", "pending round timer does nothing after quit");
  app.fire(app.document.body, "keydown", { key: "ArrowLeft" });
  assert.equal(text(app, "say"), "게임을 그만뒀어요.");
  near(st(app).happy, 50, 0.1);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("play game refused when tired or sick", () => {
  const tired = withPet({ energy: 14 });
  tired.click("kPlay");
  assert.equal(text(tired, "say"), "너무 피곤해서 못 놀겠대요.");
  assert.equal(tired.$("gameKeys").hidden, true);
  assert.equal(st(tired).energy, 14);
  const sick = withPet({ sick: true });
  sick.click("kPlay");
  assert.equal(text(sick, "say"), "아파서 놀 기운이 없어요.");
  assert.equal(sick.$("gameKeys").hidden, true);
  for (const x of [tired, sick]) { assert.deepEqual(x.errors, []); x.close(); }
});

test("restart: two clicks start a new egg and keep the speed", () => {
  const app = withPet({ name: "두부", stage: "child", ageMin: 100, speed: 60 });
  app.click("restart");
  assert.equal(text(app, "restart"), "한 번 더 누르면 처음부터");
  assert.equal(text(app, "restartHint"), "지금 키우는 콩알이는 사라집니다.");
  assert.equal(st(app).stage, "child");
  app.click("restart");
  const s = st(app);
  assert.equal(s.stage, "egg");
  assert.equal(s.name, "");
  assert.equal(s.ageMin, 0);
  assert.equal(s.speed, 60);
  assert.equal(text(app, "say"), "새 콩 하나가 굴러왔어요. 아무 버튼이나 세 번 눌러 깨워 보세요.");
  assert.equal(text(app, "restart"), "새 콩으로 다시 시작");
  assert.equal(text(app, "restartHint"), "");
  assert.equal(text(app, "petName"), "아직 이름 없는 콩");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("restart: also ends a running game", () => {
  const app = withPet({});
  app.click("kPlay");
  app.click("restart"); app.click("restart");
  assert.equal(app.$("gameKeys").hidden, true);
  assert.equal(app.$("keys").hidden, false);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("restart: first click expires after 4 seconds", () => {
  const app = withPet({ stage: "child", ageMin: 100 });
  app.click("restart");
  app.tick(4000);
  assert.equal(text(app, "restart"), "새 콩으로 다시 시작");
  assert.equal(text(app, "restartHint"), "");
  app.click("restart");
  assert.equal(st(app).stage, "child", "needs two clicks again");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("meters show 5 segments with ceil(v/20) lit and 'low' under 25", () => {
  const app = withPet({ hunger: 24, happy: 41, clean: 0.5, energy: 100, asleep: true });
  assert.deepEqual(meters(app), [
    { name: "배부름", on: 2, low: true }, { name: "기분", on: 3, low: false },
    { name: "청결", on: 1, low: true }, { name: "체력", on: 5, low: false },
  ]);
  assert.equal(text(app, "alert"), "배고파요");
  const sleepy = withPet({ energy: 10 });
  assert.equal(text(sleepy, "alert"), "졸려요");
  for (const x of [app, sleepy]) { assert.deepEqual(x.errors, []); x.close(); }
});

test("state is saved every second", () => {
  const app = withPet({});
  app.tick(3000);
  assert.equal(st(app).lastTick, NOW + 3000);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("corrupt storage starts fresh", () => {
  const app = open({ storage: { [KEY]: "{oops" } });
  assert.equal(st(app).stage, "egg");
  assert.equal(text(app, "fStage"), "콩 (알)");
  assert.deepEqual(app.errors, []);
  app.close();
});
