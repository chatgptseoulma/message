// Characterization tests for 타인/다이어트식단표.html ("식단 설계소").
// Black-box: drive the page via DOM + localStorage only. Expected numbers are
// computed independently below from the documented formulas (docs/타인.md).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadApp, appPath } from "./helpers/html-harness.js";

const FILE = appPath("타인", "다이어트식단표.html");
const KEY = "diet-planner-v1";

// ---------- independent model of the documented formulas ----------
const JOB = { sit: [1.2, "주로 앉아서"], light: [1.35, "가볍게 움직임"], active: [1.5, "활동적"], heavy: [1.65, "매우 활동적"] };
const STR_MET = { none: 0, light: 3.5, mod: 5, hard: 6 };
const CARDIO_MET = { none: 0, walk: 4.3, bike: 7, jog: 8.3, run: 10, hiit: 8 };
const GOALS = {
  cut_lean: { adj: -0.2, p: 2.2, fat: 0.25, l: "근육 유지 감량" },
  cut_health: { adj: -0.15, p: 1.5, fat: 0.3, l: "건강 감량" },
  maintain: { adj: 0, p: 1.6, fat: 0.28, l: "유지" },
  lean_bulk: { adj: 0.1, p: 2.0, fat: 0.25, l: "린 벌크업" },
  bulk: { adj: 0.18, p: 1.8, fat: 0.25, l: "벌크업" },
};
const SLOT_SHARE = { 2: [0.45, 0.55], 3: [0.27, 0.39, 0.34], 4: [0.24, 0.33, 0.13, 0.3] };
const SLOT_NAMES = { 2: ["첫 끼", "두 번째 끼"], 3: ["아침", "점심", "저녁"], 4: ["아침", "점심", "오후 간식", "저녁"] };
const TIER_LABEL = ["~5천원", "5천~1만원", "1만~1만5천원", "1만5천~2만5천원"];
const fmt = (n) => Math.round(n).toLocaleString("ko-KR");
const num = (s) => Number(String(s).replace(/[^\d.\-−]/g, "").replace("−", "-"));

function model(u) {
  const bmr = 10 * u.weight + 6.25 * u.height - 5 * u.age + (u.sex === "m" ? 5 : -161);
  const neat = bmr * JOB[u.job][0];
  const exK = (met, min, days) => (met ? (met - 1) * u.weight * (min / 60) * days / 7 : 0);
  const strK = exK(STR_MET[u.str], u.strMin, u.strDays);
  const carK = exK(CARDIO_MET[u.cardio], u.cardioMin, u.cardioDays);
  const tdee = neat + strK + carK;
  const g = GOALS[u.goal];
  let kcal = tdee * (1 + g.adj);
  const floor = Math.max(bmr, u.sex === "m" ? 1500 : 1200);
  let floored = false;
  if (g.adj < 0 && kcal < floor) { kcal = floor; floored = true; }
  kcal = Math.round(kcal / 10) * 10;
  const h = u.height / 100, bmi = u.weight / (h * h);
  const refW = bmi > 25 ? 25 * h * h : u.weight;
  const pRaw = refW * g.p, pCap = kcal * 0.35 / 4;
  const pCapped = pRaw > pCap;
  const p = Math.min(pRaw, pCap);
  const f = Math.max(kcal * g.fat, 0.6 * refW * 9) / 9;
  const c = (kcal - p * 4 - f * 9) / 4;
  return { bmr, neat, strK, carK, tdee, kcal, floored, bmi, refW, pCapped, p: Math.round(p), f: Math.round(f), c: Math.round(c),
    weekly: (kcal - tdee) * 7 / 7700, water: u.weight * 0.033, g };
}

const DEFAULT_U = { sex: "m", age: 32, height: 175, weight: 78, job: "sit", str: "mod", strMin: 60, strDays: 3,
  cardio: "walk", cardioMin: 30, cardioDays: 2, goal: "cut_lean", meals: 3 };

function setUser(app, u) {
  app.click(`sex-${u.sex}`);
  app.setValue("age", u.age); app.setValue("height", u.height); app.setValue("weight", u.weight);
  app.click(`job-${u.job}`);
  app.click(`str-${u.str}`); app.setValue("str-min", u.strMin); app.setValue("str-days", u.strDays);
  app.click(`cardio-${u.cardio}`); app.setValue("cardio-min", u.cardioMin); app.setValue("cardio-days", u.cardioDays);
  app.click(`goal-${u.goal}`); app.click(`meals-${u.meals}`);
}

