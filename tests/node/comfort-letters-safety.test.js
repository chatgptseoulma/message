// comfort-letters: 2026-11-06 features — report, block, message recall, read receipts,
// per-room hide / stop (migration 20261106000000_safety_and_prefs.sql).
// Same black-box approach as comfort-letters.test.js (in-memory fake Supabase).
import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { loadApp, call } from "./helpers/vercel-harness.js";
import { COMFORT_SCHEMA } from "./helpers/fake-supabase.js";

const { fake, handlers: h } = await loadApp("comfort", { schema: COMFORT_SCHEMA() });
fake.clients.length = 0;
beforeEach(() => fake.reset());
afterEach(() => mock.timers.reset());

const auth = token => ({ authorization: `Bearer ${token}` });
async function signup(nickname) {
  const r = await call(h.me, { method: "POST", body: { nickname } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { ...r.json, auth: auth(r.json.token) };
}
// Backdate helper-made comforter accounts so "only rooms created after my account" never
// depends on millisecond timing (see comfort-letters.test.js). Before the first authed call (user cache).
async function comforter(nickname) {
  const u = await signup(nickname);
  fake.raw("cb_users").find(x => x.id === u.id).created_at = "2000-01-01T00:00:00.000Z";
  assert.equal((await call(h.comforters, { method: "POST", headers: u.auth, body: { intro: "", active: true } })).status, 200);
  return u;
}
const list = u => call(h.rooms, { method: "GET", headers: u.auth });
const room = (u, id, query = {}) => call(h.room, { method: "GET", headers: u.auth, query: { id, ...query } });
const say = (u, id, body) => call(h.room, { method: "POST", headers: u.auth, query: { id }, body: { body } });
const act = (u, id, action) => call(h.room, { method: "PATCH", headers: u.auth, query: { id }, body: { action } });
const recall = (u, mid) => call(h.message, { method: "DELETE", headers: u.auth, query: { id: String(mid) } });
const block = (u, target) => call(h.blocks, { method: "POST", headers: u.auth, body: { user_id: target.id } });
const report = (u, body) => call(h.reports, { method: "POST", headers: u.auth, body });
async function newRoom(u, body = "하소연") {
  const r = await call(h.rooms, { method: "POST", headers: u.auth, body: { body } });
  assert.equal(r.status, 201);
  return r.json.id;
}
const ADMIN_PW = "test-admin-password-123";   // TEST_ENV.ADMIN_PASSWORD in helpers/vercel-harness.js
const admin = (method, bodyOrQuery = {}, pw = ADMIN_PW) => call(h.admin, method === "GET"
  ? { method, headers: { "x-admin-password": pw }, query: bodyOrQuery }
  : { method, headers: { "x-admin-password": pw }, body: bodyOrQuery });
const msgs = () => fake.rows("cb_messages");
const thread = id => fake.rows("cb_threads").find(t => t.id === id);
const quiet = t => t.mock.method(console, "error", () => {});

describe("/api/message (recall)", () => {
  test("author recalls own message: body wiped for everyone, room marks it removed, last_body replaced", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "첫 말");
    const m = (await say(c, id, "실수로 보냄")).json;
    const r = await recall(c, m.id);
    assert.deepEqual([r.status, r.json], [200, { ok: true }]);
    const row = msgs().find(x => x.id === m.id);
    assert.equal(row.body, "", "content is not kept");
    assert.ok(row.deleted_at);
    assert.equal(thread(id).last_body, "(회수된 메시지)");
    const view = (await room(s, id)).json;
    const vm = view.messages.find(x => x.id === m.id);
    assert.equal(vm.body, "");
    assert.equal(vm.removed, "recalled");
    assert.deepEqual(view.removed, [{ id: m.id, why: "recalled" }]);
    // pollers that already have the message learn about it via `removed` even with after=
    assert.deepEqual((await room(s, id, { after: m.id })).json.removed, [{ id: m.id, why: "recalled" }]);
    assert.deepEqual((await recall(c, m.id)).json, { ok: true, already: true });
  });

  test("recalling an older message keeps last_body; others / bad ids -> 404; other methods 405", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "첫 말");
    await say(c, id, "나중 말");
    const first = msgs()[0];
    assert.equal((await recall(s, first.id)).status, 200);
    assert.equal(thread(id).last_body, "나중 말");
    const theirs = msgs()[1];
    for (const [who, mid] of [[s, theirs.id], [s, 999999], [s, "abc"], [s, -1]]) {
      const r = await recall(who, mid);
      assert.deepEqual([r.status, r.json], [404, { error: "메시지를 찾을 수 없어요." }], String(mid));
    }
    assert.equal((await call(h.message, { method: "GET", headers: s.auth, query: { id: "1" } })).status, 405);
    assert.equal((await call(h.message, { method: "DELETE", query: { id: "1" } })).status, 401);
  });
});

