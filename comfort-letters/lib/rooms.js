// 하소연 방 공통: 접근 권한, 차단 관계, 방별 개인 설정, 메시지 저장 후 방 정보 갱신
import { db, Invalid, isUuid } from "./common.js";

export async function isComforter(userId) {
  const { data, error } = await db().from("cb_comforters").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

// 나와 차단 관계인 사람들 (내가 차단했거나, 나를 차단한 사람). 서로의 방·메시지가 안 보인다
export async function blockedSet(userId) {
  const [a, b] = await Promise.all([
    db().from("cb_blocks").select("blocked_id").eq("blocker_id", userId),
    db().from("cb_blocks").select("blocker_id").eq("blocked_id", userId),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  return new Set([...a.data.map(r => r.blocked_id), ...b.data.map(r => r.blocker_id)]);
}

// 방별 개인 설정 { thread_id: {hidden_at, stopped} }
export async function prefsFor(userId, threadIds) {
  if (!threadIds.length) return {};
  const { data, error } = await db().from("cb_room_prefs").select("thread_id, hidden_at, stopped").eq("user_id", userId).in("thread_id", threadIds);
  if (error) throw error;
  return Object.fromEntries(data.map(p => [p.thread_id, p]));
}
export async function setPref(threadId, userId, patch) {
  const { data: cur, error: e1 } = await db().from("cb_room_prefs").select("hidden_at, stopped").eq("thread_id", threadId).eq("user_id", userId).maybeSingle();
  if (e1) throw e1;
  const row = { thread_id: threadId, user_id: userId, hidden_at: cur?.hidden_at ?? null, stopped: cur?.stopped ?? false, ...patch };
  const { error } = await db().from("cb_room_prefs").upsert(row, { onConflict: "thread_id,user_id" });
  if (error) throw error;
  return { hidden: Boolean(row.hidden_at), stopped: row.stopped };
}

// 내 계정을 만든 뒤에 생긴 방인가 (계정을 만들기 전의 하소연은 보여주지 않는다)
export const madeAfterJoin = (t, user) => Date.parse(t.created_at) >= Date.parse(user.created_at);

// 볼 수 있는 사람: 방 주인(위로받는 사람)
//   / 모두에게 보낸 방이면 편들어 주기 등록자 중, 그 방이 생기기 전에 계정을 만들었고,
//     방 주인과 차단 관계가 아니며, 신고 누적으로 가려지지 않은 방
//   / 예전 1:1 방이면 그 상대
export function canView(t, user, comforter, blocked = new Set()) {
  if (t.seeker_id === user.id) return true;
  if (blocked.has(t.seeker_id)) return false;
  if (t.comforter_id === null) return comforter && madeAfterJoin(t, user) && !t.moderated;
  return t.comforter_id === user.id;
}

export async function loadRoom(id, user) {
  if (!isUuid(id)) throw new Invalid("방을 찾을 수 없어요.", 404);
  const [{ data: t, error }, comforter, blocked] = await Promise.all([
    db().from("cb_threads").select("*").eq("id", id).maybeSingle(),
    isComforter(user.id),
    blockedSet(user.id),
  ]);
  if (error) throw error;
  // 볼 수 없는 방은 있는지조차 알려주지 않는다
  if (!t || !canView(t, user, comforter, blocked)) throw new Invalid("방을 찾을 수 없어요.", 404);
  return { t, comforter, blocked };
}

// 메시지를 저장하고 방의 마지막 메시지·시각을 갱신
export async function postMessage(threadId, userId, body, extra = {}) {
  const { data: m, error } = await db().from("cb_messages")
    .insert({ thread_id: threadId, author_id: userId, body })
    .select("id, author_id, body, created_at").single();
  if (error) throw error;
  const [{ error: e2 }, { error: e3 }] = await Promise.all([
    db().from("cb_threads").update({
      last_id: m.id, last_body: cut(body, 120), last_author: userId, updated_at: m.created_at, ...extra,
    }).eq("id", threadId),
    // 내가 쓴 건 내가 읽은 것
    db().from("cb_reads").upsert({ thread_id: threadId, user_id: userId, last_read_id: m.id }, { onConflict: "thread_id,user_id" }),
  ]);
  if (e2) throw e2;
  if (e3) throw e3;
  return m;
}

// 신고 이유 (api/reports.js 검증, api/admin.js 표시)
export const REASONS = { abuse: "욕설·비하", spam: "도배·광고", privacy: "개인정보 노출", sexual: "성적인 내용", other: "기타" };

// 공감 반응: 고를 수 있는 것과, 메시지별 요약 { messageId: [{emoji, count, mine}] } (차단 관계인 사람 반응은 뺌)
export const REACTIONS = ["👍", "😢", "🔥", "😡", "🫂", "💪"];
export function summarizeReactions(rows, userId, blocked = new Set()) {
  const out = {};
  for (const r of rows) {
    if (blocked.has(r.user_id)) continue;
    const list = (out[r.message_id] ??= []);
    let e = list.find(x => x.emoji === r.emoji);
    if (!e) { e = { emoji: r.emoji, count: 0, mine: false }; list.push(e); }
    e.count++;
    if (r.user_id === userId) e.mine = true;
  }
  for (const list of Object.values(out)) list.sort((a, b) => REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji));
  return out;
}

// 글자 단위로 자르기 (이모지 같은 2칸짜리 문자를 반쪽으로 자르지 않게) — 보안점검 V-10
export const cut = (s, n) => Array.from(String(s)).slice(0, n).join("");

// 메시지 내용이 지워지거나 가려졌을 때, 방 제목(첫 메시지)과 목록 미리보기(마지막 메시지)에 남은 흔적도 지운다 — 보안점검 V-03
export async function scrubTraces(t, messageId, placeholder) {
  const patch = {};
  if (t.last_id === messageId) patch.last_body = placeholder;
  const { data: first, error } = await db().from("cb_messages").select("id").eq("thread_id", t.id).order("id", { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  if (first?.id === messageId) patch.title = placeholder;
  if (!Object.keys(patch).length) return;
  const { error: e2 } = await db().from("cb_threads").update(patch).eq("id", t.id);
  if (e2) throw e2;
}

// 사용자가 탈퇴한 뒤, 그 사람이 마지막으로 쓴 남의 방들의 미리보기를 남은 메시지로 다시 계산 — 보안점검 V-03
export async function recomputeLast(threadIds) {
  for (const id of threadIds) {
    const { data: m, error } = await db().from("cb_messages").select("id, author_id, body, deleted_at, moderated")
      .eq("thread_id", id).order("id", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    const patch = m
      ? { last_id: m.id, last_author: m.author_id, last_body: m.deleted_at ? RECALLED : m.moderated ? MODERATED : cut(m.body, 120) }
      : { last_id: 0, last_author: null, last_body: "" };
    const { error: e2 } = await db().from("cb_threads").update(patch).eq("id", id);
    if (e2) throw e2;
  }
}

export const RECALLED = "(회수된 메시지)";
export const MODERATED = "(신고로 가려진 메시지)";
export const BLOCKED_LAST = "(차단한 사람의 메시지)";
