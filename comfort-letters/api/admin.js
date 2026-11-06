// 관리자 (보안점검 V-01): 신고 목록 보기, 메시지·방 가리기/되돌리기, 신고 처리 표시
//  - 모든 요청에 헤더 x-admin-password (Vercel 환경변수 ADMIN_PASSWORD 와 같아야 함)
//  GET  ?status=open|all                         : 신고 목록 (최근 200건)
//  POST {action, message_id? | thread_id? | report_id?}
//       hide_message / unhide_message / hide_room / unhide_room / resolve / reopen
import crypto from "node:crypto";
import { db, send, handle, body, isUuid, positiveId, Invalid } from "../lib/common.js";
import { scrubTraces, recomputeLast, cut, MODERATED, REASONS } from "../lib/rooms.js";

async function requireAdmin(req) {
  const expected = process.env.ADMIN_PASSWORD?.trim();
  if (!expected) throw new Invalid("관리자 비밀번호가 아직 설정되지 않았어요.", 503);
  const given = String(req.headers["x-admin-password"] ?? "");
  const h = s => crypto.createHash("sha256").update(s).digest();
  if (!crypto.timingSafeEqual(h(given), h(expected))) {
    await new Promise(r => setTimeout(r, 1000));   // 비밀번호 맞히기 속도 늦추기
    throw new Invalid("관리자 비밀번호가 맞지 않아요.", 401);
  }
}

async function listReports(status) {
  let q = db().from("cb_reports").select("id, reporter_id, target_user_id, thread_id, message_id, reason, detail, created_at, reviewed_at")
    .order("id", { ascending: false }).limit(200);
  if (status !== "all") q = q.is("reviewed_at", null);
  const { data: reps, error } = await q;
  if (error) throw error;
  const userIds = [...new Set(reps.flatMap(r => [r.reporter_id, r.target_user_id]).filter(Boolean))];
  const threadIds = [...new Set(reps.map(r => r.thread_id).filter(Boolean))];
  const msgIds = [...new Set(reps.map(r => r.message_id).filter(Boolean))];
  const [u, t, m] = await Promise.all([
    userIds.length ? db().from("cb_users").select("id, nickname").in("id", userIds) : { data: [] },
    threadIds.length ? db().from("cb_threads").select("id, title, moderated, closed, seeker_id").in("id", threadIds) : { data: [] },
    msgIds.length ? db().from("cb_messages").select("id, body, deleted_at, moderated").in("id", msgIds) : { data: [] },
  ]);
  for (const x of [u, t, m]) if (x.error) throw x.error;
  const name = Object.fromEntries(u.data.map(x => [x.id, x.nickname]));
  const th = Object.fromEntries(t.data.map(x => [x.id, x]));
  const ms = Object.fromEntries(m.data.map(x => [x.id, x]));
  return reps.map(r => ({
    id: r.id,
    reason: r.reason, reason_label: REASONS[r.reason] ?? r.reason, detail: r.detail,
    created_at: r.created_at, reviewed_at: r.reviewed_at,
    reporter: r.reporter_id ? name[r.reporter_id] ?? "(탈퇴)" : "(탈퇴)",
    target: r.target_user_id ? name[r.target_user_id] ?? "(탈퇴)" : "(탈퇴)",
    thread_id: r.thread_id,
    room: th[r.thread_id] ? { title: th[r.thread_id].title, moderated: th[r.thread_id].moderated, closed: th[r.thread_id].closed } : null,
    message_id: r.message_id,
    message: r.message_id
      ? (ms[r.message_id] ? { body: ms[r.message_id].body, recalled: Boolean(ms[r.message_id].deleted_at), moderated: ms[r.message_id].moderated } : null)
      : null,
  }));
}

async function messageAndThread(idRaw) {
  const id = positiveId(idRaw);
  if (!id) throw new Invalid("메시지를 찾을 수 없어요.", 404);
  const { data: m, error } = await db().from("cb_messages").select("id, thread_id, body, deleted_at").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!m) throw new Invalid("메시지를 찾을 수 없어요.", 404);
  const { data: t, error: e2 } = await db().from("cb_threads").select("*").eq("id", m.thread_id).single();
  if (e2) throw e2;
  return { m, t };
}

export default handle(async (req, res) => {
  await requireAdmin(req);

  if (req.method === "GET") {
    return send(res, 200, { reports: await listReports(String(req.query.status || "open")) });
  }

  if (req.method === "POST") {
    const b = body(req);
    switch (b.action) {
      case "hide_message": {
        const { m, t } = await messageAndThread(b.message_id);
        const { error } = await db().from("cb_messages").update({ moderated: true }).eq("id", m.id);
        if (error) throw error;
        await scrubTraces(t, m.id, MODERATED);   // 방 제목·목록 미리보기에서도 지움
        return send(res, 200, { ok: true });
      }
      case "unhide_message": {
        const { m, t } = await messageAndThread(b.message_id);
        const { error } = await db().from("cb_messages").update({ moderated: false }).eq("id", m.id);
        if (error) throw error;
        // 제목(첫 메시지였다면)·미리보기 되살리기. 회수된 메시지는 내용이 없으므로 그대로
        if (!m.deleted_at) {
          const { data: first, error: e3 } = await db().from("cb_messages").select("id").eq("thread_id", t.id).order("id").limit(1).maybeSingle();
          if (e3) throw e3;
          if (first?.id === m.id) {
            const { error: e4 } = await db().from("cb_threads").update({ title: cut(m.body.replace(/\s+/g, " "), 40) }).eq("id", t.id);
            if (e4) throw e4;
          }
        }
        await recomputeLast([t.id]);
        return send(res, 200, { ok: true });
      }
      case "hide_room":
      case "unhide_room": {
        if (!isUuid(b.thread_id)) throw new Invalid("방을 찾을 수 없어요.", 404);
        const { data, error } = await db().from("cb_threads").update({ moderated: b.action === "hide_room" }).eq("id", b.thread_id).select("id");
        if (error) throw error;
        if (!data.length) throw new Invalid("방을 찾을 수 없어요.", 404);
        return send(res, 200, { ok: true });
      }
      case "resolve":
      case "reopen": {
        const id = positiveId(b.report_id);
        if (!id) throw new Invalid("신고를 찾을 수 없어요.", 404);
        const { data, error } = await db().from("cb_reports").update({ reviewed_at: b.action === "resolve" ? new Date().toISOString() : null }).eq("id", id).select("id");
        if (error) throw error;
        if (!data.length) throw new Invalid("신고를 찾을 수 없어요.", 404);
        return send(res, 200, { ok: true });
      }
      default:
        throw new Invalid("알 수 없는 요청이에요.");
    }
  }
  send(res, 405, { error: "허용되지 않은 요청이에요." });
});