describe("read receipts", () => {
  test("readers = others' read marks (caller excluded); opening the room advances the reader's mark", async () => {
    const s = await signup("철수"), c = await comforter("영희"), c2 = await comforter("민지");
    const id = await newRoom(s, "첫 말");
    const first = msgs()[0].id;
    let v = (await room(s, id)).json;
    assert.deepEqual(v.readers, [], "nobody else has opened it");
    await room(c, id);
    v = (await room(s, id)).json;
    assert.deepEqual(v.readers, [{ name: "영희", emoji: "", last_read_id: first }]);
    await say(c2, id, "나도");
    v = (await room(s, id)).json;
    assert.deepEqual(v.readers.map(r => r.name).sort(), ["민지", "영희"].sort());
    assert.ok(v.readers.find(r => r.name === "민지").last_read_id > first);
  });
});

describe("/api/blocks", () => {
  test("block hides each other's rooms and messages both ways; unblock restores", async () => {
    const s = await signup("철수"), c = await comforter("영희"), c2 = await comforter("민지");
    const id = await newRoom(s, "내 하소연");
    await say(c, id, "영희 답");
    await say(c2, id, "민지 답");

    // seeker blocks 영희
    assert.deepEqual((await block(s, c)).json, { ok: true });
    assert.equal((await block(s, c)).status, 200, "idempotent");
    let v = (await room(s, id)).json;
    assert.deepEqual(v.messages.map(m => m.body), ["내 하소연", "민지 답"], "blocked person's messages hidden from blocker");
    assert.equal(v.participants, 1);
    assert.deepEqual((await list(c)).json.others, [], "and the blocked person no longer sees the blocker's rooms");
    assert.equal((await room(c, id)).status, 404);
    assert.equal((await say(c, id, "또")).status, 404);
    assert.equal((await list(c2)).json.others.length, 1, "uninvolved comforter unaffected");

    const bl = (await call(h.blocks, { method: "GET", headers: s.auth })).json;
    assert.deepEqual(bl.map(b => [b.id, b.nickname, b.emoji]), [[c.id, "영희", ""]]);

    assert.deepEqual((await call(h.blocks, { method: "DELETE", headers: s.auth, query: { user_id: c.id } })).json, { ok: true });
    assert.equal((await room(c, id)).status, 200);
    assert.equal((await room(s, id)).json.messages.length, 3);
  });

  test("validation: self -> 400, unknown/bad id -> 404, auth required, 405", async () => {
    const s = await signup("철수");
    let r = await block(s, s);
    assert.deepEqual([r.status, r.json], [400, { error: "자기 자신은 차단할 수 없어요." }]);
    r = await call(h.blocks, { method: "POST", headers: s.auth, body: { user_id: "6f9619ff-8b86-d011-b42d-00cf4fc964ff" } });
    assert.equal(r.status, 404);
    r = await call(h.blocks, { method: "POST", headers: s.auth, body: { user_id: "nope" } });
    assert.equal(r.status, 404);
    assert.equal((await call(h.blocks, { method: "GET" })).status, 401);
    assert.equal((await call(h.blocks, { method: "PUT", headers: s.auth })).status, 405);
    assert.equal(fake.rows("cb_blocks").length, 0);
  });

  test("rooms list masks the last message when its author is blocked", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "내 하소연");
    await say(c, id, "영희 답");
    await block(s, c);
    const [it] = (await list(s)).json.mine;
    assert.deepEqual(it.last, { text: "(차단한 사람의 메시지)", mine: false, author: "" });
    assert.equal(it.unread, false);
  });
});

