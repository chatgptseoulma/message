// Characterization tests for comfort-letters/ (Vercel functions + Supabase), as of the
// 2026-11-05 "broadcast rooms" redesign (api/rooms.js + api/room.js + lib/rooms.js replaced
// api/threads.js + api/thread.js; migration 20261105200000_broadcast_rooms.sql).
// Black-box per endpoint against an in-memory fake Supabase (helpers/fake-supabase.js) that
// models the migrations' constraints (PK/unique, FK ON DELETE CASCADE, CHECKs, uuid syntax).
// Tests named "quirk: ..." pin CURRENT behaviour listed under "Gotchas / known bugs" in
// docs/comfort-letters.md (or found while writing these); if you fix one on purpose, update it.
import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadApp, call, readVercelJson, headersFor, TEST_ENV } from "./helpers/vercel-harness.js";
import { COMFORT_SCHEMA } from "./helpers/fake-supabase.js";

const { fake, handlers: h } = await loadApp("comfort", { schema: COMFORT_SCHEMA() });
const admin = fake.createClient("test-admin", "test-admin"); // direct DB access (e.g. "another instance")
fake.clients.length = 0;

beforeEach(() => fake.reset());
afterEach(() => mock.timers.reset());

const GENERIC_500 = "잠시 문제가 생겼어요. 조금 뒤 다시 시도해 주세요.";
const NO_KEY = "먼저 닉네임을 정해 주세요.";
const BAD_KEY = "열쇠가 맞지 않아요. 처음 화면에서 다시 시작해 주세요.";
const NOT_FOUND = "방을 찾을 수 없어요.";
const METHOD = "허용되지 않은 요청이에요.";
const TOO_FAST = "워워, 너무 빨라요. 1분만 숨 돌리고 다시 보내요.";

