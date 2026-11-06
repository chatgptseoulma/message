// Characterization tests for survey-vercel/ (Vercel functions + Supabase).
// Black-box per endpoint, against an in-memory fake Supabase (helpers/fake-supabase.js).
// Tests named "quirk: ..." pin down CURRENT behaviour that docs/survey-vercel.md lists as a
// known gotcha; if you fix the quirk on purpose, update/delete that test.
import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadApp, call, readVercelJson, appFileExists, headersFor, TEST_ENV } from "./helpers/vercel-harness.js";
import { SURVEY_SCHEMA } from "./helpers/fake-supabase.js";

const { fake, handlers: h } = await loadApp("survey", { schema: SURVEY_SCHEMA() });

beforeEach(() => fake.reset());
afterEach(() => mock.timers.reset());

const OPTIONS = {
  ranks: ["사원", "주임·대리", "과장", "차장", "부장 이상"],
  areas: ["직무 전문성", "디지털·AI·데이터", "리더십·관리", "커뮤니케이션·협업", "문서·보고서 작성", "외국어", "자기계발·건강", "기타"],
  methods: ["오프라인 집합", "실시간 온라인", "녹화 강의(이러닝)", "사내 멘토링·스터디", "외부 위탁"],
  time_slots: ["근무시간 중", "점심시간", "퇴근 후", "주말"],
  durations: ["1시간 이하", "2~4시간", "하루", "2일 이상"],
  barriers: ["업무 부담", "시간 부족", "원하는 주제 없음", "교육 정보 부족", "기타"],
};

const valid = (o = {}) => ({
  name: "홍길동", emp_no: "E1001", dept: "개발팀", rank: "사원",
  areas: ["외국어", "직무 전문성"], area_other: "", priority_topic: "",
  skill: 3, methods: ["실시간 온라인"], time_slot: "점심시간", duration: "2~4시간",
  past_sat: 4, barriers: [], barrier_other: "", comment: "", ...o,
});
const post = body => call(h.responses, { method: "POST", headers: { "content-type": "application/json" }, body });

// a complete DB row (as stored by the app) for seeding
let seq = 0;
const row = (o = {}) => ({
  emp_no: `S${++seq}`, name: "이름", dept: "개발팀", rank: "사원", areas: ["외국어"], area_other: "", priority_topic: "",
  skill: 3, methods: ["실시간 온라인"], time_slot: "점심시간", duration: "하루", past_sat: null, barriers: [],
  barrier_other: "", comment: "", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", ...o,
});

function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; i++; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const assertNoStore = r => {
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
};