describe("/api/reports", () => {
  test("report a message: stored once (409 on repeat); can't report own; block:true also blocks", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "하소연");
    const m = (await say(c, id, "나쁜 말")).json;
    let r = await report(s, { thread_id: id, message_id: m.id, reason: "abuse", detail: "욕함", block: true });
    assert.deepEqual([r.status, r.json], [201, { ok: true, blocked: true }]);
    const [rep] = fake.rows("cb_reports");
    assert.deepEqual([rep.reporter_id, rep.target_user_id, rep.thread_id, rep.message_id, rep.reason, rep.detail], [s.id, c.id, id, m.id, "abuse", "욕함"]);
    assert.equal(fake.rows("cb_blocks").length, 1);
    r = await report(s, { thread_id: id, message_id: m.id, reason: "spam" });
    assert.deepEqual([r.status, r.json], [409, { error: "이미 신고했어요. 확인해 볼게요." }]);
    r = await report(s, { thread_id: id, message_id: msgs()[0].id, reason: "spam" });
    assert.deepEqual([r.status, r.json], [400, { error: "내 글은 신고할 수 없어요." }]);
    r = await report(s, { thread_id: id, reason: "nope" });
    assert.deepEqual([r.status, r.json], [400, { error: "신고 이유를 골라 주세요." }]);
  });

  test("security V-01: reports never auto-hide anything, however many accounts report", async () => {
    const s = await signup("철수"), bad = await comforter("나쁜사람");
    const rs = [await comforter("a"), await comforter("b"), await comforter("c"), await comforter("d")];
    const id = await newRoom(s, "하소연");
    const m = (await say(bad, id, "도배")).json;
    for (const u of [...rs, s]) assert.equal((await report(u, { thread_id: id, message_id: m.id, reason: "spam" })).status, 201);
    for (const u of rs) assert.equal((await report(u, { thread_id: id, reason: "other" })).status, 201);
    assert.equal(msgs().find(x => x.id === m.id).moderated, false);
    assert.equal(thread(id).moderated, false);
    assert.equal(fake.rows("cb_reports").length, 9, "all reports are kept for the admin");
    assert.equal((await room(rs[0], id)).status, 200, "room still visible to comforters");
  });

  test("can't report a room you can't see; message must belong to the room", async () => {
    const s = await signup("철수"), other = await signup("남");
    const id = await newRoom(s, "하소연");
    const id2 = await newRoom(other, "다른 방");
    const c = await comforter("영희");
    assert.equal((await report(other, { thread_id: id, reason: "spam" })).status, 404, "not a comforter");
    const m2 = msgs().find(m => m.thread_id === id2);
    const r = await report(c, { thread_id: id, message_id: m2.id, reason: "spam" });
    assert.deepEqual([r.status, r.json], [404, { error: "메시지를 찾을 수 없어요." }]);
  });
});

