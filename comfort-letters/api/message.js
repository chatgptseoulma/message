// DELETE ?id=<메시지id> : 내가 보낸 메시지 회수 (모두에게서 내용이 지워지고 "회수된 메시지"로 표시)
import { db, send, handle, currentUser, Invalid, positiveId } from "../lib/common.js";
import { loadRoom, RECALLED, scrubTraces } from "../lib/rooms.js";

export default handle(async (req, res) => {
  const user = await currentUser(req);
  if (req.method !== "DELETE") return send(res, 405, { error: "허용되지 않은 요청이에요." });
  const id = positiveId(req.query.id);
  if (!id) throw new Invalid("메시지를 찾을 수 없어요.", 404);

  const { data: m, error } = await db().from("cb_messages").select("id, thread_id, author_id, deleted_at").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!m || m.author_id !== user.id) throw new Invalid("메시지를 찾을 수 없어요.", 404);
  const { t } = await loadRoom(m.thread_id, user);   // 볼 수 없는 방이면 404
  if (m.deleted_at) return send(res, 200, { ok: true, already: true });

  const { error: e1 } = await db().from("cb_messages").update({ deleted_at: new Date().toISOString(), body: "" }).eq("id", m.id);
  if (e1) throw e1;
  // 목록 미리보기(마지막 메시지)와 방 제목(첫 메시지)에 남은 내용도 지움
  await scrubTraces(t, m.id, RECALLED);
  return send(res, 200, { ok: true });
});