const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
const calcRows = (app) => [...app.document.querySelectorAll("#calc ol li")].map((li) => [...li.children].map(text));
const cards = (app) => [...app.document.querySelectorAll("#meals .meal")].map((m) => ({
  el: m,
  slot: text(m.querySelector(".slot b")),
  head: text(m.querySelector(".slot span")),
  name: text(m.querySelector(".info h3")),
  price: text(m.querySelector(".tag.price")),
  pill: m.querySelector(".pill"),
  mac: [...m.querySelectorAll(".mac b")].map((b) => num(b.firstChild.textContent)),
  adj: [...m.querySelectorAll(".adj li")].map(text),
  alts: [...m.querySelectorAll(".alt")].map((b) => ({ id: b.dataset.id, slot: b.dataset.slot, name: text(b.querySelector("b")), small: text(b.querySelector("small")), el: b })),
  low: !!m.querySelector(".tag.low"),
  tags: [...m.querySelectorAll(".meta .tag")].map(text),
}));

function open(opts = {}) { return loadApp(FILE, opts); }
function done(app) { assert.deepEqual(app.errors.map((e) => e.message), []); app.close(); }

// Checks the calc panel / facts label / per-slot targets against the model.
function assertTargets(app, u) {
  const m = model(u);
  const rows = calcRows(app);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[0], ["기초대사량", `${fmt(m.bmr)} kcal`]);
  assert.deepEqual(rows[1], [`일상 활동 (${JOB[u.job][1]} ×${JOB[u.job][0]})`, `+${fmt(m.neat - m.bmr)} kcal`]);
  assert.deepEqual(rows[2], ["근력운동 (하루 평균)", `+${fmt(m.strK)} kcal`]);
  assert.deepEqual(rows[3], ["유산소 (하루 평균)", `+${fmt(m.carK)} kcal`]);
  assert.deepEqual(rows[4], ["유지 칼로리", `${fmt(m.tdee)} kcal`]);
  assert.deepEqual(rows[5], [`${m.g.l} (${m.g.adj > 0 ? "+" : ""}${Math.round(m.g.adj * 100)}%)`, `${fmt(m.kcal)} kcal`]);
  assert.deepEqual(rows[6], [`단백질 (${m.pCapped ? "열량의 35% 상한" : `${m.g.p}g × ${m.refW.toFixed(0)}kg`})`, `${fmt(m.p)} g`]);
  assert.deepEqual(rows[7], [`지방 (열량의 ${Math.round(m.f * 9 / m.kcal * 100)}%)`, `${fmt(m.f)} g`]);
  assert.deepEqual(rows[8], ["탄수화물 (나머지)", `${fmt(m.c)} g`]);
  const wk = Math.abs(m.weekly) < 0.05 ? "유지" : `주당 ${m.weekly > 0 ? "+" : "−"}${Math.abs(m.weekly).toFixed(2)} kg`;
  assert.deepEqual(rows[9], ["예상 체중 변화", wk]);

  const facts = text(app.$("facts"));
  assert.ok(facts.includes(`목표 ${fmt(m.kcal)} kcal`), facts);
  assert.ok(facts.includes(`물 약 ${m.water.toFixed(1)}L`), facts);
  assert.ok(facts.includes(`하루 ${u.meals}끼 기준`));
  const goalsShown = [...app.document.querySelectorAll("#facts .frow .g small")].map(text);
  assert.deepEqual(goalsShown, [`/ ${fmt(m.c)}g`, `/ ${fmt(m.p)}g`, `/ ${fmt(m.f)}g`]);

  const alerts = [...app.document.querySelectorAll("#calc .alert")].map(text);
  assert.equal(alerts.some((a) => a.startsWith("계산상 목표가 기초대사량")), m.floored, "floor alert");
  assert.equal(alerts.some((a) => a.startsWith("BMI가 25를 넘어")), m.bmi > 25, "bmi alert");
  if (m.bmi > 25) assert.ok(alerts.some((a) => a.includes(`(${m.refW.toFixed(1)}kg)`)));
  assert.equal(alerts.some((a) => a.startsWith("탄수화물이 하루 120g 아래")), m.c < 120, "carb alert");

  const cs = cards(app);
  assert.equal(cs.length, u.meals);
  cs.forEach((c, i) => {
    const s = SLOT_SHARE[u.meals][i];
    assert.equal(c.slot, SLOT_NAMES[u.meals][i]);
    assert.ok(c.head.includes(`목표 ${fmt(m.kcal * s)} kcal · 단백질 ${fmt(m.p * s)}g`), c.head);
  });
  return m;
}