describe("/api/reactions", () => {
  const react = (u, message_id, emoji) => call(h.reactions, { method: "POST", headers: u.auth, body: { message_id, emoji } });

  test("toggle on/off; room view summarises per message with counts and `mine`", async () => {
    const s = await signup("철수"), c = await comforter("영희"), c2 = await comforter("민지");
    const id = await newRoom(s, "하소연");
    const mid = msgs()[0].id;
    let r = await react(c, mid, "🫂");
    assert.deepEqual([r.status, r.json], [200, { message_id: mid, on: true, reactions: [{ emoji: "🫂", count: 1, mine: true }] }]);
    await react(c2, mid, "🫂");
    await react(c2, mid, "👍");
    let v = (await room(s, id)).json;
    assert.deepEqual(v.reactions, { [mid]: [{ emoji: "👍", count: 1, mine: false }, { emoji: "🫂", count: 2, mine: false }] }, "ordered as the REACTIONS list");
    r = await react(c, mid, "🫂");
    assert.deepEqual(r.json, { message_id: mid, on: false, reactions: [{ emoji: "👍", count: 1, mine: false }, { emoji: "🫂", count: 1, mine: false }] });
    assert.equal(fake.rows("cb_reactions").length, 2);
    assert.ok(fake.rows("cb_reactions").every(x => x.thread_id === id));
    // returned on every poll, even with after=
    v = (await room(c2, id, { after: mid })).json;
    assert.deepEqual(v.reactions[mid].map(x => [x.emoji, x.mine]), [["👍", true], ["🫂", true]]);
  });

  test("rejects: unknown emoji 400, recalled/moderated message 400, unseen room 404, blocked author 400; 405/401", async () => {
    const s = await signup("철수"), c = await comforter("영희"), stranger = await signup("남");
    const id = await newRoom(s, "하소연");
    const mid = msgs()[0].id;
    let r = await react(c, mid, "💩");
    assert.deepEqual([r.status, r.json], [400, { error: "고를 수 있는 반응이 아니에요." }]);
    r = await react(stranger, mid, "👍");
    assert.equal(r.status, 404, "not a comforter -> can't see the room");
    r = await react(c, 999999, "👍");
    assert.deepEqual([r.status, r.json], [404, { error: "메시지를 찾을 수 없어요." }]);
    const m2 = (await say(c, id, "실수")).json;
    await recall(c, m2.id);
    r = await react(s, m2.id, "👍");
    assert.deepEqual([r.status, r.json], [400, { error: "반응할 수 없는 메시지예요." }]);
    await block(c, s);
    r = await react(s, mid, "👍");
    assert.equal(r.status, 200, "own message is fine");
    assert.equal((await call(h.reactions, { method: "GET", headers: s.auth })).status, 405);
    assert.equal((await call(h.reactions, { method: "POST", body: {} })).status, 401);
  });

  test("blocked people's reactions are hidden from the blocker; deleting a user removes their reactions", async () => {
    const s = await signup("철수"), c = await comforter("영희"), c2 = await comforter("민지");
    const id = await newRoom(s, "하소연");
    const mid = msgs()[0].id;
    await react(c, mid, "🔥"); await react(c2, mid, "🔥");
    await block(s, c);
    assert.deepEqual((await room(s, id)).json.reactions[mid], [{ emoji: "🔥", count: 1, mine: false }]);
    await call(h.me, { method: "DELETE", headers: c2.auth });
    assert.deepEqual(fake.rows("cb_reactions").map(r => r.user_id), [c.id]);
  });
});