const auth = token => ({ authorization: `Bearer ${token}` });
async function signup(nickname = "철수") {
  const r = await call(h.me, { method: "POST", body: { nickname } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { ...r.json, auth: auth(r.json.token) };
}
// Comforters only see broadcast rooms created after their *account* (lib/rooms.js madeAfterJoin).
// Backdate helper-made comforter accounts so that rule never depends on how many milliseconds
// pass between steps (it made tests flaky under load). Tests of the rule itself set timestamps
// explicitly. Done before the first authenticated call, because the server caches the user.
const backdate = u => { fake.raw("cb_users").find(x => x.id === u.id).created_at = "2000-01-01T00:00:00.000Z"; };
async function comforter(nickname = "영희", intro = "다 들어줄게", active = true) {
  const u = await signup(nickname);
  backdate(u);
  const r = await call(h.comforters, { method: "POST", headers: u.auth, body: { intro, active } });
  assert.equal(r.status, 200);
  return u;
}
const pour = (u, body = "오늘 너무 빡쳤어") => call(h.rooms, { method: "POST", headers: u.auth, body: { body } });
const list = u => call(h.rooms, { method: "GET", headers: u.auth });
const room = (u, id, query = {}) => call(h.room, { method: "GET", headers: u.auth, query: { id, ...query } });
const say = (u, id, body) => call(h.room, { method: "POST", headers: u.auth, query: { id }, body: { body } });
const close = (u, id) => call(h.room, { method: "PATCH", headers: u.auth, query: { id } });
async function newRoom(u, body) { const r = await pour(u, body); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.id; }

/** seed an old-design 1:1 thread (comforter_id set) with messages [[author, body], ...] */
function legacyThread(seeker, comf, msgs = [], extra = {}) {
  const [t] = fake.insertRaw("cb_threads", { seeker_id: seeker.id, comforter_id: comf.id, title: msgs[0]?.[1]?.slice(0, 40) ?? "", ...extra });
  let last = null;
  for (const [author, body] of msgs) last = fake.insertRaw("cb_messages", { thread_id: t.id, author_id: author.id, body })[0];
  if (last) Object.assign(fake.raw("cb_threads").find(x => x.id === t.id), { last_id: last.id, last_body: last.body.slice(0, 120), last_author: last.author_id });
  return t.id;
}
const threadRow = id => fake.rows("cb_threads").find(t => t.id === id);
const readOf = (tid, uid) => fake.rows("cb_reads").find(r => r.thread_id === tid && r.user_id === uid)?.last_read_id;
const assertNoStore = r => {
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
};
const quiet = t => t.mock.method(console, "error", () => {});

describe("fake supabase wiring", () => {
  test("the app's @supabase/supabase-js is the fake; one cached client built from env", async () => {
    await signup("a"); await signup("b");
    assert.equal(fake.clients.length, 1);
    assert.equal(fake.clients[0].url, TEST_ENV.SUPABASE_URL);
    assert.equal(fake.clients[0].key, TEST_ENV.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(fake.rows("cb_users").length, 2);
  });
});

describe("/api/me", () => {
  test("POST {nickname} -> 201 with token (only time it is returned); DB stores only its sha256", async () => {
    const r = await call(h.me, { method: "POST", body: { nickname: "  철수 \r\n" } });
    assert.equal(r.status, 201);
    assertNoStore(r);
    const { token, ...rest } = r.json;
    assert.match(token, /^[A-Za-z0-9_-]{32}$/, "24 random bytes, base64url");
    assert.deepEqual(Object.keys(rest).sort(), ["comforter", "emoji", "id", "nickname"]);
    assert.equal(rest.nickname, "철수");
    assert.equal(rest.emoji, "", "no emoji chosen -> empty string");
    assert.equal(rest.comforter, null);
    const [u] = fake.rows("cb_users");
    assert.equal(u.id, rest.id);
    assert.equal(u.token_hash, crypto.createHash("sha256").update(token).digest("hex"));
    assert.ok(!JSON.stringify(fake.rows("cb_users")).includes(token), "raw token not stored");
  });

  test("POST twice gives different users/tokens; POST ignores any Authorization", async () => {
    const a = await signup("같은이름");
    const r = await call(h.me, { method: "POST", headers: a.auth, body: { nickname: "같은이름" } });
    assert.equal(r.status, 201);
    assert.notEqual(r.json.id, a.id);
    assert.notEqual(r.json.token, a.token);
  });

  test("POST body as JSON string works", async () => {
    const r = await call(h.me, { method: "POST", body: JSON.stringify({ nickname: "문자열" }) });
    assert.equal(r.status, 201);
    assert.equal(r.json.nickname, "문자열");
  });

  for (const [label, body, msg] of [
    ["empty nickname", { nickname: "  " }, "닉네임을(를) 적어 주세요."],
    ["missing nickname", {}, "닉네임을(를) 적어 주세요."],
    ["nickname > 20", { nickname: "가".repeat(21) }, "닉네임은(는) 20자까지 적을 수 있어요."],
    ["array body", [], "잘못된 요청이에요."],
    ["null body", null, "잘못된 요청이에요."],
    ["invalid JSON string", "{x", "잘못된 요청이에요."],
  ]) {
    test(`POST ${label} -> 400`, async () => {
      const r = await call(h.me, { method: "POST", body });
      assert.equal(r.status, 400);
      assert.deepEqual(r.json, { error: msg });
      assert.equal(fake.rows("cb_users").length, 0);
    });
  }

  test("nickname length is counted in UTF-16 units (20 BMP chars ok, 11 emoji rejected)", async () => {
    assert.equal((await call(h.me, { method: "POST", body: { nickname: "가".repeat(20) } })).status, 201);
    const r = await call(h.me, { method: "POST", body: { nickname: "😀".repeat(11) } });
    assert.equal(r.status, 400);
  });

  test("GET with token -> profile (no token field); comforter info after registering", async () => {
    const u = await signup("철수");
    let r = await call(h.me, { method: "GET", headers: u.auth });
    assert.equal(r.status, 200);
    assertNoStore(r);
    assert.deepEqual(r.json, { id: u.id, nickname: "철수", emoji: "", comforter: null });
    await call(h.comforters, { method: "POST", headers: u.auth, body: { intro: "hi", active: false } });
    r = await call(h.me, { method: "GET", headers: u.auth });
    assert.deepEqual(r.json, { id: u.id, nickname: "철수", emoji: "", comforter: { intro: "hi", active: false } });
  });

  test("Bearer with extra spaces is accepted", async () => {
    const u = await signup();
    const r = await call(h.me, { headers: { authorization: `Bearer    ${u.token}` } });
    assert.equal(r.status, 200);
  });

  for (const [label, header] of [
    ["no header", undefined],
    ["Basic scheme", "Basic abcdefghijklmnopqrstuvwxyz"],
    ["lowercase bearer", "bearer abcdefghijklmnopqrstuvwxyz"],
    ["token too short (19)", "Bearer " + "a".repeat(19)],
    ["token too long (65)", "Bearer " + "a".repeat(65)],
    ["token with invalid char", "Bearer " + "a".repeat(20) + "="],
    ["empty Bearer", "Bearer "],
  ]) {
    test(`GET malformed auth (${label}) -> 401 ${NO_KEY}`, async () => {
      const headers = header === undefined ? {} : { authorization: header };
      const r = await call(h.me, { method: "GET", headers });
      assert.equal(r.status, 401);
      assert.deepEqual(r.json, { error: NO_KEY });
    });
  }

  test("GET well-formed unknown token -> 401 열쇠가 맞지 않아요", async () => {
    const r = await call(h.me, { method: "GET", headers: auth("x".repeat(32)) });
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { error: BAD_KEY });
  });

  test("PATCH {nickname} -> 200 profile; GET sees new name immediately (cache evicted)", async () => {
    const u = await signup("철수");
    await call(h.me, { headers: u.auth }); // warm cache
    const r = await call(h.me, { method: "PATCH", headers: u.auth, body: { nickname: " 민수 " } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { id: u.id, nickname: "민수", emoji: "", comforter: null });
    assert.equal(fake.rows("cb_users")[0].nickname, "민수");
    assert.equal((await call(h.me, { headers: u.auth })).json.nickname, "민수");
  });

  test("emoji list: 40 unique people emojis, each ≤16 UTF-16 units (DB check), same list in both pages", async () => {
    const { EMOJIS } = await import(new URL("../../comfort-letters/lib/common.js", import.meta.url));
    assert.equal(EMOJIS.length, 40);
    assert.equal(new Set(EMOJIS).size, 40);
    assert.ok(EMOJIS.every(e => e.length <= 16));
    const fs = await import("node:fs");
    for (const page of ["start.html", "index.html"]) {
      const html = fs.readFileSync(new URL(`../../comfort-letters/public/${page}`, import.meta.url), "utf8");
      const list = JSON.parse(html.match(/const EMOJIS = (\[[\s\S]*?\]);/)[1]);
      assert.deepEqual(list, EMOJIS, page);
    }
  });

  test("emoji: POST/PATCH accept only the allowed list; '' clears; PATCH emoji alone keeps nickname", async () => {
    // people emojis (2026-11-06): incl. skin-tone + ZWJ sequences
    let r = await call(h.me, { method: "POST", body: { nickname: "철수", emoji: "👩🏻‍💻" } });
    assert.equal(r.status, 201);
    assert.equal(r.json.emoji, "👩🏻‍💻");
    const u = { ...r.json, auth: auth(r.json.token) };
    for (const bad of ["💩", "🐻", "👩‍💻👩‍💻", "👩🏻"]) {   // not in the list (old animal set, doubled, unlisted tone)
      r = await call(h.me, { method: "POST", body: { nickname: "x", emoji: bad } });
      assert.deepEqual([r.status, r.json], [400, { error: "고를 수 있는 이모티콘이 아니에요." }], bad);
    }
    r = await call(h.me, { method: "PATCH", headers: u.auth, body: { emoji: "🙋🏽‍♂️" } });
    assert.deepEqual(r.json, { id: u.id, nickname: "철수", emoji: "🙋🏽‍♂️", comforter: null });
    r = await call(h.me, { method: "PATCH", headers: u.auth, body: { emoji: "hello" } });
    assert.equal(r.status, 400);
    r = await call(h.me, { method: "PATCH", headers: u.auth, body: { emoji: "" } });
    assert.equal(r.json.emoji, "");
    assert.equal((await call(h.me, { headers: u.auth })).json.emoji, "", "cache evicted");
    r = await call(h.me, { method: "PATCH", headers: u.auth, body: {} });
    assert.deepEqual([r.status, r.json], [400, { error: "닉네임을(를) 적어 주세요." }]);
  });

  test("PATCH invalid nickname -> 400; PATCH without auth -> 401 (auth checked before body)", async () => {
    const u = await signup();
    let r = await call(h.me, { method: "PATCH", headers: u.auth, body: { nickname: "" } });
    assert.equal(r.status, 400);
    r = await call(h.me, { method: "PATCH", body: "garbage" });
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { error: NO_KEY });
  });

  test("DELETE -> 200 {ok}; token stops working; cascade wipes comforter row, own rooms, legacy threads, reads and own messages", async () => {
    const s = await comforter("철수");            // seeker who is also a comforter
    const c = await comforter("영희");
    const o = await signup("제3자");
    const r1 = await newRoom(s, "내 방");          // s's room, c replies
    await say(c, r1, "괜찮아?");
    const r2 = await newRoom(c, "영희 방");        // c's room, s replies (s is not last poster)
    await say(s, r2, "철수 답장");
    await say(c, r2, "고마워");
    const r3 = await newRoom(o, "남의 방");        // unrelated
    const legacy = legacyThread(s, c, [[s, "옛날 1:1"], [c, "옛 답장"]]);
    assert.ok(legacy);

    const r = await call(h.me, { method: "DELETE", headers: s.auth });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
    assert.deepEqual(fake.rows("cb_users").map(u => u.nickname).sort(), ["영희", "제3자"].sort());
    assert.ok(!fake.rows("cb_comforters").some(x => x.user_id === s.id));
    assert.deepEqual(fake.rows("cb_threads").map(t => t.id).sort(), [r2, r3].sort(), "own room and legacy thread gone");
    assert.deepEqual(fake.rows("cb_messages").map(m => m.body).sort(), ["고마워", "남의 방", "영희 방"].sort(), "others' replies in s's room gone; s's reply in r2 gone");
    assert.ok(!fake.rows("cb_reads").some(x => x.user_id === s.id));

    const after = await call(h.me, { headers: s.auth });
    assert.equal(after.status, 401);
    assert.deepEqual(after.json, { error: BAD_KEY });
    assert.equal((await room(c, r1)).status, 404);
  });

  test("after DELETE, rooms where the user posted last get their preview recomputed from what's left (was a quirk; fixed 2026-11-06, security V-03)", async () => {
    const s = await comforter("철수");
    const c = await comforter("영희");
    const rid = await newRoom(c, "영희 방");
    await say(s, rid, "철수의 마지막 말");
    await call(h.me, { method: "DELETE", headers: s.auth });
    const t = threadRow(rid);
    assert.equal(t.last_body, "영희 방", "deleted user's text no longer in the sidebar copy");
    assert.equal(t.last_author, c.id);
    const [it] = (await list(c)).json.mine;
    assert.deepEqual(it.last, { text: "영희 방", mine: true, author: "영희" });
    assert.equal(it.unread, false);
    assert.deepEqual((await room(c, rid)).json.messages.map(m => m.body), ["영희 방"]);
  });

  test("DELETE without auth -> 401", async () => {
    const r = await call(h.me, { method: "DELETE" });
    assert.equal(r.status, 401);
  });

  test("unsupported method -> 405 (no auth needed)", async () => {
    const r = await call(h.me, { method: "PUT" });
    assert.equal(r.status, 405);
    assertNoStore(r);
    assert.deepEqual(r.json, { error: METHOD });
  });

  test("quirk: user cache is per instance - a user deleted elsewhere keeps working here for up to 60s", async () => {
    // docs bug #4: "a deleted token can stay valid on other instances for up to 60 seconds".
    const u = await signup("캐시");
    assert.equal((await call(h.me, { headers: u.auth })).status, 200); // cached now
    const { error } = await admin.from("cb_users").delete().eq("id", u.id);
    assert.equal(error, null);
    const still = await call(h.me, { headers: u.auth });
    assert.equal(still.status, 200);
    assert.deepEqual(still.json, { id: u.id, nickname: "캐시", emoji: "", comforter: null });
    mock.timers.enable({ apis: ["Date"], now: Date.now() + 61_000 });
    const later = await call(h.me, { headers: u.auth });
    assert.equal(later.status, 401);
    assert.deepEqual(later.json, { error: BAD_KEY });
  });

  test("DB error -> 500 generic message", async t => {
    quiet(t);
    fake.failNext({ table: "cb_users", op: "insert" });
    const r = await call(h.me, { method: "POST", body: { nickname: "x" } });
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: GENERIC_500 });
  });
});