// Structural invariants of the meal plan.
function assertPlanInvariants(app, u, m = model(u)) {
  const cs = cards(app);
  assert.equal(cs.length, u.meals);
  let k = 0, c = 0, p = 0, f = 0, price = 0;
  cs.forEach((card, i) => {
    assert.ok(card.name.length > 0);
    assert.match(card.price, /^약 ₩[\d,]+$/);
    assert.equal(card.mac.length, 4);
    k += card.mac[0]; c += card.mac[1]; p += card.mac[2]; f += card.mac[3];
    price += num(card.price);
    // fit pill classification
    const T = m.kcal * SLOT_SHARE[u.meals][i];
    const d = (card.mac[0] - T) / T;
    const cls = Math.abs(d) <= 0.08 ? "good" : Math.abs(d) <= 0.15 ? "near" : "off";
    assert.ok(card.pill.classList.contains(cls), `pill ${cls} for d=${d}`);
    if (cls === "good") assert.equal(text(card.pill), "목표에 맞음");
    else assert.equal(text(card.pill), `목표 ${d > 0 ? "+" : ""}${Math.round(d * 100)}%`);
    // alternatives: up to 3, none equals chosen dish, all point to this slot
    assert.ok(card.alts.length <= 3);
    for (const a of card.alts) { assert.notEqual(a.name, card.name); assert.equal(a.slot, String(i)); assert.match(a.small, /^[\d,]+ kcal · ₩[\d,]+$/); }
    // adjustments list starts with the base portion when present
    if (card.adj.length) assert.ok(card.adj[0].startsWith("=기본 1인분"));
  });
  const sum = text(app.document.querySelector(".day-sum"));
  assert.ok(sum.includes(`${fmt(k)} kcal`), sum);
  assert.ok(sum.includes(`식비 약 ₩${price.toLocaleString("ko-KR")}`), sum);
  const [, sc, sp, sf] = sum.match(/탄 ([\d,]+)g · 단 ([\d,]+)g · 지 ([\d,]+)g/).map(num);
  assert.ok(Math.abs(sc - c) <= u.meals, `carbs ${sc} vs ${c}`);
  assert.ok(Math.abs(sp - p) <= u.meals, `protein ${sp} vs ${p}`);
  assert.ok(Math.abs(sf - f) <= u.meals, `fat ${sf} vs ${f}`);
  assert.equal(num(text(app.document.querySelector(".facts-kcal b"))), k);
}

