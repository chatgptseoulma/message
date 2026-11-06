// survey-vercel with Supabase env vars missing (separate file = fresh process, so db()'s
// singleton is first touched with the env absent).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp, call, TEST_ENV } from "./helpers/vercel-harness.js";
import { SURVEY_SCHEMA } from "./helpers/fake-supabase.js";

const { fake, handlers: h } = await loadApp("survey", {
  schema: SURVEY_SCHEMA(),
  env: { SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, ADMIN_PASSWORD: TEST_ENV.ADMIN_PASSWORD },
});
const valid = { name: "a", emp_no: "E1", dept: "d", rank: "사원", areas: ["외국어"], skill: 3, methods: ["외부 위탁"], time_slot: "주말", duration: "하루" };

test("config still works without DB env", async () => {
  assert.equal((await call(h.config, {})).status, 200);
});

test("responses / summary / export -> their 500 messages; no client is created", async t => {
  t.mock.method(console, "error", () => {});
  let r = await call(h.responses, { method: "POST", body: valid });
  assert.deepEqual([r.status, r.json], [500, { error: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }]);
  r = await call(h.summary, { query: {} });
  assert.deepEqual([r.status, r.json], [500, { error: "결과를 불러오지 못했습니다." }]);
  r = await call(h.export, { query: {} });
  assert.deepEqual([r.status, r.json], [500, { error: "CSV를 만들지 못했습니다." }]);
  assert.equal(fake.clients.length, 0);
});

test("validation still runs first (400) without DB env", async () => {
  const r = await call(h.responses, { method: "POST", body: { ...valid, name: "" } });
  assert.equal(r.status, 400);
});

test("quirk: missing SUPABASE_SERVICE_ROLE_KEY makes a CORRECT login throw (uncaught) with an ADMIN_PASSWORD message", async () => {
  // docs Gotchas: "If SUPABASE_SERVICE_ROLE_KEY is missing, secret() reports the error as ADMIN_PASSWORD being missing."
  // login.js does not catch it, so the platform turns it into a 500.
  const r = await call(h.login, { method: "POST", body: { password: TEST_ENV.ADMIN_PASSWORD } });
  assert.equal(r.status, 500);
  assert.ok(r.threw, "handler threw");
  assert.match(r.threw.message, /ADMIN_PASSWORD/);
  assert.equal(r.headers["set-cookie"], undefined);
});