describe("/api/comforters", () => {
  test("GET (anonymous) lists active comforters oldest first; letters = legacy 1:1 thread count", async () => {
    const a = await comforter("A", "첫째");
    const b = await comforter("B", "둘째");
    await comforter("C", "쉬는 중", false);
    const s = await signup("seeker");
    legacyThread(s, a, [[s, "1"]]);
    legacyThread(s, a, [[s, "2"]], { closed: true });
    const r = await call(h.comforters, { method: "GET" });
    assert.equal(r.status, 200);
    assertNoStore(r);
    assert.deepEqual(r.json, [
      { id: a.id, nickname: "A", intro: "첫째", letters: 2 },
      { id: b.id, nickname: "B", intro: "둘째", letters: 0 },
    ]);
  });

  test("quirk: letters counts threads with comforter_id = them, so broadcast-room replies never count", async () => {
    // docs: letters is the number of threads (code comment says messages). Since the rooms redesign
    // new rooms have comforter_id = null, so replies there don't move the number.
    const a = await comforter("A");
    const s = await signup("s");
    const rid = await newRoom(s, "하소연");
    await say(a, rid, "답장1"); await say(a, rid, "답장2");
    const [row] = (await call(h.comforters, {})).json;
    assert.equal(row.letters, 0);
  });

  test("GET excludes the caller; invalid/unknown token is treated as anonymous (no 401)", async () => {
    const a = await comforter("A");
    const b = await comforter("B");
    assert.deepEqual((await call(h.comforters, { headers: a.auth })).json.map(x => x.nickname), ["B"]);
    for (const authorization of ["Bearer short", "Bearer " + "z".repeat(30)]) {
      const r = await call(h.comforters, { headers: { authorization } });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.map(x => x.id), [a.id, b.id]);
    }
  });

  test("GET returns at most 200 comforters", async () => {
    const ids = [];
    for (let i = 0; i < 201; i++) {
      const id = crypto.randomUUID(); ids.push(id);
      fake.insertRaw("cb_users", { id, token_hash: `h${i}`, nickname: `n${i}` });
      fake.insertRaw("cb_comforters", { user_id: id, intro: "", created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() });
    }
    const r = await call(h.comforters, {});
    assert.equal(r.json.length, 200);
    assert.equal(r.json[0].id, ids[0]);
    assert.equal(r.json[199].id, ids[199]);
  });

  test("GET with no comforters -> []", async () => {
    assert.deepEqual((await call(h.comforters, {})).json, []);
  });

  test("POST upserts the caller's row: default active=true, only literal false pauses, created_at kept", async () => {
    const u = await signup("u");
    let r = await call(h.comforters, { method: "POST", headers: u.auth, body: { intro: " 안녕\r\n반가워 " } });
    assert.equal(r.status, 200);
    assertNoStore(r);
    assert.deepEqual(r.json, { ok: true, comforter: { intro: "안녕\n반가워", active: true } });
    const created = fake.rows("cb_comforters")[0].created_at;
    r = await call(h.comforters, { method: "POST", headers: u.auth, body: { intro: "바뀜", active: false } });
    assert.deepEqual(r.json, { ok: true, comforter: { intro: "바뀜", active: false } });
    r = await call(h.comforters, { method: "POST", headers: u.auth, body: { active: "no" } });
    assert.deepEqual(r.json, { ok: true, comforter: { intro: "", active: true } }, "non-false values mean active; missing intro -> ''");
    const rows = fake.rows("cb_comforters");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].created_at, created);
    assert.equal(rows[0].intro, "");
    assert.equal(rows[0].active, true);
  });

  test("POST intro > 100 -> 400; bad body -> 400; POST without auth -> 401", async () => {
    const u = await signup();
    let r = await call(h.comforters, { method: "POST", headers: u.auth, body: { intro: "x".repeat(101) } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json, { error: "소개은(는) 100자까지 적을 수 있어요." });
    r = await call(h.comforters, { method: "POST", headers: u.auth, body: "[1]" });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json, { error: "잘못된 요청이에요." });
    r = await call(h.comforters, { method: "POST", body: { intro: "x" } });
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { error: NO_KEY });
    assert.equal(fake.rows("cb_comforters").length, 0);
  });

  test("other methods -> 405", async () => {
    const r = await call(h.comforters, { method: "DELETE" });
    assert.equal(r.status, 405);
    assert.deepEqual(r.json, { error: METHOD });
  });
});

