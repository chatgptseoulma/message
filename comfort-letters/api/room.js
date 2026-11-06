// 하소연 방 하나 (단체 메신저)
//  GET ?id=&after=<메시지id> : after보다 새 메시지만 (없으면 전체). 읽음 위치 저장.
//                              회수·가려진 메시지 id(removed), 읽은 사람 목록(readers), 공감 반응(reactions)은 매번 방 전체를 돌려준다
//  POST ?id=                  : 메시지 보내기 (방 주인 또는 편들어 주기 등록자. 그만둔 방·닫힌 방은 불가)
//  PATCH ?id= {action}        : close(기본, 방 주인만) / hide / unhide / stop / resume
import { db, send, handle, body, text, currentUser, checkRate, Invalid } from "../lib/common.js";
import { loadRoom, postMessage, prefsFor, setPref, summarizeReactions } from "../lib/rooms.js";

export default handle(async (req, res) => {
  const user = await currentUser(req);
  const { t, blocked } = await loadRoom(String(req.query.id || ""), user);
  const isOwner = t.seeker_id === user.id;

  if (req.method === "GET") {
    const after = Number.parseInt(req.query.after, 10);
    let q = db().from("cb_messages").select("id, author_id, body, created_at, deleted_at, moderated").eq("thread_id", t.id).order("id").limit(1000);
    if (Number.isFinite(after) && after > 0) q = q.gt("id", after);
    const [{ data: msgs, error }, { data: flags, error: e0 }, { data: reads, error: e1 }, prefs, { data: reacts, error: e3 }] = await Promise.all([
      q,
      db().from("cb_messages").select("id, author_id, deleted_at, moderated").eq("thread_id", t.id).limit(5000),
      db().from("cb_reads").select("user_id, last_read_id").eq("thread_id", t.id),
      prefsFor(user.id, [t.id]),
      db().from("cb_reactions").select("message_id, user_id, emoji").eq("thread_id", t.id).limit(5000),
    ]);
    if (error) throw error;
    if (e0) throw e0;
    if (e1) throw e1;
    if (e3) throw e3;

    const visible = msgs.filter(m => !blocked.has(m.author_id));
    const readerRows = reads.filter(r => r.user_id !== user.id && !blocked.has(r.user_id));
    const people = [...new Set([t.seeker_id, ...visible.map(m => m.author_id), ...readerRows.map(r => r.user_id)])];
    const [{ data: users, error: e2 }] = await Promise.all([
      db().from("cb_users").select("id, nickname, emoji").in("id", people),
      t.last_id ? db().from("cb_reads").upsert({ thread_id: t.id, user_id: user.id, last_read_id: t.last_id }, { onConflict: "thread_id,user_id" }) : Promise.resolve({}),
    ]);
    if (e2) throw e2;
    const who = Object.fromEntries(users.map(u => [u.id, u]));
    const p = prefs[t.id];
    // 참여한 편들어 주는 사람 수 (방 주인 빼고 글을 쓴 사람)
    const participants = new Set(flags.filter(m => m.author_id !== t.seeker_id && !blocked.has(m.author_id)).map(m => m.author_id)).size;

    return send(res, 200, {
      id: t.id,
      title: t.title,
      seeker: who[t.seeker_id]?.nickname ?? "(알 수 없음)",
      seeker_emoji: who[t.seeker_id]?.emoji ?? "",
      seeker_id: t.seeker_id,
      owner: isOwner,
      legacy: t.comforter_id !== null,
      closed: t.closed,
      moderated: t.moderated,
      stopped: Boolean(p?.stopped),
      hidden: Boolean(p?.hidden_at),
      participants,
      messages: visible.map(m => {
        const gone = m.deleted_at ? "recalled" : m.moderated ? "moderated" : null;
        return {
          id: m.id, mine: m.author_id === user.id,
          author: who[m.author_id]?.nickname ?? "(알 수 없음)", author_emoji: who[m.author_id]?.emoji ?? "", author_id: m.author_id,
          by_seeker: m.author_id === t.seeker_id, body: gone ? "" : m.body, at: m.created_at, removed: gone,
        };
      }),
      removed: flags.filter(m => m.deleted_at || m.moderated).map(m => ({ id: m.id, why: m.deleted_at ? "recalled" : "moderated" })),
      readers: readerRows.map(r => ({ name: who[r.user_id]?.nickname ?? "(알 수 없음)", emoji: who[r.user_id]?.emoji ?? "", last_read_id: r.last_read_id })),
      reactions: summarizeReactions(reacts, user.id, blocked),
    });
  }

  if (req.method === "POST") {
    if (t.closed) throw new Invalid("닫힌 방이에요. 이력만 볼 수 있어요.");
    const prefs = await prefsFor(user.id, [t.id]);
    if (prefs[t.id]?.stopped) throw new Invalid("편들어 주기를 그만둔 방이에요. '다시 편들기'를 누르면 쓸 수 있어요.");
    const msg = text(body(req).body, { min: 1, max: 2000, label: "메시지" });
    await checkRate(user.id);   // 제한에 걸리면 저장하지 않음
    const m = await postMessage(t.id, user.id, msg);
    return send(res, 201, {
      id: m.id, mine: true, author: user.nickname, author_emoji: user.emoji ?? "", author_id: user.id,
      by_seeker: isOwner, body: m.body, at: m.created_at, removed: null,
    });
  }

  if (req.method === "PATCH") {
    let action = "close";
    try { const b = body(req); if (b.action !== undefined) action = String(b.action); } catch { /* 본문 없음 = 닫기 */ }
    if (action === "close") {
      if (!isOwner && t.comforter_id !== user.id) throw new Invalid("방은 하소연한 사람만 닫을 수 있어요.", 403);
      const { error } = await db().from("cb_threads").update({ closed: true, updated_at: new Date().toISOString() }).eq("id", t.id);
      if (error) throw error;
      return send(res, 200, { ok: true });
    }
    if (action === "hide") return send(res, 200, { ok: true, ...(await setPref(t.id, user.id, { hidden_at: new Date().toISOString() })) });
    if (action === "unhide") return send(res, 200, { ok: true, ...(await setPref(t.id, user.id, { hidden_at: null })) });
    if (action === "stop" || action === "resume") {
      if (isOwner) throw new Invalid("내 하소연 방은 숨기기나 닫기를 써 주세요.");
      return send(res, 200, { ok: true, ...(await setPref(t.id, user.id, { stopped: action === "stop" })) });
    }
    throw new Invalid("알 수 없는 요청이에요.");
  }
  send(res, 405, { error: "허용되지 않은 요청이에요." });
});