describe("fake supabase wiring", () => {
  test("the app's own @supabase/supabase-js is replaced by the fake (createClient called with env)", async () => {
    const r = await post(valid());
    assert.equal(r.status, 201);
    assert.equal(fake.clients.length, 1, "db() creates exactly one client and caches it");
    assert.equal(fake.clients[0].url, TEST_ENV.SUPABASE_URL);
    assert.equal(fake.clients[0].key, TEST_ENV.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(fake.rows("responses").length, 1);
    await post(valid({ emp_no: "E2" }));
    assert.equal(fake.clients.length, 1, "client is a singleton across requests");
  });
});

describe("/api/config", () => {
  for (const method of ["GET", "POST"]) {
    test(`${method} returns OPTIONS plus max_areas=3`, async () => {
      const r = await call(h.config, { method });
      assert.equal(r.status, 200);
      assertNoStore(r);
      assert.deepEqual(r.json, { ...OPTIONS, max_areas: 3 });
    });
  }
});

describe("/api/responses", () => {
  test("new submission -> 201 {ok, updated:false}; row normalized and stored", async () => {
    const r = await post(valid({ name: "  홍길동  ", area_other: "무시됨", barrier_other: "무시됨" }));
    assert.equal(r.status, 201);
    assertNoStore(r);
    assert.deepEqual(r.json, { ok: true, updated: false });
    const [s] = fake.rows("responses");
    assert.equal(s.name, "홍길동", "trimmed");
    assert.deepEqual(s.areas, ["직무 전문성", "외국어"], "reordered to OPTIONS order");
    assert.equal(s.area_other, "", "area_other cleared when 기타 not chosen");
    assert.equal(s.barrier_other, "", "barrier_other cleared when 기타 not chosen");
    assert.equal(s.past_sat, 4);
    assert.equal(s.skill, 3);
    assert.equal(Date.parse(s.created_at), Date.parse(s.updated_at), "created_at == updated_at on first insert");
    assert.ok(Math.abs(Date.parse(s.created_at) - Date.now()) < 5000);
  });

  test("resubmit same emp_no -> 200 {ok, updated:true}; overwrites fields, keeps created_at", async () => {
    await post(valid());
    fake.raw("responses")[0].created_at = "2020-01-01T00:00:00+00:00";
    fake.raw("responses")[0].updated_at = "2020-01-01T00:00:00+00:00";
    const r = await post(valid({ name: "김철수", skill: 5 }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, updated: true });
    const rows = fake.rows("responses");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "김철수");
    assert.equal(rows[0].skill, 5);
    assert.equal(Date.parse(rows[0].created_at), Date.parse("2020-01-01T00:00:00Z"));
    assert.ok(Date.parse(rows[0].updated_at) > Date.parse("2025-01-01T00:00:00Z"));
  });

  test("body may arrive as a JSON string", async () => {
    const r = await post(JSON.stringify(valid()));
    assert.equal(r.status, 201);
  });

  test("invalid JSON string -> 400 with the SyntaxError message", async () => {
    const r = await post("{not json");
    assert.equal(r.status, 400);
    assert.equal(typeof r.json.error, "string");
    assert.ok(r.json.error.length > 0);
    assert.equal(fake.rows("responses").length, 0);
  });

  for (const body of [null, undefined, [], "[]", "null", 42]) {
    test(`non-object body ${JSON.stringify(body)} -> 400 잘못된 요청입니다.`, async () => {
      const r = await post(body);
      assert.equal(r.status, 400);
      assert.deepEqual(r.json, { error: "잘못된 요청입니다." });
    });
  }

  const long = n => "가".repeat(n);
  const cases = [
    ["name missing", { name: "" }, "이름을(를) 입력해 주세요."],
    ["name whitespace only", { name: "   " }, "이름을(를) 입력해 주세요."],
    ["name > 30", { name: long(31) }, "이름은(는) 30자 이내로 입력해 주세요."],
    ["emp_no missing", { emp_no: undefined }, "사번을(를) 입력해 주세요."],
    ["emp_no > 20", { emp_no: "A".repeat(21) }, "사번은(는) 20자 이내로 입력해 주세요."],
    ["emp_no with space", { emp_no: "A 1" }, "사번은 영문·숫자·하이픈(-)만 20자 이내로 입력해 주세요."],
    ["emp_no with hangul", { emp_no: "사번1" }, "사번은 영문·숫자·하이픈(-)만 20자 이내로 입력해 주세요."],
    ["emp_no with underscore", { emp_no: "A_1" }, "사번은 영문·숫자·하이픈(-)만 20자 이내로 입력해 주세요."],
    ["dept missing", { dept: "" }, "부서을(를) 입력해 주세요."],
    ["dept > 50", { dept: long(51) }, "부서은(는) 50자 이내로 입력해 주세요."],
    ["rank invalid", { rank: "인턴" }, "직급을(를) 선택해 주세요."],
    ["rank missing", { rank: undefined }, "직급을(를) 선택해 주세요."],
    ["areas empty", { areas: [] }, "교육 분야을(를) 1개 이상 선택해 주세요."],
    ["areas missing", { areas: undefined }, "교육 분야을(를) 1개 이상 선택해 주세요."],
    ["areas not array", { areas: "외국어" }, "교육 분야 값이 올바르지 않습니다."],
    ["areas unknown item", { areas: ["요리"] }, "교육 분야 값이 올바르지 않습니다."],
    ["areas > 3", { areas: OPTIONS.areas.slice(0, 4) }, "교육 분야은(는) 최대 3개까지 선택할 수 있습니다."],
    ["area_other > 100 (even without 기타)", { area_other: long(101) }, "기타 교육 분야은(는) 100자 이내로 입력해 주세요."],
    ["priority_topic > 100", { priority_topic: long(101) }, "우선 교육 주제은(는) 100자 이내로 입력해 주세요."],
    ["skill missing", { skill: undefined }, "직무 역량 자기평가을(를) 선택해 주세요."],
    ["skill non-numeric", { skill: "abc" }, "직무 역량 자기평가을(를) 선택해 주세요."],
    ["skill 0", { skill: 0 }, "직무 역량 자기평가은(는) 1~5 사이여야 합니다."],
    ["skill 6", { skill: "6" }, "직무 역량 자기평가은(는) 1~5 사이여야 합니다."],
    ["methods empty", { methods: [] }, "선호 교육 방식을(를) 1개 이상 선택해 주세요."],
    ["methods unknown", { methods: ["독학"] }, "선호 교육 방식 값이 올바르지 않습니다."],
    ["time_slot invalid", { time_slot: "새벽" }, "선호 시간대을(를) 선택해 주세요."],
    ["duration invalid", { duration: "1주" }, "적정 교육 시간을(를) 선택해 주세요."],
    ["barriers unknown", { barriers: ["귀찮음"] }, "어려운 점 값이 올바르지 않습니다."],
    ["barriers not array", { barriers: "업무 부담" }, "어려운 점 값이 올바르지 않습니다."],
    ["barrier_other > 100", { barrier_other: long(101) }, "기타 어려운 점은(는) 100자 이내로 입력해 주세요."],
    ["comment > 1000", { comment: long(1001) }, "자유 의견은(는) 1000자 이내로 입력해 주세요."],
    ["past_sat 6", { past_sat: 6 }, "지난 1년 교육 만족도은(는) 1~5 사이여야 합니다."],
    ["past_sat numeric 0 (only 'none' means 0)", { past_sat: 0 }, "지난 1년 교육 만족도은(는) 1~5 사이여야 합니다."],
    ["past_sat garbage", { past_sat: "x" }, "지난 1년 교육 만족도을(를) 선택해 주세요."],
    ["기타 area without text", { areas: ["기타"], area_other: " " }, "기타 교육 분야 내용을 입력해 주세요."],
    ["기타 barrier without text", { barriers: ["기타"] }, "기타 어려운 점 내용을 입력해 주세요."],
    ["first failing field wins (name before rank)", { name: "", rank: "x" }, "이름을(를) 입력해 주세요."],
    ["emp_no regex is checked after the other fields", { emp_no: "a b", rank: "x" }, "직급을(를) 선택해 주세요."],
  ];
  for (const [label, patch, msg] of cases) {
    test(`validation: ${label} -> 400`, async () => {
      const body = valid(patch);
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete body[k];
      const r = await post(body);
      assert.equal(r.status, 400);
      assertNoStore(r);
      assert.deepEqual(r.json, { error: msg });
      assert.equal(fake.rows("responses").length, 0);
    });
  }

  test("boundaries accepted: name 30, emp_no 20 with hyphen, dept 50, comment 1000, 3 areas, all 5 methods", async () => {
    const r = await post(valid({ name: "가".repeat(30), emp_no: "A-" + "1".repeat(18), dept: "부".repeat(50), comment: "c".repeat(1000),
      areas: OPTIONS.areas.slice(0, 3), methods: OPTIONS.methods }));
    assert.equal(r.status, 201);
  });

  test("past_sat: null/''/missing -> null, 'none' -> 0, '4' -> 4", async () => {
    const cases = [[null, null], ["", null], [undefined, null], ["none", 0], ["4", 4], [1, 1]];
    let i = 0;
    for (const [input, stored] of cases) {
      const body = valid({ emp_no: `P${i++}`, past_sat: input });
      if (input === undefined) delete body.past_sat;
      assert.equal((await post(body)).status, 201);
      assert.equal(fake.rows("responses").at(-1).past_sat, stored, `past_sat ${JSON.stringify(input)}`);
    }
  });

  test("기타 with text keeps area_other / barrier_other (trimmed)", async () => {
    await post(valid({ areas: ["기타"], area_other: " 요리 ", barriers: ["기타", "업무 부담"], barrier_other: " 회식 " }));
    const [s] = fake.rows("responses");
    assert.equal(s.area_other, "요리");
    assert.equal(s.barrier_other, "회식");
    assert.deepEqual(s.barriers, ["업무 부담", "기타"]);
  });

  test("barriers null/missing -> []", async () => {
    const b = valid({ barriers: null });
    assert.equal((await post(b)).status, 201);
    assert.deepEqual(fake.rows("responses")[0].barriers, []);
  });

  test("non-string text values are stringified (numbers for name/emp_no)", async () => {
    assert.equal((await post(valid({ name: 123, emp_no: 4567 }))).status, 201);
    const [s] = fake.rows("responses");
    assert.equal(s.name, "123");
    assert.equal(s.emp_no, "4567");
  });

  test("quirk: skill uses parseInt, so '3abc' and 3.7 are accepted as 3", async () => {
    // docs: int() uses parseInt, so "3abc" is accepted as 3.
    assert.equal((await post(valid({ emp_no: "Q1", skill: "3abc" }))).status, 201);
    assert.equal((await post(valid({ emp_no: "Q2", skill: 3.7 }))).status, 201);
    assert.deepEqual(fake.rows("responses").map(r => r.skill), [3, 3]);
  });

  test("duplicate choices collapse (['외국어' x4] counts as 1 area)", async () => {
    assert.equal((await post(valid({ areas: ["외국어", "외국어", "외국어", "외국어"] }))).status, 201);
    assert.deepEqual(fake.rows("responses")[0].areas, ["외국어"]);
  });

  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    test(`${method} -> 405`, async () => {
      const r = await call(h.responses, { method, body: valid() });
      assert.equal(r.status, 405);
      assertNoStore(r);
      assert.deepEqual(r.json, { error: "POST만 허용됩니다." });
    });
  }

  test("DB error on lookup -> 500 generic message", async t => {
    t.mock.method(console, "error", () => {});
    fake.failNext({ table: "responses", op: "select" });
    const r = await post(valid());
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
  });

  test("DB error on upsert -> 500 generic message, nothing stored", async t => {
    t.mock.method(console, "error", () => {});
    fake.failNext({ table: "responses", op: "upsert" });
    const r = await post(valid());
    assert.equal(r.status, 500);
    assert.equal(fake.rows("responses").length, 0);
  });
});