describe("security fixes 2026-11-06 (보안점검 V-03 / V-07 / V-10 / V-11)", () => {
  test("V-03: recalling the first message also replaces the room title; recalling the last replaces the preview", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "회사 이름 들어간 첫 하소연");
    const first = msgs()[0];
    assert.equal(thread(id).title, "회사 이름 들어간 첫 하소연");
    await recall(s, first.id);
    assert.equal(thread(id).title, "(회수된 메시지)");
    assert.equal(thread(id).last_body, "(회수된 메시지)");
    assert.equal((await list(c)).json.others[0].title, "(회수된 메시지)");
    // a later, non-first message: title untouched
    const m2 = (await say(s, id, "두 번째")).json;
    await say(c, id, "답");
    await recall(s, m2.id);
    assert.equal(thread(id).last_body, "답", "not the last one -> preview untouched");
  });

  test("V-03: a message hidden by the admin no longer shows in the sidebar preview or title", async () => {
    const s = await signup("철수"), bad = await comforter("나쁜사람");
    const id = await newRoom(s, "하소연");
    const m = (await say(bad, id, "욕설 원문")).json;
    assert.equal((await admin("POST", { action: "hide_message", message_id: m.id })).status, 200);
    assert.equal(thread(id).last_body, "(신고로 가려진 메시지)");
    assert.equal(thread(id).title, "하소연", "title is the seeker's first message, untouched");
    assert.equal((await list(s)).json.mine[0].last.text, "(신고로 가려진 메시지)");
  });

  test("V-03: deleting an account recomputes previews to a recalled/moderated placeholder or empty", async () => {
    const s = await signup("철수"), c = await comforter("영희"), c2 = await comforter("민지");
    const id = await newRoom(s, "하소연");
    const keep = (await say(c2, id, "먼저 쓴 답")).json;
    await recall(c2, keep.id);
    await say(c, id, "곧 탈퇴할 사람 말");
    await call(h.me, { method: "DELETE", headers: c.auth });
    assert.equal(thread(id).last_id, keep.id);
    assert.equal(thread(id).last_body, "(회수된 메시지)");
  });

  test("V-07: prototype keys like toString / constructor are rejected as reasons (400, not 500)", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "하소연");
    for (const reason of ["toString", "constructor", "__proto__", "hasOwnProperty", 1, null]) {
      const r = await report(c, { thread_id: id, reason });
      assert.deepEqual([r.status, r.json], [400, { error: "신고 이유를 골라 주세요." }], String(reason));
    }
    assert.equal(fake.rows("cb_reports").length, 0);
  });

  test("V-11: message ids must be plain digits (\"12abc\", \"1e3\", \" 1\", 0 rejected as 404)", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "하소연");
    const mid = msgs()[0].id;
    for (const bad of [`${mid}abc`, "1e3", "0", "-1", "", "0x1", `${mid}.0`]) {
      assert.equal((await recall(s, bad)).status, 404, `recall ${bad}`);
      assert.equal((await call(h.reactions, { method: "POST", headers: c.auth, body: { message_id: bad, emoji: "👍" } })).status, 404, `react ${bad}`);
    }
    assert.equal((await report(c, { thread_id: id, message_id: `${mid}abc`, reason: "spam" })).status, 404);
    assert.equal((await call(h.reactions, { method: "POST", headers: c.auth, body: { message_id: mid, emoji: "👍" } })).status, 200, "number ok");
    assert.equal((await call(h.reactions, { method: "POST", headers: c.auth, body: { message_id: String(mid), emoji: "😢" } })).status, 200, "digit string ok");
  });

  test("V-11: non-string text fields are rejected instead of being stored as \"[object Object]\"", async () => {
    let r = await call(h.me, { method: "POST", body: { nickname: { a: 1 } } });
    assert.deepEqual([r.status, r.json], [400, { error: "닉네임 형식이 올바르지 않아요." }]);
    r = await call(h.me, { method: "POST", body: { nickname: ["철수"] } });
    assert.equal(r.status, 400);
    const s = await signup("철수");
    r = await call(h.rooms, { method: "POST", headers: s.auth, body: { body: { x: 1 } } });
    assert.deepEqual([r.status, r.json], [400, { error: "하소연 형식이 올바르지 않아요." }]);
    r = await call(h.rooms, { method: "POST", headers: s.auth, body: { body: 123 } });
    assert.equal(r.status, 400);
    assert.equal(fake.rows("cb_threads").length, 0);
  });

  test("V-11: invisible / direction-control characters are stripped from nicknames; emoji ZWJ kept", async () => {
    let r = await call(h.me, { method: "POST", body: { nickname: "영​희‮﻿" } });
    assert.equal(r.json.nickname, "영희");
    r = await call(h.me, { method: "POST", body: { nickname: "👩‍💻개발자" } });
    assert.equal(r.json.nickname, "👩‍💻개발자", "ZWJ inside the emoji survives");
    r = await call(h.me, { method: "POST", body: { nickname: "​‎⁠" } });
    assert.deepEqual([r.status, r.json], [400, { error: "닉네임을(를) 적어 주세요." }], "only invisible chars -> empty");
    const u = await signup("철수");
    r = await call(h.me, { method: "PATCH", headers: u.auth, body: { nickname: "철‮수" } });
    assert.equal(r.json.nickname, "철수");
  });

  test("V-10: titles and previews are cut on whole characters (no half emoji)", async () => {
    const s = await signup("철수");
    const body = "가".repeat(39) + "😀😀😀";            // the 40th character is an emoji
    const id = await newRoom(s, body);
    const t = thread(id);
    assert.equal(t.title, "가".repeat(39) + "😀");
    assert.ok(!/[\uD800-\uDBFF]$/.test(t.title), "no lone high surrogate at the end");
    const long = "나".repeat(119) + "🔥🔥";
    await say(s, id, long);
    assert.equal(thread(id).last_body, "나".repeat(119) + "🔥");
  });
});