describe("/api/rooms", () => {
  test("auth is required for every method (even unsupported ones)", async () => {
    for (const method of ["GET", "POST", "PUT"]) {
      const r = await call(h.rooms, { method, body: {} });
      assert.equal(r.status, 401, method);
      assert.deepEqual(r.json, { error: NO_KEY });
    }
    const u = await signup();
    const r = await call(h.rooms, { method: "PUT", headers: u.auth });
    assert.equal(r.status, 405);
    assert.deepEqual(r.json, { error: METHOD });
  });

  test("GET with nothing -> {comforter:false, mine:[], others:[], hidden:[]}", async () => {
    const u = await signup();
    const r = await list(u);
    assert.equal(r.status, 200);
    assertNoStore(r);
    assert.deepEqual(r.json, { comforter: false, mine: [], others: [], hidden: [] });
  });

  test("POST -> 201 {id, reach}; creates a broadcast room + first message + author's read mark", async () => {
    const s = await signup("s");
    await comforter("c1"); await comforter("c2"); await comforter("paused", "", false);
    const r = await pour(s, "  첫 줄\r\n둘째   줄 " + "가".repeat(50));
    assert.equal(r.status, 201);
    assertNoStore(r);
    assert.deepEqual(Object.keys(r.json).sort(), ["id", "reach"]);
    assert.equal(r.json.reach, 2, "active comforters, paused excluded");
    const t = threadRow(r.json.id);
    assert.equal(t.seeker_id, s.id);
    assert.equal(t.comforter_id, null);
    assert.equal(t.closed, false);
    assert.equal(t.title, ("첫 줄 둘째 줄 " + "가".repeat(50)).slice(0, 40), "whitespace collapsed, 40 chars");
    const [m] = fake.rows("cb_messages");
    assert.equal(m.body, "첫 줄\n둘째   줄 " + "가".repeat(50));
    assert.equal(t.last_id, m.id);
    assert.equal(t.last_body, m.body.slice(0, 120));
    assert.equal(t.last_author, s.id);
    assert.equal(Date.parse(t.updated_at), Date.parse(m.created_at));
    assert.equal(readOf(t.id, s.id), m.id);
  });

  test("POST: every pour creates a new room (no reuse); reach excludes the caller; extra fields ignored", async () => {
    const s = await comforter("s");
    await comforter("c");
    const a = await pour(s, "1");
    const b = await call(h.rooms, { method: "POST", headers: s.auth, body: { body: "2", comforter_id: crypto.randomUUID() } });
    assert.equal(b.status, 201);
    assert.notEqual(a.json.id, b.json.id);
    assert.equal(a.json.reach, 1);
    assert.equal(fake.rows("cb_threads").length, 2);
    assert.ok(fake.rows("cb_threads").every(t => t.comforter_id === null));
  });

  test("POST with no comforters at all still works (reach 0)", async () => {
    const s = await signup();
    assert.deepEqual([(await pour(s)).status, (await pour(s)).json.reach], [201, 0]);
  });

  test("POST validation: empty / > 2000 / non-object -> 400, nothing stored", async () => {
    const s = await signup("s");
    let r = await pour(s, " \r\n ");
    assert.deepEqual([r.status, r.json], [400, { error: "하소연을(를) 적어 주세요." }]);
    r = await pour(s, "x".repeat(2001));
    assert.deepEqual([r.status, r.json], [400, { error: "하소연은(는) 2000자까지 적을 수 있어요." }]);
    r = await call(h.rooms, { method: "POST", headers: s.auth, body: "nope" });
    assert.deepEqual([r.status, r.json], [400, { error: "잘못된 요청이에요." }]);
    assert.equal(fake.rows("cb_threads").length, 0);
    assert.equal((await pour(s, "x".repeat(2000))).status, 201);
  });

  test("POST: if the first message fails, the room is deleted again and 500 is returned", async t => {
    quiet(t);
    const s = await signup();
    fake.failNext({ table: "cb_messages", op: "insert" });
    const r = await pour(s, "실패할 하소연");
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: GENERIC_500 });
    assert.equal(fake.rows("cb_threads").length, 0);
    assert.equal(fake.rows("cb_messages").length, 0);
  });

  test("rooms per day (security V-02): 10 pours ok, the 11th is 429 and creates no room; older rooms don't count", async () => {
    const s = await signup("s");
    for (let i = 0; i < 10; i++) assert.equal((await pour(s, `m${i}`)).status, 201);
    const r = await pour(s, "11th");
    assert.equal(r.status, 429);
    assertNoStore(r);
    assert.deepEqual(r.json, { error: "하소연 방은 하루 10개까지 만들 수 있어요. 지금 있는 방에 이어서 쏟아내 주세요." });
    assert.equal(fake.rows("cb_threads").length, 10);
    assert.equal(fake.rows("cb_messages").length, 10);
    for (const t of fake.raw("cb_threads").slice(0, 3)) t.created_at = new Date(Date.now() - 25 * 3600_000).toISOString();
    assert.equal((await pour(s, "next day")).status, 201, "rooms older than 24h are not counted");
  });

  test("rate limit: 20 messages/minute still applies to pours (counted together with replies)", async () => {
    const s = await signup("s");
    const id = await newRoom(s, "first");
    for (let i = 0; i < 19; i++) assert.equal((await say(s, id, `m${i}`)).status, 201);
    const r = await pour(s, "21st message");
    assert.deepEqual([r.status, r.json], [429, { error: TOO_FAST }]);
    assert.equal(fake.rows("cb_threads").length, 1);
  });

  test("rate limit window: messages older than a minute don't count; 500/day -> 429", async () => {
    const s = await signup("s");
    const tid = await newRoom(s, "first");
    const old = new Date(Date.now() - 5 * 60_000).toISOString();
    fake.raw("cb_messages")[0].created_at = old;
    fake.insertRaw("cb_messages", Array.from({ length: 498 }, (_, i) => ({ thread_id: tid, author_id: s.id, body: `b${i}`, created_at: old })));
    assert.equal((await pour(s, "500th")).status, 201, "499 in the last day, none in the last minute");
    const r = await pour(s, "501st");
    assert.equal(r.status, 429);
    assert.deepEqual(r.json, { error: "오늘은 쏟아낼 만큼 쏟아냈어요. 나머진 내일 마저 해요." });
    const day = new Date(Date.now() - 25 * 3600_000).toISOString();
    for (const m of fake.raw("cb_messages").slice(0, 10)) m.created_at = day;
    assert.equal((await pour(s, "after a day")).status, 201);
  });

  test("GET item shape for seeker (mine) and comforter (others); unread via cb_reads", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const rid = await newRoom(s, "하소연 " + "가".repeat(150));
    let me = (await list(s)).json;
    assert.equal(me.comforter, false);
    assert.deepEqual(me.others, []);
    assert.equal(me.mine.length, 1);
    const t = threadRow(rid);
    assert.deepEqual(me.mine[0], {
      id: rid, title: t.title, seeker: "철수", seeker_emoji: "", seeker_id: s.id, legacy: false, closed: false, updated_at: t.updated_at,
      last: { text: ("하소연 " + "가".repeat(150)).slice(0, 120), mine: true, author: "철수" }, unread: false,
      stopped: false, hidden: false,
    });

    let theirs = (await list(c)).json;
    assert.equal(theirs.comforter, true);
    assert.deepEqual(theirs.mine, []);
    assert.equal(theirs.others.length, 1);
    assert.equal(theirs.others[0].unread, true, "never opened");
    assert.deepEqual(theirs.others[0].last, { text: t.last_body, mine: false, author: "철수" });

    await room(c, rid); // marks read
    assert.equal((await list(c)).json.others[0].unread, false);
    await say(c, rid, "토닥토닥");
    me = (await list(s)).json;
    assert.equal(me.mine[0].unread, true);
    assert.deepEqual(me.mine[0].last, { text: "토닥토닥", mine: false, author: "영희" });
    theirs = (await list(c)).json;
    assert.equal(theirs.others[0].unread, false, "own message is never unread");
    assert.equal(theirs.others[0].last.mine, true);
  });

  test("GET: others hide own rooms; legacy threads appear in mine (seeker) / others (comforter); merged by updated_at desc", async () => {
    const s = await signup("s"), c = await comforter("c"), c2 = await comforter("c2");
    const own = await newRoom(c, "c의 방");
    const r1 = await newRoom(s, "s 방1");
    const r2 = await newRoom(s, "s 방2");
    const lg = legacyThread(s, c, [[s, "예전"]]);
    const lgOther = legacyThread(s, c2, [[s, "c2와 예전"]]);
    const set = (id, at) => { fake.raw("cb_threads").find(t => t.id === id).updated_at = at; };
    set(r1, "2026-11-05T10:00:00+00:00"); set(r2, "2026-11-05T08:00:00+00:00"); set(lg, "2026-11-05T09:00:00+00:00");
    set(lgOther, "2026-11-05T07:00:00+00:00"); set(own, "2026-11-05T11:00:00+00:00");

    const cl = (await list(c)).json;
    assert.deepEqual(cl.mine.map(x => x.id), [own]);
    assert.deepEqual(cl.others.map(x => x.id), [r1, lg, r2], "c2's legacy thread is not visible to c");
    assert.deepEqual(cl.others.map(x => x.legacy), [false, true, false]);

    const sl = (await list(s)).json;
    assert.equal(sl.comforter, false);
    assert.deepEqual(sl.mine.map(x => x.id), [r1, lg, r2, lgOther]);
    assert.deepEqual(sl.others, [], "non-comforter sees no broadcast rooms");
  });

  test("GET: room with empty title / no messages -> '(제목 없음)', last null, not unread", async () => {
    const s = await signup("s"), c = await comforter("c");
    legacyThread(s, c, [], { title: "" });
    const [it] = (await list(c)).json.others;
    assert.equal(it.title, "(제목 없음)");
    assert.equal(it.last, null);
    assert.equal(it.unread, false);
    assert.equal(it.legacy, true);
  });

  test("broadcast rooms created before the viewer's account existed are hidden (list) and 404 (room)", async () => {
    // 2026-11-05 change: "내가 계정을 생성한 후에 등록된 하소연만 보여지도록"
    const s = await signup("s");
    const before = await newRoom(s, "가입 전 하소연");
    const late = await comforter("late", "", false);
    const after = await newRoom(s, "가입 후 하소연");
    // anchor to the account's real created_at (the server caches the user, so don't patch the user row)
    const joined = Date.parse(fake.raw("cb_users").find(x => x.id === late.id).created_at);
    const at = (id, ms) => { fake.raw("cb_threads").find(t => t.id === id).created_at = new Date(ms).toISOString(); };
    at(before, joined - 1000);
    at(after, joined); // same instant counts as "after"
    assert.deepEqual((await list(late)).json.others.map(x => x.id), [after]);
    assert.equal((await room(late, before)).status, 404);
    assert.equal((await say(late, before, "늦은 답장")).status, 404);
    assert.equal((await say(late, after, "답장")).status, 201, "paused comforters can still reply to rooms made after they joined");
    // the seeker always sees their own rooms, whatever their age
    assert.deepEqual((await list(s)).json.mine.map(x => x.id).sort(), [before, after].sort());
  });

  test("legacy 1:1 threads addressed to a comforter stay visible even if older than the account", async () => {
    const s = await signup("s"), c = await comforter("c");
    const lg = legacyThread(s, c, [[s, "예전"]]);
    fake.raw("cb_threads").find(t => t.id === lg).created_at = "2000-01-01T00:00:00+00:00";
    assert.deepEqual((await list(c)).json.others.map(x => x.id), [lg]);
    assert.equal((await room(c, lg)).status, 200);
  });
});