describe("/api/login", () => {
  test("correct password -> 200 {ok:true} + 8h signed HttpOnly Secure SameSite=Strict cookie", async () => {
    const before = Date.now();
    const r = await call(h.login, { method: "POST", body: { password: TEST_ENV.ADMIN_PASSWORD } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
    assertNoStore(r);
    const m = /^sid=(\d+)\.([A-Za-z0-9_-]+); Max-Age=28800; Path=\/; HttpOnly; Secure; SameSite=Strict$/.exec(r.headers["set-cookie"]);
    assert.ok(m, r.headers["set-cookie"]);
    const exp = Number(m[1]);
    assert.ok(exp >= before + 8 * 3600_000 && exp <= Date.now() + 8 * 3600_000);
    // signature format must stay compatible so existing sessions survive a refactor:
    const secret = crypto.createHash("sha256").update(`${TEST_ENV.ADMIN_PASSWORD}\0${TEST_ENV.SUPABASE_SERVICE_ROLE_KEY}`).digest();
    assert.equal(m[2], crypto.createHmac("sha256", secret).update(String(exp)).digest("base64url"));
  });

  test("body as JSON string works", async () => {
    const r = await call(h.login, { method: "POST", body: JSON.stringify({ password: TEST_ENV.ADMIN_PASSWORD }) });
    assert.equal(r.status, 200);
  });

  test("wrong password -> 401 after ~1s, no cookie (real timers)", async () => {
    const t0 = Date.now();
    const r = await call(h.login, { method: "POST", body: { password: "nope" } });
    const dt = Date.now() - t0;
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { error: "비밀번호가 올바르지 않습니다." });
    assert.equal(r.headers["set-cookie"], undefined);
    assert.ok(dt >= 900, `waited ${dt}ms`);
  });

  test("malformed JSON body -> treated as no password: 401 only after 1000ms (fake timers)", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    let done = false;
    const p = call(h.login, { method: "POST", body: "{oops" }).then(r => { done = true; return r; });
    const flush = () => new Promise(r => setImmediate(r));
    await flush();
    mock.timers.tick(999); await flush();
    assert.equal(done, false, "must not answer before 1s");
    mock.timers.tick(1); await flush();
    const r = await p;
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { error: "비밀번호가 올바르지 않습니다." });
  });

  for (const method of ["GET", "PUT"]) {
    test(`${method} -> 405 immediately`, async () => {
      const r = await call(h.login, { method, body: { password: TEST_ENV.ADMIN_PASSWORD } });
      assert.equal(r.status, 405);
      assert.deepEqual(r.json, { error: "POST만 허용됩니다." });
      assert.equal(r.headers["set-cookie"], undefined);
    });
  }
});