describe("security V-02: account creation per IP", () => {
  const signupFrom = (ip, nickname = "x") => call(h.me, { method: "POST", headers: { "x-forwarded-for": `${ip}, 10.0.0.1` }, body: { nickname } });

  test("20 signups per IP per day; the 21st is 429; other IPs unaffected; only a hash is stored", async () => {
    for (let i = 0; i < 20; i++) assert.equal((await signupFrom("203.0.113.7", `u${i}`)).status, 201);
    const r = await signupFrom("203.0.113.7", "u20");
    assert.deepEqual([r.status, r.json], [429, { error: "이 곳에서는 오늘 닉네임을 더 만들 수 없어요. 내일 다시 해 주세요." }]);
    assert.equal(fake.rows("cb_users").length, 20, "nothing created on 429");
    assert.equal((await signupFrom("198.51.100.9", "other")).status, 201);
    const logs = fake.rows("cb_signup_log");
    assert.equal(logs.length, 21);
    assert.ok(logs.every(l => /^[0-9a-f]{64}$/.test(l.ip_hash)), "sha256 hex, not the raw IP");
    assert.ok(!JSON.stringify(logs).includes("203.0.113.7"));
  });

  test("entries older than a day don't count; older than 2 days are deleted; no IP header -> no limit", async () => {
    for (let i = 0; i < 20; i++) await signupFrom("203.0.113.8", `u${i}`);
    for (const l of fake.raw("cb_signup_log").slice(0, 5)) l.created_at = new Date(Date.now() - 25 * 3600_000).toISOString();
    for (const l of fake.raw("cb_signup_log").slice(5, 7)) l.created_at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    assert.equal((await signupFrom("203.0.113.8", "again")).status, 201, "only 13 in the last day now");
    assert.equal(fake.rows("cb_signup_log").length, 19, "2 entries older than 2 days were pruned (20 - 2 + 1)");
    for (let i = 0; i < 25; i++) assert.equal((await call(h.me, { method: "POST", body: { nickname: `n${i}` } })).status, 201);
  });
});

describe("/api/admin (security V-01)", () => {
  test("password required: missing/wrong -> 401 after a delay; not configured -> 503", async t => {
    assert.deepEqual([(await admin("GET", {}, "")).status, (await admin("GET", {}, "wrong")).json], [401, { error: "관리자 비밀번호가 맞지 않아요." }]);
    const saved = process.env.ADMIN_PASSWORD;
    try {
      delete process.env.ADMIN_PASSWORD;
      const r = await admin("GET");
      assert.deepEqual([r.status, r.json], [503, { error: "관리자 비밀번호가 아직 설정되지 않았어요." }]);
    } finally { process.env.ADMIN_PASSWORD = saved; }
  });

  test("lists open reports with names, room and message; resolve / reopen", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "하소연 제목");
    const m = (await say(c, id, "나쁜 말")).json;
    await report(s, { thread_id: id, message_id: m.id, reason: "abuse", detail: "욕함" });
    let r = await admin("GET");
    assert.equal(r.status, 200);
    const [it] = r.json.reports;
    assert.deepEqual(
      [it.reason, it.reason_label, it.detail, it.reporter, it.target, it.room.title, it.message.body, it.message.moderated, it.reviewed_at],
      ["abuse", "욕설·비하", "욕함", "철수", "영희", "하소연 제목", "나쁜 말", false, null]);
    assert.deepEqual((await admin("POST", { action: "resolve", report_id: it.id })).json, { ok: true });
    assert.deepEqual((await admin("GET")).json.reports, [], "resolved reports leave the open list");
    assert.equal((await admin("GET", { status: "all" })).json.reports.length, 1);
    await admin("POST", { action: "reopen", report_id: it.id });
    assert.equal((await admin("GET")).json.reports.length, 1);
  });

  test("hide / unhide a message restores title and sidebar preview", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "첫 하소연");
    const first = msgs()[0];
    await admin("POST", { action: "hide_message", message_id: first.id });
    assert.deepEqual([thread(id).title, thread(id).last_body], ["(신고로 가려진 메시지)", "(신고로 가려진 메시지)"]);
    assert.equal((await room(c, id)).json.messages[0].removed, "moderated");
    await admin("POST", { action: "unhide_message", message_id: first.id });
    assert.deepEqual([thread(id).title, thread(id).last_body], ["첫 하소연", "첫 하소연"]);
    assert.equal((await room(c, id)).json.messages[0].body, "첫 하소연");
  });

  test("hide / unhide a room: hidden from comforters, seeker still sees it", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "하소연");
    await admin("POST", { action: "hide_room", thread_id: id });
    assert.equal((await room(c, id)).status, 404);
    assert.equal((await room(s, id)).json.moderated, true);
    await admin("POST", { action: "unhide_room", thread_id: id });
    assert.equal((await room(c, id)).status, 200);
  });

  test("bad input: unknown action 400, bad ids 404, method 405", async () => {
    assert.equal((await admin("POST", { action: "nuke" })).status, 400);
    assert.equal((await admin("POST", { action: "hide_message", message_id: "12abc" })).status, 404);
    assert.equal((await admin("POST", { action: "hide_room", thread_id: "6f9619ff-8b86-d011-b42d-00cf4fc964ff" })).status, 404);
    assert.equal((await admin("POST", { action: "resolve", report_id: 999 })).status, 404);
    assert.equal((await call(h.admin, { method: "DELETE", headers: { "x-admin-password": ADMIN_PW } })).status, 405);
  });
});

