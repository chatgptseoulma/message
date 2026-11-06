// comfort-letters with Supabase env vars missing (separate file = fresh process, so db()'s
// singleton is first touched with the env absent). Docs: "otherwise every API call returns 500".
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp, call } from "./helpers/vercel-harness.js";
import { COMFORT_SCHEMA } from "./helpers/fake-supabase.js";

const { fake, handlers: h } = await loadApp("comfort", {
  schema: COMFORT_SCHEMA(),
  env: { SUPABASE_URL: "https://x.supabase.invalid", SUPABASE_SERVICE_ROLE_KEY: "   " }, // whitespace-only key counts as missing
});
const GENERIC_500 = "잠시 문제가 생겼어요. 조금 뒤 다시 시도해 주세요.";

test("DB-touching calls -> 500 generic; no client created", async t => {
  t.mock.method(console, "error", () => {});
  for (const [handler, opts] of [
    [h.me, { method: "POST", body: { nickname: "a" } }],
    [h.me, { method: "GET", headers: { authorization: "Bearer " + "a".repeat(32) } }],
    [h.comforters, { method: "GET" }],
    [h.rooms, { method: "GET", headers: { authorization: "Bearer " + "a".repeat(32) } }],
  ]) {
    const r = await call(handler, opts);
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: GENERIC_500 });
  }
  assert.equal(fake.clients.length, 0);
});

test("checks that need no DB still answer normally (400 / 401 / 405)", async () => {
  assert.equal((await call(h.me, { method: "POST", body: { nickname: "" } })).status, 400);
  assert.equal((await call(h.me, { method: "GET" })).status, 401);
  assert.equal((await call(h.me, { method: "PUT" })).status, 405);
  assert.equal((await call(h.rooms, { method: "GET" })).status, 401);
});