describe("/api/room", () => {
  async function setup() {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "첫 메시지");
    return { s, c, id };
  }

  test("GET -> room view, messages in id order with author/by_seeker; stores read position", async () => {
    const { s, c, id } = await setup();
    const c2 = await comforter("민지");
    await say(c, id, "답장");
    await say(c2, id, "나도");
    const r = await room(c, id);
    assert.equal(r.status, 200);
    assertNoStore(r);
    const msgs = fake.rows("cb_messages");
    const mv = (m, mine, author, by_seeker) => ({ id: m.id, mine, author, author_emoji: "", author_id: m.author_id, by_seeker, body: m.body, at: m.created_at, removed: null });
    assert.deepEqual(r.json, {
      id, title: "첫 메시지", seeker: "철수", seeker_emoji: "", seeker_id: s.id, owner: false, legacy: false, closed: false,
      moderated: false, stopped: false, hidden: false, participants: 2,
      messages: [mv(msgs[0], false, "철수", true), mv(msgs[1], true, "영희", false), mv(msgs[2], false, "민지", false)],
      removed: [],
      // readers = everyone else who has a read mark (seeker by posting, 민지 by posting); the caller is excluded
      readers: [
        { name: "철수", emoji: "", last_read_id: msgs[0].id },
        { name: "민지", emoji: "", last_read_id: msgs[2].id },
      ],
      reactions: {},
    });
    assert.equal(readOf(id, c.id), msgs[2].id);
    const rs = await room(s, id);
    assert.equal(rs.json.owner, true);
    assert.deepEqual(rs.json.messages.map(m => m.mine), [true, false, false]);
    assert.equal(readOf(id, s.id), msgs[2].id);
  });

  test("GET after=<id> returns only newer messages; after=0/negative/garbage returns all; read mark still = last_id", async () => {
    const { s, c, id } = await setup();
    await say(c, id, "2"); await say(s, id, "3");
    const ids = fake.rows("cb_messages").map(m => m.id);
    assert.deepEqual((await room(c, id, { after: ids[0] })).json.messages.map(m => m.body), ["2", "3"]);
    assert.deepEqual((await room(c, id, { after: String(ids[2]) })).json.messages, []);
    for (const after of ["0", "-5", "abc", ""]) {
      assert.equal((await room(c, id, { after })).json.messages.length, 3, `after=${after}`);
    }
    assert.equal(readOf(id, c.id), ids[2]);
  });

  test("access: non-comforter stranger -> 404; other comforter can open broadcast rooms but not someone else's legacy thread", async () => {
    const { s, c, id } = await setup();
    const stranger = await signup("남");
    const other = await comforter("다른 위로자");
    const lg = legacyThread(s, c, [[s, "비밀 1:1"]]);
    for (const [u, tid] of [[stranger, id], [stranger, lg], [other, lg]]) {
      for (const method of ["GET", "POST", "PATCH"]) {
        const r = await call(h.room, { method, headers: u.auth, query: { id: tid }, body: { body: "x" } });
        assert.equal(r.status, 404, `${u.nickname} ${method}`);
        assert.deepEqual(r.json, { error: NOT_FOUND });
      }
    }
    assert.equal((await room(other, id)).status, 200);
    assert.equal((await room(c, lg)).status, 200);
    const lgView = (await room(c, lg)).json;
    assert.equal(lgView.legacy, true);
    assert.equal(lgView.owner, false);
  });

  test("404 for unknown uuid, non-uuid and missing id", async () => {
    const { s } = await setup();
    for (const query of [{ id: crypto.randomUUID() }, { id: "not-a-uuid" }, {}]) {
      const r = await call(h.room, { headers: s.auth, query });
      assert.equal(r.status, 404);
      assert.deepEqual(r.json, { error: NOT_FOUND });
    }
  });

  test("401 before 404 when not authenticated", async () => {
    const { id } = await setup();
    const r = await call(h.room, { query: { id } });
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { error: NO_KEY });
  });

  test("malformed ids (36 hex chars, dashes in wrong places) -> 404, not 500 (was docs bug #7; fixed 2026-11-06, security V-11)", async () => {
    const u = await signup();
    for (const id of ["0".repeat(36), "-".repeat(36), "0123456789abcdef0123456789abcdef----"]) {
      const r = await room(u, id);
      assert.deepEqual([r.status, r.json], [404, { error: NOT_FOUND }], id);
    }
  });

  test("POST -> 201 message view; updates room last_* / updated_at and the author's read mark", async () => {
    const { s, c, id } = await setup();
    const r = await say(c, id, "  힘내\r\n진짜  " + "x".repeat(130));
    assert.equal(r.status, 201);
    assertNoStore(r);
    const m = fake.rows("cb_messages")[1];
    assert.deepEqual(r.json, { id: m.id, mine: true, author: "영희", author_emoji: "", author_id: c.id, by_seeker: false, body: "힘내\n진짜  " + "x".repeat(130), at: m.created_at, removed: null });
    const t = threadRow(id);
    assert.equal(t.last_id, m.id);
    assert.equal(t.last_body, m.body.slice(0, 120));
    assert.equal(t.last_author, c.id);
    assert.equal(Date.parse(t.updated_at), Date.parse(m.created_at));
    assert.equal(readOf(id, c.id), m.id);
    const own = await say(s, id, "응");
    assert.equal(own.json.by_seeker, true);
    assert.equal(own.json.author, "철수");
  });

  test("POST in a legacy thread by either participant works", async () => {
    const s = await signup("s"), c = await comforter("c");
    const lg = legacyThread(s, c, [[s, "옛날"]]);
    assert.equal((await say(c, lg, "답")).status, 201);
    assert.equal((await say(s, lg, "또")).status, 201);
    assert.equal(threadRow(lg).last_body, "또");
  });

  test("POST body validation -> 400", async () => {
    const { s, id } = await setup();
    let r = await say(s, id, "");
    assert.deepEqual([r.status, r.json], [400, { error: "메시지을(를) 적어 주세요." }]);
    r = await say(s, id, "y".repeat(2001));
    assert.deepEqual([r.status, r.json], [400, { error: "메시지은(는) 2000자까지 적을 수 있어요." }]);
    r = await call(h.room, { method: "POST", headers: s.auth, query: { id }, body: "[]" });
    assert.deepEqual([r.status, r.json], [400, { error: "잘못된 요청이에요." }]);
    assert.equal(fake.rows("cb_messages").length, 1);
  });

  test("POST rate limit -> 429, nothing stored", async () => {
    const { s, id } = await setup();
    for (let i = 0; i < 19; i++) assert.equal((await say(s, id, `m${i}`)).status, 201);
    const r = await say(s, id, "too many");
    assert.equal(r.status, 429);
    assert.deepEqual(r.json, { error: TOO_FAST });
    assert.equal(fake.rows("cb_messages").length, 20);
  });

  test("PATCH: only the seeker closes a broadcast room (403 for comforters); idempotent; closed room rejects POST", async () => {
    const { s, c, id } = await setup();
    let r = await close(c, id);
    assert.equal(r.status, 403);
    assert.deepEqual(r.json, { error: "방은 하소연한 사람만 닫을 수 있어요." });
    assert.equal(threadRow(id).closed, false);
    r = await close(s, id);
    assert.equal(r.status, 200);
    assertNoStore(r);
    assert.deepEqual(r.json, { ok: true });
    assert.equal(threadRow(id).closed, true);
    assert.equal((await close(s, id)).status, 200);
    assert.equal((await room(c, id)).json.closed, true, "history stays readable");
    assert.equal((await list(c)).json.others[0].closed, true);
    r = await say(s, id, "");
    assert.equal(r.status, 400);
    assert.deepEqual(r.json, { error: "닫힌 방이에요. 이력만 볼 수 있어요." }, "closed check comes before body validation");
    assert.equal(fake.rows("cb_messages").length, 1);
  });

  test("PATCH legacy thread: either participant may close", async () => {
    const s = await signup("s"), c = await comforter("c");
    const lg = legacyThread(s, c, [[s, "옛날"]]);
    assert.equal((await close(c, lg)).status, 200);
    assert.equal(threadRow(lg).closed, true);
  });

  test("other methods -> 405 for viewers", async () => {
    const { s, id } = await setup();
    const r = await call(h.room, { method: "DELETE", headers: s.auth, query: { id } });
    assert.equal(r.status, 405);
    assert.deepEqual(r.json, { error: METHOD });
  });
});

describe("vercel.json", () => {
  const v = readVercelJson("comfort");
  test("cleanUrls, region icn1, no rewrites/redirects", () => {
    assert.equal(v.cleanUrls, true);
    assert.deepEqual(v.regions, ["icn1"]);
    assert.equal(v.rewrites, undefined);
    assert.equal(v.redirects, undefined);
  });
  test("security headers everywhere; noindex only on /api/*", () => {
    const base = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" };
    assert.deepEqual(headersFor(v, "/"), base);
    assert.deepEqual(headersFor(v, "/start"), base);
    assert.deepEqual(headersFor(v, "/api/me"), { ...base, "X-Robots-Tag": "noindex, nofollow" });
    assert.deepEqual(headersFor(v, "/api/room"), { ...base, "X-Robots-Tag": "noindex, nofollow" });
  });
});