describe("room prefs (hide / stop) via PATCH /api/room {action}", () => {
  test("hide moves a room to `hidden`; a newer message brings it back; unhide clears", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "하소연");
    assert.deepEqual((await act(c, id, "hide")).json, { ok: true, hidden: true, stopped: false });
    let l = (await list(c)).json;
    assert.deepEqual(l.others, []);
    assert.deepEqual(l.hidden.map(r => [r.id, r.kind, r.hidden]), [[id, "others", true]]);
    assert.equal((await room(c, id)).json.hidden, true);
    // a later message un-hides it in the list
    mock.timers.enable({ apis: ["Date"], now: Date.now() + 5000 });
    await say(s, id, "더 할 말");
    l = (await list(c)).json;
    assert.deepEqual(l.others.map(r => r.id), [id]);
    assert.deepEqual(l.hidden, []);
    assert.deepEqual((await act(c, id, "unhide")).json, { ok: true, hidden: false, stopped: false });
    // the seeker can hide their own room too
    await act(s, id, "hide");
    assert.deepEqual((await list(s)).json.hidden.map(r => r.kind), ["mine"]);
  });

  test("stop: comforter leaves a room (listed under hidden, can't post) until resume; owner can't stop", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "하소연");
    assert.deepEqual((await act(c, id, "stop")).json, { ok: true, hidden: false, stopped: true });
    const l = (await list(c)).json;
    assert.deepEqual(l.others, []);
    assert.equal(l.hidden[0].stopped, true);
    let r = await say(c, id, "답");
    assert.deepEqual([r.status, r.json], [400, { error: "편들어 주기를 그만둔 방이에요. '다시 편들기'를 누르면 쓸 수 있어요." }]);
    assert.equal((await room(c, id)).json.stopped, true);
    await say(s, id, "새 메시지");
    assert.deepEqual((await list(c)).json.others, [], "new messages don't bring a stopped room back");
    assert.deepEqual((await act(c, id, "resume")).json, { ok: true, hidden: false, stopped: false });
    assert.equal((await say(c, id, "다시 왔어")).status, 201);
    r = await act(s, id, "stop");
    assert.deepEqual([r.status, r.json], [400, { error: "내 하소연 방은 숨기기나 닫기를 써 주세요." }]);
    r = await act(c, id, "explode");
    assert.deepEqual([r.status, r.json], [400, { error: "알 수 없는 요청이에요." }]);
  });

  test("PATCH with no body still means close (owner only)", async () => {
    const s = await signup("철수"), c = await comforter("영희");
    const id = await newRoom(s, "하소연");
    assert.equal((await call(h.room, { method: "PATCH", headers: c.auth, query: { id } })).status, 403);
    assert.equal((await call(h.room, { method: "PATCH", headers: s.auth, query: { id } })).status, 200);
    assert.equal(thread(id).closed, true);
  });

  test("DB error in a new endpoint -> 500 generic", async t => {
    quiet(t);
    const s = await signup("철수");
    fake.failNext({ table: "cb_blocks", op: "select" });
    const r = await call(h.blocks, { method: "GET", headers: s.auth });
    assert.equal(r.status, 500);
  });
});
