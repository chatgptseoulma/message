// POST {thread_id, message_id?, reason, detail?, block?} : 신고
//  - message_id 가 있으면 그 메시지(작성자)를, 없으면 방(하소연한 사람)을 신고
//  - 신고는 기록만 한다. 가리기·되돌리기는 관리자 화면(/admin, api/admin.js)에서
//    (예전에는 3명이 신고하면 자동으로 가렸지만, 가짜 계정 3개로 남의 글을 가릴 수 있어 껐음 — 보안점검 V-01)
//  - block: true 면 신고 대상도 함께 차단
import { db, send, handle, body, text, currentUser, Invalid, positiveId } from "../lib/common.js";
import { loadRoom, REASONS } from "../lib/rooms.js";

export default handle(async (req, res) => {
  const user = await currentUser(req);
  if (req.method !== "POST") return send(res, 405, { error: "허용되지 않은 요청이에요." });
  const b = body(req);
  // `in` 은 "toString" 같은 기본 속성도 통과시켜 DB 오류(500)가 났음 → 자기 속성만 (보안점검 V-07)
  if (typeof b.reason !== "string" || !Object.hasOwn(REASONS, b.reason)) throw new Invalid("신고 이유를 골라 주세요.");
  const detail = text(b.detail, { max: 300, label: "자세한 내용" });
  const { t } = await loadRoom(String(b.thread_id ?? ""), user);

  let target = t.seeker_id, messageId = null;
  if (b.message_id !== undefined && b.message_id !== null) {
    messageId = positiveId(b.message_id);
    if (!messageId) throw new Invalid("메시지를 찾을 수 없어요.", 404);
    const { data: m, error } = await db().from("cb_messages").select("id, thread_id, author_id").eq("id", messageId).maybeSingle();
    if (error) throw error;
    if (!m || m.thread_id !== t.id) throw new Invalid("메시지를 찾을 수 없어요.", 404);
    target = m.author_id;
  }
  if (target === user.id) throw new Invalid("내 글은 신고할 수 없어요.");

  // 같은 대상은 한 번만
  let dup = db().from("cb_reports").select("id").eq("reporter_id", user.id).eq("thread_id", t.id);
  dup = messageId ? dup.eq("message_id", messageId) : dup.is("message_id", null);
  const { data: already, error: e0 } = await dup.limit(1);
  if (e0) throw e0;
  if (already.length) throw new Invalid("이미 신고했어요. 확인해 볼게요.", 409);

  const { error: e1 } = await db().from("cb_reports").insert({
    reporter_id: user.id, target_user_id: target, thread_id: t.id, message_id: messageId, reason: b.reason, detail,
  });
  if (e1) throw e1;

  let blocked = false;
  if (b.block === true) {
    const { error: e4 } = await db().from("cb_blocks").upsert({ blocker_id: user.id, blocked_id: target }, { onConflict: "blocker_id,blocked_id" });
    if (e4) throw e4;
    blocked = true;
  }
  return send(res, 201, { ok: true, blocked });
});