// ---------- tests ----------
describe("diet: targets from formulas", () => {
  test("default scenario (male, BMI>25, cut_lean, protein cap) matches model and snapshot", () => {
    const app = open();
    const m = assertTargets(app, DEFAULT_U);
    assertPlanInvariants(app, DEFAULT_U, m);
    // snapshot of the displayed numbers
    assert.deepEqual(calcRows(app).map((r) => r[1]), ["1,719 kcal", "+344 kcal", "+134 kcal", "+37 kcal", "2,233 kcal", "1,790 kcal", "157 g", "50 g", "179 g", "주당 −0.40 kg"]);
    assert.equal(app.$("bmi").textContent, "25.5");
    assert.equal(app.$("bmi-tag").textContent, "비만");
    assert.ok(m.pCapped && m.bmi > 25);
    done(app);
  });

  const scenarios = [
    ["female maintain, jog, no strength", { sex: "f", age: 28, height: 162, weight: 55, job: "light", str: "none", strMin: 60, strDays: 3, cardio: "jog", cardioMin: 40, cardioDays: 3, goal: "maintain", meals: 3 }],
    ["female cut_lean hits 1200 floor", { sex: "f", age: 60, height: 150, weight: 45, job: "sit", str: "none", strMin: 60, strDays: 3, cardio: "none", cardioMin: 30, cardioDays: 2, goal: "cut_lean", meals: 3 }],
    ["male cut_health hits 1500 floor", { sex: "m", age: 70, height: 160, weight: 50, job: "sit", str: "none", strMin: 60, strDays: 3, cardio: "none", cardioMin: 30, cardioDays: 2, goal: "cut_health", meals: 2 }],
    ["male bulk, heavy job, hard strength, run", { sex: "m", age: 25, height: 180, weight: 70, job: "heavy", str: "hard", strMin: 90, strDays: 5, cardio: "run", cardioMin: 45, cardioDays: 3, goal: "bulk", meals: 4 }],
    ["female lean_bulk BMI>25 refW", { sex: "f", age: 40, height: 168, weight: 90, job: "active", str: "light", strMin: 30, strDays: 2, cardio: "bike", cardioMin: 60, cardioDays: 4, goal: "lean_bulk", meals: 3 }],
    ["male cut_health hiit", { sex: "m", age: 45, height: 172, weight: 72, job: "light", str: "mod", strMin: 45, strDays: 2, cardio: "hiit", cardioMin: 20, cardioDays: 3, goal: "cut_health", meals: 4 }],
    ["male maintain 2 meals", { sex: "m", age: 50, height: 170, weight: 68, job: "active", str: "none", strMin: 60, strDays: 3, cardio: "walk", cardioMin: 60, cardioDays: 7, goal: "maintain", meals: 2 }],
  ];
  for (const [name, u] of scenarios) {
    test(`scenario: ${name}`, () => {
      const app = open();
      setUser(app, u);
      const m = assertTargets(app, u);
      assertPlanInvariants(app, u, m);
      done(app);
    });
  }

  test("floor scenarios really are floored (sanity on model)", () => {
    assert.equal(model(scenarios[1][1]).kcal, 1200);
    assert.equal(model(scenarios[2][1]).kcal, 1500);
  });

  test("quirk: floor alert always says 'raised to BMR' even when the 1200 floor applied", () => {
    // Known bug: kcal is raised to max(BMR, 1200/1500) but the message names BMR.
    const app = open();
    const u = scenarios[1][1];
    setUser(app, u);
    const m = model(u);
    assert.ok(m.bmr < 1200);
    const alert = text(app.document.querySelector("#calc .alert"));
    assert.equal(alert, `계산상 목표가 기초대사량(${fmt(m.bmr)} kcal)보다 낮아, 기초대사량 수준으로 올려 잡았습니다. 더 줄이기보다 활동량을 늘리는 쪽을 권합니다.`);
    assert.equal(calcRows(app)[5][1], "1,200 kcal");
    done(app);
  });

  test("BMI exactly 25.0 is tagged 비만 but uses actual weight (no refW alert)", () => {
    const app = open();
    const u = { ...DEFAULT_U, height: 200, weight: 100, goal: "maintain" };
    setUser(app, u);
    assert.equal(app.$("bmi").textContent, "25.0");
    assert.equal(app.$("bmi-tag").textContent, "비만");
    assertTargets(app, u);
    assert.ok(![...app.document.querySelectorAll("#calc .alert")].some((a) => a.textContent.startsWith("BMI가 25를")));
    done(app);
  });
});

