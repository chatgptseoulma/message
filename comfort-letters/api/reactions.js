// POST {message_id, emoji} : 말풍선 공감 반응 켜기/끄기 (같은 반응을 다시 누르면 취소)
//  - 볼 수 있는 방의 메시지에만, 회수·가려진 메시지에는 불가
//  - 응답: 그 메시지의 반응 요약 [{emoji, count, mine}]
import { db, send, handle, body, currentUser, Invalid, positiveId } from "../lib/common.js";
import { loadRoom, REACTIONS, summarizeReactions } from "../lib/rooms.js";

export default handle(async (req, res) => {
  const user = await currentUser(req);
  if (req.method !== "POST") return send(res, 405, { error: "허용되지 않은 요청이에요." });
  const b = body(req);
  if (!REACTIONS.includes(b.emoji)) throw new Invalid("고를 수 있는 반응이 아니에요.");
  const id = positiveId(b.message_id);
  if (!id) throw new Invalid("메시지를 찾을 수 없어요.", 404);

  const { data: m, error } = await db().from("cb_messages").select("id, thread_id, author_id, deleted_at, moderated").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!m) throw new Invalid("메시지를 찾을 수 없어요.", 404);
  const { t, blocked } = await loadRoom(m.thread_id, user);   // 볼 수 없는 방이면 404
  if (blocked.has(m.author_id) || m.deleted_at || m.moderated) throw new Invalid("반응할 수 없는 메시지예요.");

  const { data: cur, error: e1 } = await db().from("cb_reactions").select("emoji")
    .eq("message_id", id).eq("user_id", user.id).eq("emoji", b.emoji).maybeSingle();
  if (e1) throw e1;
  if (cur) {
    const { error: e2 } = await db().from("cb_reactions").delete().eq("message_id", id).eq("user_id", user.id).eq("emoji", b.emoji);
    if (e2) throw e2;
  } else {
    // 한 사람이 한 메시지에 같은 반응은 하나만 (기본 키), 종류는 6가지뿐이라 따로 횟수 제한은 두지 않음
    const { error: e3 } = await db().from("cb_reactions").insert({ message_id: id, thread_id: t.id, user_id: user.id, emoji: b.emoji });
    if (e3) throw e3;
  }
  const { data: rows, error: e4 } = await db().from("cb_reactions").select("message_id, user_id, emoji").eq("message_id", id);
  if (e4) throw e4;
  return send(res, 200, { message_id: id, on: !cur, reactions: summarizeReactions(rows, user.id, blocked)[id] ?? [] });
});