describe("/api/logout", () => {
  for (const method of ["GET", "POST"]) {
    test(`${method} -> 302 /login and clears the cookie`, async () => {
      const r = await call(h.logout, { method });
      assert.equal(r.status, 302);
      assert.equal(r.location, "/login");
      assert.equal(r.headers["set-cookie"], "sid=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict");
      assert.equal(r.headers["cache-control"], "no-store");
    });
  }
});

describe("/api/summary", () => {
  const empty = choices => Object.fromEntries(choices.map(c => [c, 0]));

  test("RESULTS_PUBLIC: no cookie needed (also with a garbage cookie)", async () => {
    for (const headers of [{}, { cookie: "sid=123.bad" }]) {
      const r = await call(h.summary, { method: "GET", query: {}, headers });
      assert.equal(r.status, 200);
    }
  });

  test("empty DB -> zeros/nulls", async () => {
    const r = await call(h.summary, { query: {} });
    assert.equal(r.status, 200);
    assertNoStore(r);
    assert.deepEqual(r.json, {
      count: 0, avg_skill: null, avg_past_sat: null, past_none: 0,
      areas: empty(OPTIONS.areas), methods: empty(OPTIONS.methods), time_slots: empty(OPTIONS.time_slots),
      durations: empty(OPTIONS.durations), barriers: empty(OPTIONS.barriers), ranks: empty(OPTIONS.ranks),
      texts: [], depts: [],
    });
  });

  test("aggregation numbers, KST times, texts ordered by updated_at desc", async () => {
    fake.insertRaw("responses", [
      row({ emp_no: "A1", name: "가", dept: "영업팀", rank: "사원", skill: 1, past_sat: 0, areas: ["외국어", "기타"], area_other: "요리",
        methods: ["외부 위탁"], time_slot: "주말", duration: "하루", barriers: ["업무 부담"], updated_at: "2026-11-01T15:30:00Z" }),
      row({ emp_no: "A2", name: "나", dept: "개발팀", rank: "과장", skill: 2, past_sat: 5, areas: ["외국어"],
        methods: ["외부 위탁", "실시간 온라인"], time_slot: "주말", duration: "2일 이상", comment: "좋아요", updated_at: "2026-11-03T00:00:00Z" }),
      row({ emp_no: "A3", name: "다", dept: "개발팀", rank: "과장", skill: 2, past_sat: 4, areas: ["리더십·관리"],
        methods: ["실시간 온라인"], time_slot: "퇴근 후", duration: "하루", barriers: ["업무 부담", "시간 부족"], updated_at: "2026-11-02T00:00:00Z" }),
      row({ emp_no: "A4", name: "라", dept: "인사팀", rank: "부장 이상", skill: 5, past_sat: null, priority_topic: "AI",
        updated_at: "2026-10-01T00:00:00Z" }),
    ]);
    const r = await call(h.summary, { query: {} });
    const j = r.json;
    assert.equal(j.count, 4);
    assert.equal(j.avg_skill, 2.5);
    assert.equal(j.avg_past_sat, 4.5, "0 (none) and null excluded");
    assert.equal(j.past_none, 1);
    assert.deepEqual(j.areas, { ...empty(OPTIONS.areas), "외국어": 3, "기타": 1, "리더십·관리": 1 });
    assert.deepEqual(j.methods, { ...empty(OPTIONS.methods), "외부 위탁": 2, "실시간 온라인": 3 });
    assert.deepEqual(j.time_slots, { ...empty(OPTIONS.time_slots), "주말": 2, "퇴근 후": 1, "점심시간": 1 });
    assert.deepEqual(j.durations, { ...empty(OPTIONS.durations), "하루": 3, "2일 이상": 1 });
    assert.deepEqual(j.barriers, { ...empty(OPTIONS.barriers), "업무 부담": 2, "시간 부족": 1 });
    assert.deepEqual(j.ranks, { ...empty(OPTIONS.ranks), "사원": 1, "과장": 2, "부장 이상": 1 });
    assert.deepEqual(j.depts, ["개발팀", "영업팀", "인사팀"]);
    assert.deepEqual(j.texts, [
      { name: "나", emp_no: "A2", dept: "개발팀", rank: "과장", priority_topic: "", area_other: "", barrier_other: "", comment: "좋아요", updated_at: "2026-11-03 09:00:00" },
      { name: "가", emp_no: "A1", dept: "영업팀", rank: "사원", priority_topic: "", area_other: "요리", barrier_other: "", comment: "", updated_at: "2026-11-02 00:30:00" },
      { name: "라", emp_no: "A4", dept: "인사팀", rank: "부장 이상", priority_topic: "AI", area_other: "", barrier_other: "", comment: "", updated_at: "2026-10-01 09:00:00" },
    ]);
    assert.ok(!j.texts.some(t => t.emp_no === "A3"), "rows without any free text are not in texts");
  });

  test("averages are rounded to 2 decimals", async () => {
    fake.insertRaw("responses", [row({ skill: 1, past_sat: 1 }), row({ skill: 2, past_sat: 1 }), row({ skill: 2, past_sat: 2 })]);
    const j = (await call(h.summary, { query: {} })).json;
    assert.equal(j.avg_skill, 1.67);
    assert.equal(j.avg_past_sat, 1.33);
  });

  test("dept / rank filters apply to everything except the depts list", async () => {
    fake.insertRaw("responses", [
      row({ dept: "개발팀", rank: "사원", skill: 1 }), row({ dept: "개발팀", rank: "과장", skill: 5 }), row({ dept: "영업팀", rank: "사원", skill: 3 }),
    ]);
    let j = (await call(h.summary, { query: { dept: "개발팀" } })).json;
    assert.equal(j.count, 2); assert.equal(j.avg_skill, 3);
    assert.deepEqual(j.depts, ["개발팀", "영업팀"]);
    j = (await call(h.summary, { query: { dept: "개발팀", rank: "사원" } })).json;
    assert.equal(j.count, 1); assert.equal(j.avg_skill, 1);
    j = (await call(h.summary, { query: { rank: "사원" } })).json;
    assert.equal(j.count, 2);
    j = (await call(h.summary, { query: { dept: "없는팀" } })).json;
    assert.equal(j.count, 0); assert.equal(j.avg_skill, null);
    assert.deepEqual(j.depts, ["개발팀", "영업팀"]);
    j = (await call(h.summary, { query: { dept: "", rank: "" } })).json;
    assert.equal(j.count, 3, "empty filters are ignored");
  });

  test("values outside OPTIONS (legacy data) get their own counter key", async () => {
    fake.insertRaw("responses", [row({ rank: "인턴", areas: ["옛분야"] })]);
    const j = (await call(h.summary, { query: {} })).json;
    assert.equal(j.ranks["인턴"], 1);
    assert.equal(j.areas["옛분야"], 1);
  });

  test("pages past 1000 rows (fetchAll) so count covers all rows", async () => {
    fake.insertRaw("responses", Array.from({ length: 1005 }, (_, i) => row({ emp_no: `B${i}`, skill: 4 })));
    const j = (await call(h.summary, { query: {} })).json;
    assert.equal(j.count, 1005);
    assert.equal(j.avg_skill, 4);
  });

  test("quirk: the depts list is not paged, so a dept only present beyond the first 1000 rows is missing", async () => {
    // docs Gotchas: "The department list in summary.js:14 doesn't page, so it is capped at 1,000 rows."
    // (Postgres returns unordered rows; the fake returns insertion order.)
    fake.insertRaw("responses", [...Array.from({ length: 1000 }, (_, i) => row({ emp_no: `C${i}`, dept: "개발팀" })), row({ emp_no: "LAST", dept: "총무팀" })]);
    const j = (await call(h.summary, { query: {} })).json;
    assert.equal(j.count, 1001);
    assert.deepEqual(j.depts, ["개발팀"]);
    const k = (await call(h.summary, { query: { dept: "총무팀" } })).json;
    assert.equal(k.count, 1, "filtered aggregation still finds it");
  });

  test("DB error -> 500", async t => {
    t.mock.method(console, "error", () => {});
    fake.failNext({ table: "responses", op: "select" });
    const r = await call(h.summary, { query: {} });
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: "결과를 불러오지 못했습니다." });
  });
});