describe("diet: BMI tags and auxiliary display", () => {
  test("BMI tags use Korean cutoffs 18.5 / 23 / 25", () => {
    const app = open();
    for (const [w, tag] of [[55, "저체중"], [56.7, "정상"], [65, "정상"], [70.5, "비만 전 단계"], [76.5, "비만 전 단계"], [78, "비만"]]) {
      app.setValue("weight", w);
      const bmi = w / (1.75 * 1.75);
      assert.equal(app.$("bmi").textContent, bmi.toFixed(1));
      assert.equal(app.$("bmi-tag").textContent, tag, `w=${w} bmi=${bmi}`);
    }
    done(app);
  });

  test("exercise hints, disabled rows, slider outputs, day selects, meal hint", () => {
    const app = open();
    assert.equal(app.$("str-hint").textContent, "세트 사이 1~2분 휴식, 마지막 반복이 힘든 정도 · MET 5.0");
    assert.equal(app.$("cardio-hint").textContent, "시속 6km 안팎, 말은 되지만 노래는 힘든 정도 · MET 4.3");
    assert.equal(app.$("str-row").getAttribute("aria-disabled"), "false");
    assert.equal(app.$("str-min-out").textContent, "60분");
    assert.equal(app.$("cardio-min-out").textContent, "30분");
    assert.deepEqual([...app.$("str-days").options].map((o) => o.textContent), [1, 2, 3, 4, 5, 6, 7].map((d) => `주 ${d}회`));
    assert.equal(app.$("str-days").value, "3");
    assert.equal(app.$("cardio-days").value, "2");
    assert.equal(app.$("meals-hint").textContent, "가장 일반적인 배분입니다. 점심을 가장 크게 둡니다.");
    app.click("str-none"); app.click("cardio-none");
    assert.equal(app.$("str-row").getAttribute("aria-disabled"), "true");
    assert.equal(app.$("cardio-row").getAttribute("aria-disabled"), "true");
    assert.equal(app.$("str-hint").textContent, "근력운동을 하지 않음");
    assert.equal(app.$("cardio-hint").textContent, "유산소를 하지 않음");
    app.setValue("str-min", 85);
    assert.equal(app.$("str-min-out").textContent, "85분");
    app.click("meals-4");
    assert.ok(app.$("meals-hint").textContent.startsWith("아침·점심·간식·저녁."));
    app.click("meals-2");
    assert.ok(app.$("meals-hint").textContent.startsWith("두 끼 사이 6~7시간 간격."));
    done(app);
  });

  test("out-of-range inputs are clamped in calculations (input keeps raw value)", () => {
    const app = open();
    app.setValue("age", 200);
    assert.equal(app.$("age").value, "200");
    assert.equal(app.storage.get(KEY).age, 90);
    const m = model({ ...DEFAULT_U, age: 90 });
    assert.equal(calcRows(app)[0][1], `${fmt(m.bmr)} kcal`);
    app.setValue("weight", "");
    assert.equal(app.storage.get(KEY).weight, 78); // empty -> default
    done(app);
  });

  test("quirk: strength and cardio are both labeled step 4", () => {
    // Known cosmetic bug in the legends.
    const app = open();
    const steps = [...app.document.querySelectorAll("#form .step")].map((s) => s.textContent);
    assert.deepEqual(steps, ["1", "2", "3", "4", "4", "5", "6"]);
    done(app);
  });

  test("credits section hidden because there are no photos; dishes show first-letter placeholder", () => {
    const app = open();
    assert.equal(app.$("credits").hidden, true);
    assert.equal(app.$("credit-list").textContent, "사진 없이 표시 중입니다.");
    for (const c of cards(app)) {
      assert.equal(c.el.querySelector(".photo .ph").textContent, c.name.slice(0, 1));
      assert.equal(c.el.querySelector(".photo img"), null);
    }
    done(app);
  });
});

