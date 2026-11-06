// GET : 왼쪽 목록
//   mine   = 내 하소연 방
//   others = (편들어 주기 등록자라면) 내 계정을 만든 뒤에 올라온 남의 하소연 방. 차단 관계·신고로 가려진 방 제외
//   hidden = 내가 숨겼거나(새 메시지 오기 전까지) 편들어 주기를 그만둔 방
// POST: 새로 쏟아내기 — 내 하소연 방을 새로 만들고, 편들어 주기 등록자 모두에게 보임
import { db, send, handle, body, text, currentUser, checkRate, Invalid, ROOMS_PER_DAY } from "../lib/common.js";
import { isComforter, blockedSet, prefsFor, postMessage, BLOCKED_LAST, cut } from "../lib/rooms.js";

const COLS = "id, seeker_id, comforter_id, title, last_id, last_body, last_author, closed, moderated, created_at, updated_at";

export default handle(async (req, res) => {
  const user = await currentUser(req);

  if (req.method === "GET") {
    const [comforter, blocked] = await Promise.all([isComforter(user.id), blockedSet(user.id)]);
    const [mine, others, legacy] = await Promise.all([
      db().from("cb_threads").select(COLS).eq("seeker_id", user.id).order("updated_at", { ascending: false }).limit(100),
      // 내 계정을 만든 뒤에 올라온 하소연만, 신고로 가려진 방은 빼고
      comforter
        ? db().from("cb_threads").select(COLS).is("comforter_id", null).neq("seeker_id", user.id)
            .eq("moderated", false).gte("created_at", user.created_at).order("updated_at", { ascending: false }).limit(100)
        : Promise.resolve({ data: [] }),
      db().from("cb_threads").select(COLS).eq("comforter_id", user.id).order("updated_at", { ascending: false }).limit(50),
    ]);
    for (const r of [mine, others, legacy]) if (r.error) throw r.error;
    const theirs = [...others.data, ...legacy.data].filter(t => !blocked.has(t.seeker_id));
    const all = [...mine.data, ...theirs];

    const ids = all.map(t => t.id);
    const people = [...new Set(all.flatMap(t => [t.seeker_id, t.last_author]).filter(Boolean))];
    const [{ data: reads, error: e1 }, { data: users, error: e2 }, prefs] = await Promise.all([
      ids.length ? db().from("cb_reads").select("thread_id, last_read_id").eq("user_id", user.id).in("thread_id", ids) : Promise.resolve({ data: [] }),
      people.length ? db().from("cb_users").select("id, nickname, emoji").in("id", people) : Promise.resolve({ data: [] }),
      prefsFor(user.id, ids),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    const readOf = Object.fromEntries(reads.map(r => [r.thread_id, r.last_read_id]));
    const who = Object.fromEntries(users.map(u => [u.id, u]));

    const view = t => {
      const p = prefs[t.id];
      return {
        id: t.id,
        title: t.title || "(제목 없음)",
        seeker: who[t.seeker_id]?.nickname ?? "(알 수 없음)",
        seeker_emoji: who[t.seeker_id]?.emoji ?? "",
        seeker_id: t.seeker_id,
        legacy: t.comforter_id !== null,
        closed: t.closed,
        updated_at: t.updated_at,
        last: t.last_id ? {
          text: blocked.has(t.last_author) ? BLOCKED_LAST : t.last_body,
          mine: t.last_author === user.id,
          author: blocked.has(t.last_author) ? "" : who[t.last_author]?.nickname ?? "",
        } : null,
        unread: t.last_id > (readOf[t.id] ?? 0) && t.last_author !== user.id && !blocked.has(t.last_author),
        stopped: Boolean(p?.stopped),
        // 숨긴 뒤에 새 메시지가 오면 다시 목록에 나타난다
        hidden: Boolean(p?.hidden_at) && Date.parse(t.updated_at) <= Date.parse(p.hidden_at),
      };
    };
    const shown = r => !r.stopped && !r.hidden;
    const mineV = mine.data.map(view);
    const othersV = theirs.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(view);
    return send(res, 200, {
      comforter,
      mine: mineV.filter(shown),
      others: othersV.filter(shown),
      hidden: [...mineV.filter(r => !shown(r)).map(r => ({ ...r, kind: "mine" })), ...othersV.filter(r => !shown(r)).map(r => ({ ...r, kind: "others" }))],
    });
  }

  if (req.method === "POST") {
    const msg = text(body(req).body, { min: 1, max: 2000, label: "하소연" });
    // 하루 방 개수 제한 (보안점검 V-02): 방 하나가 편들어 주는 사람 모두에게 알림으로 가기 때문
    const { count: today, error: ce } = await db().from("cb_threads").select("id", { count: "exact", head: true })
      .eq("seeker_id", user.id).gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
    if (ce) throw ce;
    if (today >= ROOMS_PER_DAY) throw new Invalid(`하소연 방은 하루 ${ROOMS_PER_DAY}개까지 만들 수 있어요. 지금 있는 방에 이어서 쏟아내 주세요.`, 429);
    await checkRate(user.id);
    const { data: t, error } = await db().from("cb_threads")
      .insert({ seeker_id: user.id, comforter_id: null, title: cut(msg.replace(/\s+/g, " "), 40), seeker_unread: false, comforter_unread: false })
      .select("id").single();
    if (error) throw error;
    try {
      await postMessage(t.id, user.id, msg);
    } catch (e) {
      await db().from("cb_threads").delete().eq("id", t.id);
      throw e;
    }
    // 몇 명에게 보였는지 (나 빼고 지금 하소연 받는 사람 수)
    const { count } = await db().from("cb_comforters").select("user_id", { count: "exact", head: true }).eq("active", true).neq("user_id", user.id);
    return send(res, 201, { id: t.id, reach: count ?? 0 });
  }
  send(res, 405, { error: "허용되지 않은 요청이에요." });
});