describe("/api/export (CSV)", () => {
  const HEAD = ["사번", "이름", "부서", "직급", "교육 분야", "기타 분야", "우선 교육 주제", "역량 자기평가",
    "선호 교육 방식", "선호 시간대", "적정 교육 시간", "지난 1년 교육 만족도",
    "어려운 점", "기타 어려운 점", "자유 의견", "최초 제출", "최종 수정"];

  test("public (no cookie); headers; BOM + 17-column header + CRLF on empty DB", async () => {
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-05T15:30:00Z") });
    const r = await call(h.export, { query: {} });
    assert.equal(r.status, 200);
    assertNoStore(r);
    assert.equal(r.headers["content-type"], "text/csv; charset=utf-8");
    // filename stamp is KST (15:30Z = next day 00:30 KST)
    assert.equal(r.headers["content-disposition"], 'attachment; filename="education_survey_202611060030.csv"');
    assert.equal(r.text, "﻿" + HEAD.join(",") + "\r\n");
  });

  test("rows: sorted by dept then emp_no; arrays joined; past_sat mapping; KST timestamps; CRLF", async () => {
    fake.insertRaw("responses", [
      row({ emp_no: "E2", name: "둘", dept: "영업팀", areas: ["직무 전문성", "외국어"], methods: ["외부 위탁"], past_sat: 0,
        created_at: "2026-01-02T15:00:00Z", updated_at: "2026-01-02T15:00:01Z" }),
      row({ emp_no: "E10", name: "열", dept: "영업팀", past_sat: 3, barriers: ["업무 부담", "기타"], barrier_other: "야근" }),
      row({ emp_no: "Z1", name: "제트", dept: "개발팀", past_sat: null }),
    ]);
    const r = await call(h.export, { query: {} });
    assert.ok(r.text.startsWith("﻿"));
    assert.ok(r.text.endsWith("\r\n"));
    assert.ok(!/[^\r]\n/.test(r.text), "every newline is CRLF");
    const rows = parseCsv(r.text.slice(1));
    assert.deepEqual(rows[0], HEAD);
    assert.equal(rows.length, 4);
    for (const x of rows) assert.equal(x.length, 17);
    assert.deepEqual(rows.slice(1).map(x => x[0]), ["Z1", "E10", "E2"], "dept (ko) then emp_no (string order: E10 < E2)");
    const e2 = rows[3];
    assert.equal(e2[4], "직무 전문성, 외국어");
    assert.equal(e2[11], "받은 적 없음");
    assert.equal(e2[15], "2026-01-03 00:00:00");
    assert.equal(e2[16], "2026-01-03 00:00:01");
    assert.equal(rows[2][11], "3");
    assert.equal(rows[2][12], "업무 부담, 기타");
    assert.equal(rows[2][13], "야근");
    assert.equal(rows[1][11], "");
    assert.equal(rows[1][7], "3", "skill");
    // raw line check: comma-containing fields are quoted
    assert.ok(r.text.includes(',"직무 전문성, 외국어",'));
  });

  test("CSV injection guard (= + - @) and quoting of quotes/newlines", async () => {
    fake.insertRaw("responses", [row({ emp_no: "-01", name: "=SUM(A1)", dept: "+팀", priority_topic: "@here", comment: 'say "hi"\nnext', area_other: "a,b" })]);
    const r = await call(h.export, { query: {} });
    const line = r.text.split("\r\n")[1];
    assert.ok(line.startsWith("'-01,'=SUM(A1),'+팀,"), line);
    assert.ok(line.includes(",'@here,"));
    assert.ok(line.includes(',"say ""hi""\nnext",'));
    assert.ok(line.includes(',"a,b",'));
    const rows = parseCsv(r.text.slice(1));
    assert.equal(rows[1][14], 'say "hi"\nnext');
  });

  test("exports more than 1000 rows", async () => {
    fake.insertRaw("responses", Array.from({ length: 1001 }, (_, i) => row({ emp_no: `X${i}` })));
    const r = await call(h.export, { query: {} });
    assert.equal(r.text.split("\r\n").length, 1 + 1001 + 1);
  });

  test("DB error -> 500 JSON", async t => {
    t.mock.method(console, "error", () => {});
    fake.failNext({ table: "responses" });
    const r = await call(h.export, { query: {} });
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: "CSV를 만들지 못했습니다." });
  });
});