describe("diet: meal plan snapshots", () => {
  test("default plan (tier 1, 3 meals) exact dishes, add-ons and alternatives", () => {
    const app = open();
    const cs = cards(app);
    assert.deepEqual(cs.map((c) => [c.slot, c.name, c.price, text(c.pill)]), [
      ["아침", "로스트 치킨 샌드위치", "약 ₩9,500", "목표에 맞음"],
      ["점심", "닭가슴살 샐러드", "약 ₩11,100", "목표에 맞음"],
      ["저녁", "된장찌개 백반", "약 ₩10,500", "목표에 맞음"],
    ]);
    assert.deepEqual(cs.map((c) => c.mac), [[460, 36, 49, 13], [700, 62, 67, 20], [590, 63, 45, 17]]);
    assert.deepEqual(cs[0].adj, ["=기본 1인분 420 kcal · 단 28g", "+닭가슴살 100g +110 kcal · 단 +23g", "−빵 1/3 덜기 -70 kcal"]);
    assert.deepEqual(cs[1].adj, ["=기본 1인분 320 kcal · 단 35g", "+프로틴 쉐이크 1스쿱 +120 kcal · 단 +24g", "+우유 200ml +130 kcal · 단 +6g", "+고구마 1개 (150g) +130 kcal"]);
    assert.deepEqual(cs[2].adj, ["=기본 1인분 580 kcal · 단 24g", "+닭가슴살 100g +110 kcal · 단 +23g", "−밥 1/3공기 덜기 -100 kcal"]);
    assert.deepEqual(cs.map((c) => c.alts.map((a) => `${a.id}:${a.small}`)), [
      ["chicken_salad:470 kcal · ₩9,000", "kimbap:530 kcal · ₩7,000"],
      ["sandwich:680 kcal · ₩9,800", "kimbap:650 kcal · ₩8,500", "doenjang:700 kcal · ₩10,000"],
      ["chicken_salad:590 kcal · ₩10,500", "sandwich:630 kcal · ₩9,500", "bibimbap:610 kcal · ₩11,000"],
    ]);
    assert.deepEqual([...app.document.querySelector(".day-sum").children].map(text), ["하루 합계", "1,750 kcal", "탄 161g · 단 161g · 지 49g", "식비 약 ₩31,100"]);
    const facts = text(app.$("facts"));
    assert.equal(text(app.document.querySelector(".facts-kcal")).replace(/\s/g, ""), "총열량1,750kcal");
    assert.deepEqual([...app.document.querySelectorAll(".facts-sub span")].map(text), ["목표 1,790 kcal", "-40 kcal"]);
    assert.ok(facts.includes("근육 유지 감량 · 한 끼 5천~1만원"));
    assert.ok(facts.includes("하루 식비 약 ₩31,100"));
    done(app);
  });

  const tierSnap = {
    0: [["그릭요거트 그래놀라 볼", "약 ₩5,000"], ["닭가슴살 현미밥 도시락", "약 ₩6,500"], ["삼각김밥 2개 + 단백질 음료", "약 ₩6,900"]],
    2: [["로스트 치킨 샌드위치", "약 ₩9,500"], ["치킨 부리또볼", "약 ₩14,500"], ["연어 포케", "약 ₩15,000"]],
    3: [["전복죽 + 반찬", "약 ₩18,000"], ["삼계탕", "약 ₩18,000"], ["회덮밥", "약 ₩18,000"]],
  };
  for (const t of [0, 2, 3]) {
    test(`budget tier ${t} plan snapshot`, () => {
      const app = open();
      app.click(`tab-${t}`);
      assert.deepEqual(cards(app).map((c) => [c.name, c.price]), tierSnap[t]);
      assert.ok(text(app.$("facts")).includes(`한 끼 ${TIER_LABEL[t]}`));
      assertPlanInvariants(app, DEFAULT_U);
      done(app);
    });
  }

  test("tier 2 breakfast borrows cheaper dishes and tags them 아래 가격대 메뉴", () => {
    const app = open();
    app.click("tab-2");
    const b = cards(app)[0];
    assert.equal(b.low, true);
    assert.ok(b.tags.includes("아래 가격대 메뉴"));
    assert.deepEqual(b.alts.map((a) => a.id), ["chicken_salad", "kimbap", "brunch"]);
    assert.ok(!cards(app)[1].low);
    done(app);
  });

  test("tier 3 breakfast has only own-tier + borrowed alternatives", () => {
    const app = open();
    app.click("tab-3");
    assert.deepEqual(cards(app)[0].alts.map((a) => a.id), ["brunch", "omelette"]);
    done(app);
  });

  test("meal count 2 and 4 snapshots", () => {
    const app = open();
    app.click("meals-2");
    assert.deepEqual(cards(app).map((c) => [c.slot, c.name, c.price]), [["첫 끼", "된장찌개 백반", "약 ₩12,000"], ["두 번째 끼", "칼국수", "약 ₩13,800"]]);
    assertPlanInvariants(app, { ...DEFAULT_U, meals: 2 });
    app.click("meals-4");
    const cs = cards(app);
    assert.deepEqual(cs.map((c) => [c.slot, c.name, c.price]), [
      ["아침", "닭가슴살 샐러드", "약 ₩10,000"], ["점심", "로스트 치킨 샌드위치", "약 ₩9,000"],
      ["오후 간식", "프로틴 쉐이크 + 바나나", "약 ₩2,000"], ["저녁", "된장찌개 백반", "약 ₩10,500"]]);
    assert.ok(cs[2].tags.includes("간식은 가격대 무관"));
    assert.deepEqual(cs[2].alts.map((a) => a.id), ["s_yogurt", "s_egg", "s_nuts"]);
    assertPlanInvariants(app, { ...DEFAULT_U, meals: 4 });
    done(app);
  });

  test("quirk: snack price ignores the budget tier", () => {
    // Known behavior: the 4-meal snack comes from SNACKS regardless of tier.
    const app = open();
    app.click("meals-4");
    app.click("tab-3");
    const snack = cards(app)[2];
    assert.equal(snack.slot, "오후 간식");
    assert.ok(num(snack.price) < 5000, snack.price);
    assert.ok(snack.tags.includes("간식은 가격대 무관"));
    done(app);
  });
});