describe("vercel.json", () => {
  const v = readVercelJson("survey");
  test("cleanUrls", () => assert.equal(v.cleanUrls, true));
  test("rewrites /api/export.csv -> /api/export and /logout -> /api/logout (targets exist)", () => {
    const map = Object.fromEntries((v.rewrites ?? []).map(r => [r.source, r.destination]));
    assert.deepEqual(map, { "/api/export.csv": "/api/export", "/logout": "/api/logout" });
    assert.ok(appFileExists("survey", "api/export.js"));
    assert.ok(appFileExists("survey", "api/logout.js"));
  });
  test("redirect /login -> /results (temporary) while results are public", () => {
    assert.deepEqual((v.redirects ?? []).map(r => [r.source, r.destination, r.permanent]), [["/login", "/results", false]]);
  });
  test("security headers everywhere; noindex only on /results and /api/*", () => {
    const base = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" };
    assert.deepEqual(headersFor(v, "/"), base);
    assert.deepEqual(headersFor(v, "/index.html"), base);
    assert.deepEqual(headersFor(v, "/results"), { ...base, "X-Robots-Tag": "noindex, nofollow" });
    assert.deepEqual(headersFor(v, "/api/summary"), { ...base, "X-Robots-Tag": "noindex, nofollow" });
    assert.deepEqual(headersFor(v, "/api/export.csv"), { ...base, "X-Robots-Tag": "noindex, nofollow" });
  });
});