describe("diet: alternatives (manual picks)", () => {
  test("clicking an alternative swaps only that slot's dish", () => {
    const app = open();
    const before = cards(app).map((c) => c.name);
    const alt = cards(app)[2].alts.find((a) => a.id === "bibimbap");
    app.click(alt.el);
    const after = cards(app);
    assert.equal(after[2].name, "비빔밥");
    assert.deepEqual(after.slice(0, 2).map((c) => c.name), before.slice(0, 2));
    assert.ok(after[2].alts.some((a) => a.id === "doenjang"), "previous dish becomes an alternative");
    assertPlanInvariants(app, DEFAULT_U);
    done(app);
  });

  test("picks are per tier, survive tab switching, but are not saved to localStorage", () => {
    const app = open();
    app.click(cards(app)[2].alts.find((a) => a.id === "bibimbap").el);
    app.click("tab-2");
    assert.notEqual(cards(app)[2].name, "비빔밥");
    app.click("tab-1");
    assert.equal(cards(app)[2].name, "비빔밥");
    const saved = app.storage.get(KEY);
    assert.deepEqual(Object.keys(saved).sort(), ["age", "cardio", "cardioDays", "cardioMin", "goal", "height", "job", "meals", "sex", "str", "strDays", "strMin", "tier", "weight"]);
    const raw = app.storage.raw(KEY);
    app.close();
    const app2 = open({ storage: { [KEY]: raw } });
    assert.equal(cards(app2)[2].name, "된장찌개 백반");
    done(app2);
  });

  test("picking an earlier slot's dish displaces that dish from later slots", () => {
    const app = open();
    app.click(cards(app)[0].alts.find((a) => a.id === "chicken_salad").el);
    const cs = cards(app);
    assert.equal(cs[0].name, "닭가슴살 샐러드");
    assert.notEqual(cs[1].name, "닭가슴살 샐러드");
    done(app);
  });

  test("quirk: a manual pick can duplicate a dish used in another slot", () => {
    // Known bug: picks bypass the no-repeat rule.
    const app = open();
    app.click(cards(app)[2].alts.find((a) => a.id === "chicken_salad").el);
    const cs = cards(app);
    assert.equal(cs[1].name, "닭가슴살 샐러드");
    assert.equal(cs[2].name, "닭가슴살 샐러드");
    done(app);
  });
});

describe("diet: budget tabs", () => {
  test("clicking a tab selects it and updates panel labelling", () => {
    const app = open();
    assert.equal(app.$("tab-1").getAttribute("aria-selected"), "true");
    app.click("tab-3");
    for (const t of [0, 1, 2, 3]) {
      assert.equal(app.$(`tab-${t}`).getAttribute("aria-selected"), String(t === 3));
      assert.equal(app.$(`tab-${t}`).tabIndex, t === 3 ? 0 : -1);
    }
    assert.equal(app.$("panel").getAttribute("aria-labelledby"), "tab-3");
    assert.equal(app.storage.get(KEY).tier, 3);
    done(app);
  });

  test("ArrowRight / ArrowLeft move between tabs with wrap-around and focus", () => {
    const app = open();
    app.fire("tab-1", "keydown", { key: "ArrowRight" });
    assert.equal(app.$("tab-2").getAttribute("aria-selected"), "true");
    assert.equal(app.document.activeElement, app.$("tab-2"));
    app.fire("tab-2", "keydown", { key: "ArrowRight" });
    app.fire("tab-3", "keydown", { key: "ArrowRight" });
    assert.equal(app.$("tab-0").getAttribute("aria-selected"), "true");
    app.fire("tab-0", "keydown", { key: "ArrowLeft" });
    assert.equal(app.$("tab-3").getAttribute("aria-selected"), "true");
    assert.equal(app.document.activeElement, app.$("tab-3"));
    app.fire("tab-3", "keydown", { key: "Enter" });
    assert.equal(app.$("tab-3").getAttribute("aria-selected"), "true");
    assert.equal(app.storage.get(KEY).tier, 3);
    assert.ok(text(app.$("facts")).includes("한 끼 1만5천~2만5천원"));
    done(app);
  });
});

describe("diet: localStorage persistence", () => {
  test("defaults are saved on first render", () => {
    const app = open();
    assert.deepEqual(app.storage.get(KEY), { ...DEFAULT_U, tier: 1 });
    done(app);
  });

  test("every change is saved", () => {
    const app = open();
    app.click("sex-f"); app.setValue("age", 41); app.click("goal-bulk"); app.click("meals-2"); app.setValue("cardio-days", 6);
    const s = app.storage.get(KEY);
    assert.equal(s.sex, "f"); assert.equal(s.age, 41); assert.equal(s.goal, "bulk"); assert.equal(s.meals, 2); assert.equal(s.cardioDays, 6);
    done(app);
  });

  test("saved state is restored into the form and plan", () => {
    const saved = { sex: "f", age: 45, height: 160, weight: 60, job: "active", str: "none", strMin: 30, strDays: 2,
      cardio: "bike", cardioMin: 45, cardioDays: 5, goal: "maintain", meals: 4, tier: 3 };
    const app = open({ storage: { [KEY]: saved } });
    assert.equal(app.$("sex-f").checked, true);
    assert.equal(app.$("job-active").checked, true);
    assert.equal(app.$("str-none").checked, true);
    assert.equal(app.$("cardio-bike").checked, true);
    assert.equal(app.$("goal-maintain").checked, true);
    assert.equal(app.$("meals-4").checked, true);
    assert.equal(app.$("age").value, "45");
    assert.equal(app.$("height").value, "160");
    assert.equal(app.$("weight").value, "60");
    assert.equal(app.$("str-min").value, "30");
    assert.equal(app.$("cardio-min").value, "45");
    assert.equal(app.$("str-days").value, "2");
    assert.equal(app.$("cardio-days").value, "5");
    assert.equal(app.$("tab-3").getAttribute("aria-selected"), "true");
    assert.equal(app.$("tab-1").getAttribute("aria-selected"), "false");
    const { tier, ...u } = saved;
    assertTargets(app, u);
    assertPlanInvariants(app, u);
    assert.ok(text(app.$("facts")).includes("한 끼 1만5천~2만5천원"));
    assert.deepEqual(app.storage.get(KEY), saved);
    done(app);
  });

  test("quirk: restoring a saved tier does not update the panel's aria-labelledby", () => {
    // load() updates the tabs but not #panel; only setTier() does that.
    const app = open({ storage: { [KEY]: { tier: 2 } } });
    assert.equal(app.$("tab-2").getAttribute("aria-selected"), "true");
    assert.equal(app.$("panel").getAttribute("aria-labelledby"), "tab-1");
    done(app);
  });

  test("partial and invalid saved values fall back to defaults", () => {
    const app = open({ storage: { [KEY]: { goal: "bulk", tier: 9, sex: "x" } } });
    assert.equal(app.$("goal-bulk").checked, true);
    assert.equal(app.$("sex-m").checked, true);
    assert.equal(app.$("tab-1").getAttribute("aria-selected"), "true");
    assert.equal(app.storage.get(KEY).tier, 1);
    assertTargets(app, { ...DEFAULT_U, goal: "bulk" });
    done(app);
  });

  test("corrupt JSON in storage is ignored", () => {
    const app = open({ storage: { [KEY]: "{not json" } });
    assert.equal(app.$("goal-cut_lean").checked, true);
    assert.deepEqual(app.storage.get(KEY), { ...DEFAULT_U, tier: 1 });
    done(app);
  });
});
